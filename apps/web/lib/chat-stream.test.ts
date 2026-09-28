import { describe, expect, it, vi } from "vitest";
import { ChatStreamError, nearbyKitchenQuery, readChatStream } from "./chat-stream";

const bytes = new TextEncoder();
const event = (type: string, delta?: string) => `data: ${JSON.stringify({ type, delta })}\n\n`;

describe("chat stream", () => {
  it("finishes on done and cancels an otherwise open proxy connection", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.encode(event("status", "started") + event("text", "Merhaba") + event("done")));
      }, cancel,
    }));
    const onText = vi.fn();
    await readChatStream(response, onText);
    expect(onText).toHaveBeenCalledOnce();
    expect(onText).toHaveBeenCalledWith("Merhaba");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("preserves Turkish UTF-8 split across chunks and a final event without a newline", async () => {
    const payload = bytes.encode(event("text", "Görüşürüz") + 'data:{"type":"done"}');
    const chunks: string[] = [];
    const response = new Response(new ReadableStream({ start(controller) {
      for (const byte of payload) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } }));
    await readChatStream(response, text => chunks.push(text));
    expect(chunks.join("")).toBe("Görüşürüz");
  });

  it("surfaces provider errors instead of silently completing", async () => {
    const response = new Response(event("error", "The AI service is busy."));
    await expect(readChatStream(response, vi.fn())).rejects.toThrow("The AI service is busy.");
  });

  it("rejects empty and truncated replies so partial cards are never committed", async () => {
    await expect(readChatStream(new Response(event("done")), vi.fn())).rejects.toBeInstanceOf(ChatStreamError);
    await expect(readChatStream(new Response(event("text", '{"type":"menu"')), vi.fn())).rejects.toThrow("interrupted");
  });

  it("bypasses AI only for simple nearby discovery, without dropping constraints", () => {
    expect(nearbyKitchenQuery("Türk yemekleri var mı?")).toEqual({ cuisine: "turkish" });
    expect(nearbyKitchenQuery("Find Turkish food near me")).toEqual({ cuisine: "turkish" });
    expect(nearbyKitchenQuery("Yakınımda ne var?")).toEqual({});
    expect(nearbyKitchenQuery("Find vegetarian dishes near me")).toBeNull();
    expect(nearbyKitchenQuery("Türk yemekleri var mı? Gluten yiyemiyorum.")).toBeNull();
    expect(nearbyKitchenQuery("Order Turkish food for tomorrow")).toBeNull();
  });
});
