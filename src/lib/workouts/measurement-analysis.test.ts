import { describe, expect, it } from "vitest";
import {
  buildAppleHealthMeasurementAnalysisSections,
  buildStravaMeasurementAnalysisSections,
} from "@/lib/workouts/measurement-analysis";

describe("measurement analysis helpers", () => {
  it("builds apple health heart-rate and cadence sections", () => {
    const sections = buildAppleHealthMeasurementAnalysisSections({
      activityId: "ah_test",
      startDate: "2026-04-08T00:34:09Z",
      elapsedTimeSeconds: 1800,
      series: [
        {
          key: "heartRate",
          label: "Heart Rate",
          unit: "bpm",
          kind: "line",
          section: "duringWorkout",
          sampleCount: 4,
          averageValue: 151.5,
          minValue: 145,
          maxValue: 160,
          totalValue: null,
          points: [
            { offsetSeconds: 0, value: 145 },
            { offsetSeconds: 600, value: 148 },
            { offsetSeconds: 1200, value: 155 },
            { offsetSeconds: 1790, value: 160 },
          ],
        },
        {
          key: "cadence",
          label: "Cadence",
          unit: "spm",
          kind: "line",
          section: "duringWorkout",
          sampleCount: 5,
          averageValue: 171.5,
          minValue: 90,
          maxValue: 176,
          totalValue: null,
          points: [
            { offsetSeconds: 60, value: 170 },
            { offsetSeconds: 480, value: 171 },
            { offsetSeconds: 920, value: 172 },
            { offsetSeconds: 1300, value: 176 },
            { offsetSeconds: 1790, value: 90 },
          ],
        },
      ],
    });

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({
      kind: "appleHealthMeasurement",
      measurement: "heartRate",
    });
    expect(sections[0]?.markdown).toContain("Average HR was `152.0 bpm`");
    expect(sections[0]?.markdown).toContain("shows clear late cardiovascular drift");
    expect(sections[1]).toMatchObject({
      kind: "appleHealthMeasurement",
      measurement: "cadence",
    });
    expect(sections[1]?.markdown).toContain("excluding `1` start-stop outlier");
    expect(sections[1]?.markdown).toContain("suggests turnover lifted rather than falling away");
  });

  it("builds strava pace, heart-rate, moving, and elevation sections", () => {
    const sections = buildStravaMeasurementAnalysisSections(
      {
        provider: "strava",
        activityId: "18021212059",
        sportType: "Run",
        startDate: "2026-04-08T00:34:09Z",
        actualDistance: "8.4 km",
        actualDistanceKm: 8,
        movingTimeSeconds: 2880,
        elapsedTimeSeconds: 2940,
        averageHeartrate: 154,
        maxHeartrate: 170,
        summaryPolyline: null,
        hasRouteStreams: true,
        routePath: "/generated/workout-routes/strava/18021212059.json",
        primaryImageUrl: null,
        source: null,
      },
      {
        latlng: null,
        altitude: [10, 14, 18, 21, 23, 24, 22, 19, 17],
        distance: [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000],
        heartrate: [145, 148, 150, 152, 154, 157, 159, 160, 162],
        velocitySmooth: [3.5, 3.5, 3.45, 3.45, 3.4, 3.35, 3.3, 3.25, 3.2],
        moving: [true, true, true, true, true, false, true, true, true],
      },
    );

    expect(sections.map((section) => section.measurement)).toEqual(["pace", "heartRate", "moving", "elevation"]);
    expect(sections[0]?.markdown).toContain("Strava moving pace averaged `6:00 /km`");
    expect(sections[1]?.markdown).toContain("`154.0 bpm` average");
    expect(sections[2]?.markdown).toContain("(98.0%)");
    expect(sections[3]?.markdown).toContain("most of the climbing landed earlier");
  });
});
