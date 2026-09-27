import { describe, expect, it } from "vitest";
import { kitchenDay, pickupDay, qualifyingOptions, MenuPoll } from "./polls";

describe("kitchen calendar and cooking rules", () => {
  it("uses the kitchen's tomorrow even when the buyer's date has rolled over", () => {
    const now = new Date("2026-09-27T01:00:00Z");
    expect(kitchenDay("America/New_York", 1, now)).toBe("2026-09-27");
    expect(kitchenDay("Europe/Istanbul", 1, now)).toBe("2026-09-28");
    expect(pickupDay("2026-09-27", "America/New_York", now)).toContain(
      "Tomorrow",
    );
    expect(
      kitchenDay("America/New_York", 1, new Date("2026-12-31T18:00:00Z")),
    ).toBe("2027-01-01");
  });
  it("counts people for winners and portions for other qualifying dishes", () => {
    const poll = {
      options: ["Manti", "Soup", "Sarma", "Rice"],
      tallies: [3, 1, 3, 1],
      portions: [3, 4, 3, 1],
      minimumPortions: 4,
    } as MenuPoll;
    expect(qualifyingOptions(poll)).toEqual([0, 1, 2]);
    expect(
      qualifyingOptions({
        ...poll,
        tallies: [0, 0, 0, 0],
        portions: [0, 0, 0, 0],
      }),
    ).toEqual([]);
  });
});
