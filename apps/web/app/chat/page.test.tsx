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
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "d1", date: "2026-09-26", readyWindows: [{start: "17:00", end: "20:00"}], items: [{ id: "m1", portionsRemaining: 4, dish: { name: "Sarma", priceCents: 1200 } }] })));
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
    await screen.findByRole("button", { name: "Add one Sarma" });
    expect(vi.mocked(apiFetch).mock.calls[1][0]).toBe("/kitchens/k1/menu");
    expect(apiFetch).toHaveBeenCalledTimes(2);
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
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "d1", date: "2026-09-26", items: [{id:"m1", portionsRemaining:2}] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ summary: { items: [{dish:"Sarma", qty:2, unitPriceCents:1200}], totalCents:2400, fulfillment:"pickup", readySlot:"17:00" } })));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole("button", { name: /A taste of home/ }));
    const add = await screen.findByRole("button", { name: "Add one Sarma" });
    fireEvent.click(add);
    fireEvent.click(add);
    expect(add).toBeDisabled();
    expect(screen.getByText("$24.00")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Fulfillment" }), { target: { value: "pickup" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to order" }));
    await screen.findByRole("button", { name: "Confirm order" });
    const request = JSON.parse(
      vi.mocked(apiFetch).mock.calls[2][1]!.body as string,
    );
    expect(vi.mocked(apiFetch).mock.calls[2][0]).toBe("/orders");
    expect(request).toMatchObject({ confirm:false, items:[{menuItemId:"m1",qty:2}], fulfillment:"pickup" });
    expect(screen.getByRole("log")).not.toHaveTextContent("menuItemIds");
    expect(vi.mocked(apiFetch).mock.calls.filter(([path]) => path === "/chat/stream")).toHaveLength(1);
  });

  it("searches a saved location directly without waiting for Gemini", async () => {
    localStorage.setItem("location", JSON.stringify({ lat:40.16, lng:-83.09, label:"Powell" }));
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify([{ id:"k1", name:"Ayse", cuisineTag:"turkish", portionsLeftToday:5, distanceMiles:1 }])));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole("button", { name: /A taste of home/ }));
    await screen.findByRole("button", { name: "View menu for Ayse" });
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe("/kitchens/search?lat=40.16&lng=-83.09&cuisine=turkish");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("offers retry when the model streams an error event", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(new ReadableStream({ start(controller) {
      controller.enqueue(event("error", "Timeout")); controller.close();
    } })));
    render(<ChatPage />);
    fireEvent.click(screen.getByRole("button", { name: /A taste of home/ }));
    expect(await screen.findByRole("button", { name: /Try again/ })).toBeEnabled();
  });
});
