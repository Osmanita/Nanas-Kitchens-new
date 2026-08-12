import { beforeEach, describe, expect, it, vi } from "vitest";
import { addLine, cartCount, cartSubtotalCents, clearCart, getCart, money, setQty, subscribeCart } from "./cart";

const ctx = { kitchenId: "k1", kitchenName: "Ayse's Kitchen", menuDayId: "d1", menuDate: "2026-08-05" };
const line = (over: Partial<Parameters<typeof addLine>[1]> = {}) => ({
  menuItemId: "m1",
  dishName: "Manti",
  priceCents: 1200,
  photo: null,
  qty: 1,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
});

describe("cart", () => {
  it("starts empty", () => {
    expect(getCart()).toBeNull();
    expect(cartCount()).toBe(0);
    expect(cartSubtotalCents()).toBe(0);
  });

  it("adds a line and persists it", () => {
    addLine(ctx, line());
    const cart = getCart();
    expect(cart?.lines).toHaveLength(1);
    expect(cart?.lines[0]).toMatchObject({ menuItemId: "m1", qty: 1 });
  });

  it("increments qty when the same dish is added again", () => {
    addLine(ctx, line({ qty: 2 }));
    addLine(ctx, line({ qty: 3 }));
    const cart = getCart();
    expect(cart?.lines).toHaveLength(1);
    expect(cart?.lines[0].qty).toBe(5);
  });

  it("starts a fresh cart when the kitchen changes (one kitchen per order)", () => {
    addLine(ctx, line());
    addLine({ ...ctx, kitchenId: "k2", kitchenName: "Fatma's Kitchen" }, line({ menuItemId: "m2" }));
    const cart = getCart();
    expect(cart?.kitchenId).toBe("k2");
    expect(cart?.lines).toHaveLength(1);
    expect(cart?.lines[0].menuItemId).toBe("m2");
  });

  it("setQty updates an existing line", () => {
    addLine(ctx, line({ qty: 1 }));
    setQty("m1", 4);
    expect(getCart()?.lines[0].qty).toBe(4);
  });

  it("setQty removes the line at zero or below, clearing the cart if it was the last one", () => {
    addLine(ctx, line());
    setQty("m1", 0);
    expect(getCart()).toBeNull();
  });

  it("clearCart empties the cart", () => {
    addLine(ctx, line());
    clearCart();
    expect(getCart()).toBeNull();
    expect(cartCount()).toBe(0);
  });

  it("cartCount and cartSubtotalCents sum across lines", () => {
    addLine(ctx, line({ menuItemId: "m1", qty: 2, priceCents: 1000 }));
    addLine(ctx, line({ menuItemId: "m2", qty: 3, priceCents: 500 }));
    expect(cartCount()).toBe(5);
    expect(cartSubtotalCents()).toBe(2 * 1000 + 3 * 500);
  });

  it("money formats cents as a dollar string", () => {
    expect(money(0)).toBe("$0.00");
    expect(money(1234)).toBe("$12.34");
    expect(money(100)).toBe("$1.00");
  });

  it("subscribeCart fires on cart-changed and can unsubscribe", () => {
    const cb = vi.fn();
    const unsubscribe = subscribeCart(cb);
    addLine(ctx, line());
    expect(cb).toHaveBeenCalledTimes(1);
    unsubscribe();
    addLine(ctx, line({ qty: 1 }));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
