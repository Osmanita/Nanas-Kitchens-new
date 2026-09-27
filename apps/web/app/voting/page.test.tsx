import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ensureSession } from "../../lib/api";
import { MenuPoll } from "../../lib/polls";
import VotingPage from "./page";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn(), ensureSession: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("../components/LocationPickerModal", () => ({ default: () => null }));
const router = { push: vi.fn() };
const location = { lat: 40.1578, lng: -83.0752, label: "Powell, Ohio" };
const poll: MenuPoll = {
  id: "poll",
  kitchenId: "kitchen",
  kitchenName: "Emine’s kitchen",
  question: "What should I cook tomorrow?",
  options: ["Manti", "Soup"],
  prices: [1200, 600],
  serviceDate: "2099-01-01",
  timeZone: "America/New_York",
  readyTimes: ["17:00", "18:00"],
  minimumPortions: 3,
  capacity: 10,
  tallies: [0, 0],
  portions: [0, 0],
  totalVotes: 0,
  closesAt: "2098-12-31T23:00:00Z",
  closed: false,
  finalized: false,
  cookingOptions: [],
  myVote: null,
  preorder: null,
};
const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("location", JSON.stringify(location));
  vi.mocked(ensureSession).mockResolvedValue({
    userId: "buyer",
    role: "buyer",
  });
});

describe("tomorrow's pre-orders", () => {
  it("records the chosen portions and time without opening payment while voting", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(reply([poll]))
      .mockResolvedValueOnce(
        reply({
          ...poll,
          myVote: 0,
          preorder: {
            qty: 2,
            readyTime: "18:00",
            status: "awaiting_result",
            totalCents: 2400,
            orderId: null,
          },
        }),
      );
    render(<VotingPage />);
    fireEvent.click((await screen.findAllByRole("radio"))[0]);
    fireEvent.change(screen.getByLabelText("Portions"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Pickup time"), {
      target: { value: "18:00" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Vote & reserve portions" }),
    );
    await screen.findByText("Your pre-order is received.");
    const call = vi
      .mocked(apiFetch)
      .mock.calls.find(([path]) => path.endsWith("/vote"))!;
    expect(JSON.parse(call[1]!.body as string)).toEqual({
      optionIndex: 0,
      qty: 2,
      readyTime: "18:00",
      lat: location.lat,
      lng: location.lng,
    });
    expect(
      screen.queryByRole("button", { name: /Review & pay/ }),
    ).not.toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
  it("opens only the owned confirmed pre-order for later payment", async () => {
    const ready = {
      ...poll,
      closed: true,
      finalized: true,
      myVote: 0,
      cookingOptions: [0],
      preorder: {
        qty: 2,
        readyTime: "17:00",
        status: "ready_for_payment",
        totalCents: 2400,
        orderId: null,
      },
    };
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(reply([ready]))
      .mockResolvedValueOnce(reply({ orderId: "owned-order" }));
    render(<VotingPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Review & pay $24.00" }),
    );
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith("/orders/owned-order"),
    );
  });
  it("recovers from a capacity conflict and leaves the reservation form usable", async () => {
    vi.mocked(apiFetch)
      .mockResolvedValueOnce(reply([poll]))
      .mockResolvedValueOnce(reply({ message: "POLL_PORTIONS_FULL" }, 409));
    render(<VotingPage />);
    fireEvent.click((await screen.findAllByRole("radio"))[0]);
    fireEvent.click(
      screen.getByRole("button", { name: "Vote & reserve portions" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Those portions were just reserved",
    );
    expect(
      screen.getByRole("button", { name: "Vote & reserve portions" }),
    ).toBeEnabled();
  });
  it("asks the cook to confirm before finalizing and enabling payments", async () => {
    vi.mocked(ensureSession).mockResolvedValue({
      userId: "seller",
      role: "seller",
    });
    vi.mocked(apiFetch).mockResolvedValueOnce(
      reply([{ ...poll, tallies: [2, 1], portions: [2, 3], totalVotes: 3 }]),
    );
    render(<VotingPage />);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Close voting & confirm menu",
      }),
    );
    expect(apiFetch).toHaveBeenCalledTimes(1);
    vi.mocked(apiFetch).mockResolvedValueOnce(
      reply({ ...poll, finalized: true, closed: true, cookingOptions: [0, 1] }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm tomorrow’s menu" }),
    );
    await screen.findByText("Menu confirmed");
    expect(vi.mocked(apiFetch).mock.calls[1][0]).toBe("/polls/poll/finalize");
  });
  it("does not fetch neighborhood polls for a signed-out visitor", async () => {
    vi.mocked(ensureSession).mockResolvedValue(null);
    render(<VotingPage />);
    await screen.findByRole("link", { name: "Log in to vote" });
    expect(apiFetch).not.toHaveBeenCalled();
  });
});
