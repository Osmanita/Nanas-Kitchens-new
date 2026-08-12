import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearLocation, getLocation, saveLocation, subscribeLocation } from "./location";

const powell = { lat: 40.1578, lng: -83.0752, label: "Powell, OH" };

beforeEach(() => {
  localStorage.clear();
});

describe("location", () => {
  it("returns null when nothing is picked yet", () => {
    expect(getLocation()).toBeNull();
  });

  it("saves and reloads a picked location", () => {
    saveLocation(powell);
    expect(getLocation()).toEqual(powell);
  });

  it("overwrites the previous pick", () => {
    saveLocation(powell);
    const columbus = { lat: 39.9612, lng: -82.9988, label: "Columbus, OH" };
    saveLocation(columbus);
    expect(getLocation()).toEqual(columbus);
  });

  it("clearLocation removes the saved pick", () => {
    saveLocation(powell);
    clearLocation();
    expect(getLocation()).toBeNull();
  });

  it("ignores corrupted localStorage instead of throwing", () => {
    localStorage.setItem("location", "{not json");
    expect(getLocation()).toBeNull();
  });

  it("subscribeLocation fires on save/clear and can unsubscribe", () => {
    const cb = vi.fn();
    const unsubscribe = subscribeLocation(cb);
    saveLocation(powell);
    clearLocation();
    expect(cb).toHaveBeenCalledTimes(2);
    unsubscribe();
    saveLocation(powell);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
