import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import ChatPage from "./page";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("../components/LocationPickerModal", () => ({ default: () => null }));
vi.mock("../components/PaymentStep", () => ({ default: () => null }));

const encoder = new TextEncoder();
const event = (type: string, delta?: string) =>
  encoder.encode(`data:${JSON.stringify({ type, delta })}\n\n`);

function reply(text: string) {
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(event("text", text));
        controller.enqueue(event("done"));
        controller.close();
      },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

describe("chat interactions", () => {
  it("retries a failed message without duplicating the user turn or sending error copy to the model", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(reply("Here are some Turkish kitchens."));
    render(<ChatPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Find Turkish food" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Nana couldn’t reply",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Here are some Turkish kitchens.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("log")).getAllByText("Find Turkish food"),
    ).toHaveLength(1);
    const retry = JSON.parse(
      vi.mocked(apiFetch).mock.calls[1][1]!.body as string,
    );
    expect(retry.messages).toEqual([
      { role: "user", content: "Find Turkish food" },
    ]);
  });

  it("keeps streamed JSON hidden and turns completed results into usable kitchen buttons", async () => {
    let stream!: ReadableStreamDefaultController<Uint8Array>;
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              stream = controller;
            },
          }),
        ),
      )
      .mockResolvedValueOnce(reply("The kitchen’s menu is ready."));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole("button", { name: /A taste of home/ }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1));
    await act(async () => {
      stream.enqueue(
        event(
          "text",
          'Here’s a kitchen to try.\n```json\n{"type":"kitchens","items":[',
        ),
      );
    });
    expect(screen.getByRole("log")).toHaveTextContent(
      "Here’s a kitchen to try.",
    );
    expect(screen.getByRole("log")).not.toHaveTextContent('"type"');
    expect(
      screen.getByRole("button", { name: "Start a new conversation" }),
    ).toBeDisabled();
    await act(async () => {
      stream.enqueue(
        event(
          "text",
          '{"id":"k1","name":"Ayse’s Kitchen","cuisineTag":"turkish","distanceMiles":1,"portionsLeftToday":12}]}\n```',
        ),
      );
      stream.enqueue(event("done"));
      stream.close();
    });
    const kitchen = await screen.findByRole("button", {
      name: "View menu for Ayse’s Kitchen",
    });
    expect(kitchen).toBeEnabled();
    expect(screen.getByRole("log")).not.toHaveTextContent("```json");
    fireEvent.click(kitchen);
    await screen.findByText("The kitchen’s menu is ready.");
    const request = JSON.parse(
      vi.mocked(apiFetch).mock.calls[1][1]!.body as string,
    );
    expect(request.messages.at(-1).content).toBe(
      "Show me the menu for Ayse’s Kitchen",
    );
  });

  it("handles provider whitespace and an unfenced structured response", async () => {
    const kitchens = {
      type: "kitchens",
      items: [
        {
          id: "k1",
          name: "Ayse’s Kitchen",
          cuisineTag: "turkish",
          distanceMiles: 1,
          portionsLeftToday: 12,
        },
      ],
    };
    vi.mocked(apiFetch).mockResolvedValueOnce(
      reply(
        "Here are the kitchens near you:\r\n\r\n" + JSON.stringify(kitchens),
      ),
    );
    render(<ChatPage />);
    fireEvent.click(screen.getByRole("button", { name: /A taste of home/ }));
    expect(
      await screen.findByRole("button", {
        name: "View menu for Ayse’s Kitchen",
      }),
    ).toBeEnabled();
    expect(screen.getByRole("log")).not.toHaveTextContent('"type"');
  });

  it("preserves menu quantities and sends the selected items through the existing order flow", async () => {
    const menu = {
      type: "menu",
      kitchenName: "Ayse’s Kitchen",
      kitchenId: "k1",
      menuDayId: "d1",
      items: [
        { menuItemId: "m1", name: "Sarma", priceCents: 1200, portionsLeft: 2 },
      ],
    };
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(
        reply("Pick a dish.\n```json\n" + JSON.stringify(menu) + "\n```"),
      )
      .mockResolvedValueOnce(reply("Would you like pickup or delivery?"));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole("button", { name: /A taste of home/ }));
    const add = await screen.findByRole("button", { name: "Add one Sarma" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(add).toBeDisabled();
    expect(screen.getByText("$24.00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to order" }));
    await screen.findByText("Would you like pickup or delivery?");
    const request = JSON.parse(
      vi.mocked(apiFetch).mock.calls[1][1]!.body as string,
    );
    expect(request.messages.at(-1).content).toContain("2 x Sarma");
    expect(request.messages.at(-1).content).toContain("[menuItemIds: m1]");
  });
});
