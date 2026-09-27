import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../../lib/api";
import OrderPage from "./page";

vi.mock("../../../lib/api", () => ({ apiFetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "meal-1" }) }));
const order = {
  id: "meal-1",
  status: "confirmed",
  readySlot: "2026-09-26T17:00:00",
  fulfillment: "pickup",
  totalCents: 1400,
  refundedAt: null,
  createdAt: "2026-09-26T12:00:00",
  items: [
    {
      id: "line-1",
      qty: 1,
      unitPriceCents: 1400,
      menuItem: { dish: { name: "Manti", photo: null } },
    },
  ],
  kitchenId: "kitchen",
  kitchenName: "Ayse’s kitchen",
  pickupAddress: "123 Test Street",
  deliveryJob: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});
describe("order detail", () => {
  it("asks before cancelling and preserves the order when cancellation fails", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(order)))
      .mockResolvedValueOnce(new Response("{}", { status: 409 }));
    render(<OrderPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel order" }),
    );
    expect(apiFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Keep order" }));
    expect(apiFetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel order" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, cancel order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "couldn’t cancel",
    );
    expect(screen.getByText("Waiting for the kitchen")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenLastCalledWith("/orders/meal-1/cancel", {
      method: "POST",
    });
  });
  it("shows a closed order without a success timeline or payment action", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ ...order, status: "cancelled" })),
    );
    render(<OrderPage />);
    await screen.findByRole("heading", { name: "This order is closed." });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Pay/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Total").parentElement).toHaveTextContent("$14.00");
  });
  it("stops asking the buyer to collect a completed pickup order", async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) =>
      path.endsWith("/review")
        ? new Response("{}", { status: 404 })
        : new Response(JSON.stringify({ ...order, status: "completed" })),
    );
    render(<OrderPage />);
    await screen.findByText("Pickup completed.");
    expect(screen.getByText("Your kitchen marked this order as collected.")).toBeInTheDocument();
    expect(screen.queryByText(/Collect your meal/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Get directions/ })).not.toBeInTheDocument();
    expect(screen.getByText(order.pickupAddress)).toBeInTheDocument();
  });
});
