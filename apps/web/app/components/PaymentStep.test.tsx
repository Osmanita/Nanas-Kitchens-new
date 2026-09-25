import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PaymentStep, { PAYMENT_TIMEOUT_MS } from "./PaymentStep";

const stripeMock = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
}));

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@stripe/react-stripe-js", async () => {
  const React = await import("react");
  return {
    Elements: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PaymentElement: ({ onReady }: { onReady?: () => void }) => {
      React.useEffect(() => onReady?.(), [onReady]);
      return <div data-testid="payment-element" />;
    },
    useElements: () => ({}),
    useStripe: () => stripeMock,
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const payment = {
  orderId: "order-1",
  clientSecret: "pi_test_secret",
  publishableKey: "pk_test_key",
};

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("PaymentStep", () => {
  it("returns to an enabled pay button when Stripe confirmation rejects", async () => {
    stripeMock.confirmPayment.mockRejectedValueOnce(new Error("network down"));
    render(<PaymentStep payment={payment} totalCents={3499} />);

    const button = await screen.findByRole("button", { name: "Pay $34.99" });
    fireEvent.click(button);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Payment could not be completed. Please try again.",
    );
    expect(screen.getByRole("button", { name: "Pay $34.99" })).toBeEnabled();
  });

  it("shows Stripe validation errors and clears the pending state", async () => {
    stripeMock.confirmPayment.mockResolvedValueOnce({
      error: { message: "Your card was declined." },
    });
    render(<PaymentStep payment={payment} totalCents={3499} />);

    fireEvent.click(await screen.findByRole("button", { name: "Pay $34.99" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your card was declined.",
    );
    expect(screen.getByRole("button", { name: "Pay $34.99" })).toBeEnabled();
  });

  it("recovers when Stripe never resolves", async () => {
    vi.useFakeTimers();
    stripeMock.confirmPayment.mockReturnValueOnce(new Promise(() => {}));
    render(<PaymentStep payment={payment} totalCents={3499} />);

    fireEvent.click(screen.getByRole("button", { name: "Pay $34.99" }));
    await act(async () => {
      vi.advanceTimersByTime(PAYMENT_TIMEOUT_MS);
      await Promise.resolve();
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Payment confirmation timed out.",
    );
    expect(screen.getByRole("button", { name: "Pay $34.99" })).toBeEnabled();
  });
});
