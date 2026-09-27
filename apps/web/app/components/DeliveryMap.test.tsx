import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import DeliveryMap from "./DeliveryMap";

vi.mock("next/dynamic", () => ({ default: () => function Map({ center, onTilesLoaded, onTilesError }: {
  center: { lat:number; lng:number }; onTilesLoaded: () => void; onTilesError: () => void;
}) { return <div data-testid="map" data-lat={center.lat} data-lng={center.lng}>
  <button onClick={onTilesLoaded}>Tiles loaded</button><button onClick={onTilesError}>Tiles failed</button>
</div>; } }));
afterEach(() => vi.unstubAllGlobals());

describe("delivery map", () => {
  it("uses the selected address pin directly, even when geocoding is unavailable", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    render(<DeliveryMap address="Selected home" location={{label:"Selected home",lat:40.1,lng:-83.2}} />);
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("map")).toHaveAttribute("data-lat", "40.1");
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByText("Tiles loaded"));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("does not display the old pin when the delivery address changes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([{lat:"41",lon:"-82"}]))));
    const {rerender} = render(<DeliveryMap address="First home" location={{label:"First home",lat:40,lng:-83}} />);
    rerender(<DeliveryMap address="New home" location={{label:"First home",lat:40,lng:-83}} />);
    expect(screen.queryByTestId("map")).not.toBeInTheDocument();
    await act(async () => {});
    expect(screen.getByTestId("map")).toHaveAttribute("data-lat", "41");
  });
  it("shows an honest unavailable state and retains the address link when tiles fail", () => {
    render(<DeliveryMap address="My home" location={{label:"My home",lat:40,lng:-83}} />);
    fireEvent.click(screen.getByText("Tiles failed"));
    expect(screen.getByRole("status")).toHaveTextContent("Map tiles could not load");
    expect(screen.getByRole("link", {name:"Open map"})).toHaveAttribute("href", expect.stringContaining("mlat=40"));
  });
});
