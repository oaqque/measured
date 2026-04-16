import { describe, expect, it } from "vitest";
import { buildRouteSegments, getAvailableModes, getLegendItems } from "@/components/RouteMap";
import type { WorkoutRouteStreams } from "@/lib/workouts/schema";

describe("RouteMap helpers", () => {
  it("offers gradient mode when distance and altitude streams are available", () => {
    const routeStreams: WorkoutRouteStreams = {
      latlng: [
        [-33.87, 151.21],
        [-33.871, 151.211],
        [-33.872, 151.212],
      ],
      altitude: [12, 18, 15],
      distance: [0, 100, 200],
      heartrate: null,
      velocitySmooth: null,
      moving: null,
    };

    expect(getAvailableModes(routeStreams)).toEqual(["route", "elevation", "gradient"]);
  });

  it("colors gradient segments differently for climbs, flats, and descents", () => {
    const routeStreams: WorkoutRouteStreams = {
      latlng: [
        [-33.87, 151.21],
        [-33.871, 151.211],
        [-33.872, 151.212],
        [-33.873, 151.213],
        [-33.874, 151.214],
        [-33.875, 151.215],
        [-33.876, 151.216],
        [-33.877, 151.217],
      ],
      altitude: [0, 20, 40, 40, 40, 40, 20, 0],
      distance: [0, 100, 200, 300, 400, 500, 600, 700],
      heartrate: null,
      velocitySmooth: null,
      moving: null,
    };

    const segments = buildRouteSegments(routeStreams.latlng!, routeStreams, "gradient");

    expect(segments).toHaveLength(7);
    expect(segments[0]?.color).toBe("#991b1b");
    expect(segments[3]?.color).toBe("#64748b");
    expect(segments[6]?.color).toBe("#1e3a8a");
  });

  it("returns a dedicated legend for gradient mode", () => {
    expect(getLegendItems("gradient", null).map((item) => item.label)).toEqual([
      ">= 8% climb",
      "4% to < 8% climb",
      "1% to < 4% rise",
      "-1% to < 1% flat",
      "-4% to < -1% descent",
      "-8% to < -4% descent",
      "< -8% descent",
    ]);
  });
});
