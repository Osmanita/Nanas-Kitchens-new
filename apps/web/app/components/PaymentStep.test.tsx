import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "../../lib/api";
import PaymentStep, { PAYMENT_TIMEOUT_MS } from "./PaymentStep";

vi.mock("../../lib/api", () => ({ apiFetch: vi.fn() }));
const payment = { orderId: "order-1" };
beforeEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("hosted payment", () => {
  it("enables Pay without loading Stripe.js or supplying a client secret", () => {
    render(<PaymentStep payment={payment} totalCents={3499} />);
    expect(screen.getByRole("button", { name: "Pay $34.99" })).toBeEnabled();
    expect(document.querySelector('iframe')).toBeNull();
  });
  it("prevents duplicate submissions and enables retry after a network failure", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(apiFetch).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    render(<PaymentStep payment={payment} totalCents={3499} />);
    const button = screen.getByRole("button", { name: "Pay $34.99" });
    fireEvent.click(button); fireEvent.click(button);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    await act(async () => reject(new Error("Connection lost")));
    expect(await screen.findByRole("alert")).toHaveTextContent("Connection lost");
    expect(button).toBeEnabled();
    expect(apiFetch).toHaveBeenCalledWith('/orders/order-1/checkout', expect.objectContaining({ method: 'POST' }));
  });
  it("aborts a hanging checkout request and allows retry", async () => {
    vi.useFakeTimers();
    vi.mocked(apiFetch).mockImplementationOnce((_path, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    render(<PaymentStep payment={payment} totalCents={3499} />);
    fireEvent.click(screen.getByRole("button", { name: "Pay $34.99" }));
    await act(async () => { vi.advanceTimersByTime(PAYMENT_TIMEOUT_MS); });
    expect(screen.getByRole("alert")).toHaveTextContent("Checkout took too long");
    expect(screen.getByRole("button", { name: "Pay $34.99" })).toBeEnabled();
  });
  it("refuses a non-Stripe redirect", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://example.com/pay' })));
    render(<PaymentStep payment={payment} totalCents={3499} />);
    fireEvent.click(screen.getByRole("button", { name: "Pay $34.99" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not open secure checkout");
  });
  it("does not claim success when the order is no longer payable", async () => {
    vi.mocked(apiFetch).mockResolvedValueOnce(new Response('{}', { status: 409 }));
    render(<PaymentStep payment={payment} totalCents={3499} />);
    fireEvent.click(screen.getByRole("button", { name: "Pay $34.99" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Check My orders");
  });
});
