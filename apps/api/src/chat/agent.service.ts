/**
 * Story 5.2 — Conversational ordering agent.
 * Uses Claude API (claude-opus-4-8) with streaming + tool-use loop.
 * Tools delegate to the same REST API the MCP server uses (NFR3).
 */
import { Injectable, Logger } from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { Response } from "express";
import { SYSTEM_PROMPT } from "./system.prompt";

// The Java backend, not this service. Ordering no longer lives here at all, and the routes
// this agent calls are wire-compatible on :8080 - pointing at :3001 would 404 on every order
// tool. This whole chat path is superseded by the Spring AI agent in apps/api-java; it stays
// as reference until the last stories move over.
const API_URL = process.env.API_URL ?? "http://localhost:8080";
const MODEL = "claude-opus-4-8";

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_kitchens",
    description: "Search for kitchens within 10 miles. Returns list with name, cuisine, distance, portions left.",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lng: { type: "number" },
        cuisine: { type: "string", description: "Optional cuisine filter" },
      },
      required: ["lat", "lng"],
    },
  },
  {
    name: "get_menu",
    description: "Get the published daily menu for a kitchen.",
    input_schema: {
      type: "object",
      properties: {
        kitchenId: { type: "string" },
        date: { type: "string", description: "ISO date string, defaults to today" },
      },
      required: ["kitchenId"],
    },
  },
  {
    name: "check_portions",
    description: "Check live remaining portions for a list of menu item IDs.",
    input_schema: {
      type: "object",
      properties: {
        menuItemIds: { type: "array", items: { type: "string" } },
      },
      required: ["menuItemIds"],
    },
  },
  {
    name: "create_order",
    description:
      "Create an order. With confirm=false returns a priced summary only (FR15). " +
      "Call with confirm=false first, show summary to user, then call with confirm=true after explicit confirmation.",
    input_schema: {
      type: "object",
      properties: {
        kitchenId: { type: "string" },
        menuDayId: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { menuItemId: { type: "string" }, qty: { type: "integer", minimum: 1 } },
            required: ["menuItemId", "qty"],
          },
        },
        readySlot: { type: "string", description: "ISO datetime for pickup/delivery window" },
        fulfillment: { type: "string", enum: ["pickup", "delivery"] },
        confirm: { type: "boolean", default: false },
      },
      required: ["kitchenId", "menuDayId", "items", "readySlot", "fulfillment", "confirm"],
    },
  },
  {
    name: "get_order_status",
    description: "Get the status of an existing order.",
    input_schema: {
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
    },
  },
  {
    name: "cancel_order",
    description: "Cancel an order. Inventory is automatically restored.",
    input_schema: {
      type: "object",
      properties: { orderId: { type: "string" } },
      required: ["orderId"],
    },
  },
];

async function callTool(name: string, input: Record<string, unknown>, token: string): Promise<string> {
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  let res: globalThis.Response;
  switch (name) {
    case "search_kitchens": {
      const { lat, lng, cuisine } = input as any;
      res = await fetch(
        `${API_URL}/kitchens/search?lat=${lat}&lng=${lng}${cuisine ? `&cuisine=${cuisine}` : ""}`,
        { headers },
      );
      break;
    }
    case "get_menu": {
      const { kitchenId, date } = input as any;
      res = await fetch(`${API_URL}/kitchens/${kitchenId}/menu${date ? `?date=${date}` : ""}`, { headers });
      break;
    }
    case "check_portions": {
      res = await fetch(`${API_URL}/inventory/remaining`, {
        method: "POST",
        headers,
        body: JSON.stringify({ menuItemIds: (input as any).menuItemIds }),
      });
      break;
    }
    case "create_order": {
      res = await fetch(`${API_URL}/orders`, { method: "POST", headers, body: JSON.stringify(input) });
      break;
    }
    case "get_order_status": {
      res = await fetch(`${API_URL}/orders/${(input as any).orderId}`, { headers });
      break;
    }
    case "cancel_order": {
      res = await fetch(`${API_URL}/orders/${(input as any).orderId}/cancel`, { method: "POST", headers });
      break;
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
  const body = await res.json().catch(() => ({}));
  return JSON.stringify(body);
}

@Injectable()
export class AgentService {
  private readonly client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  private readonly logger = new Logger(AgentService.name);

  /**
   * Run the agentic tool-use loop and stream text tokens to the SSE response.
   * Emits SSE events: `data: {"type":"text","delta":"..."}` and `data: {"type":"done"}`.
   */
  async streamChat(
    messages: Anthropic.MessageParam[],
    userToken: string,
    sseRes: Response,
  ): Promise<void> {
    const history: Anthropic.MessageParam[] = [...messages];

    sseRes.setHeader("Content-Type", "text/event-stream");
    sseRes.setHeader("Cache-Control", "no-cache");
    sseRes.setHeader("Connection", "keep-alive");
    sseRes.flushHeaders();

    const sendEvent = (payload: object) => {
      sseRes.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    // Agentic loop — continues until Claude emits stop_reason = "end_turn"
    while (true) {
      const stream = await this.client.messages.stream({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: history,
        // adaptive thinking (newer than installed SDK's types, hence the cast)
        thinking: { type: "adaptive" } as unknown as Anthropic.ThinkingConfigParam,
      });

      const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

      for await (const event of stream) {
        if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            sendEvent({ type: "text", delta: event.delta.text });
          }
        } else if (event.type === "content_block_stop") {
          // nothing extra needed
        } else if (event.type === "message_delta") {
          // stop_reason is here when streaming completes
        }
      }

      const finalMsg = await stream.finalMessage();

      // Collect tool_use blocks from the final message
      for (const block of finalMsg.content) {
        if (block.type === "tool_use") toolUseBlocks.push(block);
      }

      // Append assistant turn to history
      history.push({ role: "assistant", content: finalMsg.content });

      if (finalMsg.stop_reason === "end_turn" || toolUseBlocks.length === 0) break;

      // Execute tools and build tool_result turn
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (tu) => {
          this.logger.debug(`Tool call: ${tu.name} ${JSON.stringify(tu.input)}`);
          const result = await callTool(tu.name, tu.input as Record<string, unknown>, userToken).catch(
            (e) => JSON.stringify({ error: String(e) }),
          );
          return { type: "tool_result" as const, tool_use_id: tu.id, content: result };
        }),
      );

      history.push({ role: "user", content: toolResults });
    }

    sendEvent({ type: "done" });
    sseRes.end();
  }
}
