import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ensureSession } from "../../lib/api";
import SellerPortalPage from "./page";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn(), ensureSession: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const router = { replace: vi.fn() };
const date = new Date().toISOString().slice(0, 10);
const kitchen = { id: "fatma", name: "Fatma’s Sarma House", photos: [], complianceAttestedAt: "2026-09-01", ratingAvg: null, ratingCount: 0 };
const order = { id: "paid-order", status: "confirmed", readySlot: `${date}T17:00:00`, fulfillment: "pickup", totalCents: 2400, buyerEmail: "neighbor@example.test", itemsSummary: "2 × Sarma", items: [{ name: "Sarma", qty: 2, photo: null }] };
const data: Record<string, unknown> = {
  "/kitchens/mine": kitchen,
  "/kitchens/fatma/orders": [order, { ...order, id: "unpaid-order", status: "pending" }],
  [`/kitchens/fatma/menu-days?date=${date}`]: [{ id: "menu", date, status: "published", readyWindows: [], items: [{ id: "item", portionsRemaining: 8, portionsTotal: 10, dish: { name: "Sarma", priceCents: 1200, photo: null } }] }],
  "/kitchens/fatma/earnings": { paid: { orders: 3, netCents: 4200 }, upcoming: { orders: 1, netCents: 2040 } },
  "/polls/mine": [],
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(ensureSession).mockResolvedValue({ userId: "seller", role: "seller" });
  vi.mocked(apiFetch).mockImplementation(async (path) => reply(data[path] ?? []));
});

describe("seller portal", () => {
  it("shows only paid orders for acceptance and connects the service date to menu management", async () => {
    render(<SellerPortalPage />);
    expect(await screen.findByRole("button", { name: "Accept order paid-ord" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /unpaid/ })).not.toBeInTheDocument();
    const overview = within(screen.getByRole("region", { name: "Kitchen overview" }));
    expect(overview.getByText("Awaiting your response").parentElement).toHaveTextContent("1");
    expect(overview.getByText("Portions available").parentElement).toHaveTextContent("8");
    expect(screen.getByRole("link", { name: "Manage menu & portions →" })).toHaveAttribute("href", `/seller/menu?date=${date}`);
  });

  it("requires an explicit action to accept an order and then updates the queue", async () => {
    let accepted = false;
    vi.mocked(apiFetch).mockImplementation(async (path, init) => {
      if (path === "/orders/paid-order/accept" && init?.method === "POST") { accepted = true; return reply({ status: "accepted" }); }
      if (path.endsWith("/orders") && accepted) return reply([{ ...order, status: "accepted" }]);
      return reply(data[path] ?? []);
    });
    render(<SellerPortalPage />);
    const button = await screen.findByRole("button", { name: "Accept order paid-ord" });
    expect(accepted).toBe(false);
    fireEvent.click(button);
    await screen.findByText(/Order paid-ord accepted/);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Accept order paid-ord" })).not.toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledWith("/orders/paid-order/accept", expect.objectContaining({ method: "POST" }));
  });

  it("keeps other sections usable when earnings fail and supports retry", async () => {
    let fail = true;
    vi.mocked(apiFetch).mockImplementation(async (path) => path.endsWith("/earnings") && fail ? reply({}, 500) : reply(data[path] ?? []));
    render(<SellerPortalPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t load earnings");
    expect(screen.getByText("Completed sales · net").parentElement).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: "Accept order paid-ord" })).toBeEnabled();
    fail = false; fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("Completed sales · net").parentElement).toHaveTextContent("$42.00"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the setup path only when the seller has no kitchen", async () => {
    vi.mocked(apiFetch).mockResolvedValue(reply({}, 404));
    render(<SellerPortalPage />);
    expect(await screen.findByRole("link", { name: "Set up my kitchen" })).toHaveAttribute("href", "/seller/menu");
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not request private kitchen data for buyer accounts", async () => {
    vi.mocked(ensureSession).mockResolvedValue({ userId: "buyer", role: "buyer" });
    render(<SellerPortalPage />);
    await screen.findByRole("link", { name: "Use a seller account" });
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("preserves the portal destination when a signed-out seller logs in", async () => {
    vi.mocked(ensureSession).mockResolvedValue(null);
    render(<SellerPortalPage />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?next=/seller"));
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
