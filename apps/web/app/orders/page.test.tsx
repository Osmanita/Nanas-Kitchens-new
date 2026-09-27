import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ensureSession } from "../../lib/api";
import OrdersPage from "./page";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn(), ensureSession: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const router = { replace: vi.fn() };
const base = {
  readySlot: "2026-09-26T17:00:00",
  fulfillment: "pickup",
  totalCents: 1400,
  createdAt: "2026-09-26T12:00:00",
  cuisineTag: "turkish",
  itemsSummary: "1 × Manti",
  deliveryTrackingUrl: null,
  reviewed: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureSession).mockResolvedValue({
    userId: "buyer",
    role: "buyer",
  });
});
describe("order history", () => {
  it("filters in-progress meals separately from closed orders and retains their detail links", async () => {
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            ...base,
            id: "waiting",
            status: "pending",
            kitchenName: "Ayse’s kitchen",
          },
          {
            ...base,
            id: "closed",
            status: "cancelled",
            kitchenName: "Emine’s kitchen",
          },
        ]),
      ),
    );
    render(<OrdersPage />);
    await screen.findByText("Awaiting payment");
    fireEvent.click(screen.getByRole("button", { name: /In progress/ }));
    expect(
      screen.getByRole("link", { name: "Ayse’s kitchen" }),
    ).toHaveAttribute("href", "/orders/waiting");
    expect(screen.queryByText("Emine’s kitchen")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Past orders/ }));
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByText("Ayse’s kitchen")).not.toBeInTheDocument();
  });
  it("recovers from a failed load without making a failure look like empty history", async () => {
    vi.mocked(apiFetch)
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValueOnce(new Response("[]"));
    render(<OrdersPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t load");
    expect(
      screen.queryByText("Your first meal is waiting"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Your first meal is waiting");
  });
});
