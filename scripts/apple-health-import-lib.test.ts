import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { importAppleHealthSource } from "./apple-health-import-lib";

describe("importAppleHealthSource", () => {
  it("normalizes a bridge snapshot json", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-json-"));
    const snapshotPath = path.join(tempDir, "cache-export.json");

    await fs.writeFile(
      snapshotPath,
      JSON.stringify(
        {
          generatedAt: "2026-04-03T08:00:00Z",
          provider: "appleHealth",
          activities: {
            abc: {
              activityId: "abc",
              sportType: "run",
              startDate: "2026-04-03T06:00:00Z",
              distanceMeters: 5000,
              distanceKm: 5,
              movingTimeSeconds: 1500,
              elapsedTimeSeconds: 1510,
              averageHeartrate: 140,
              maxHeartrate: 168,
              hasStreams: true,
              routeStreams: {
                latlng: [
                  [-33.8, 151.2],
                  [-33.81, 151.21],
                ],
              },
              source: {
                name: "Workout",
                deviceModel: "Watch",
              },
            },
          },
          collections: {
            heartRate: {
              key: "heartRate",
              kind: "quantity",
              displayName: "Heart Rate",
              unit: "count/min",
              samples: [
                {
                  sampleId: "sample-1",
                  startDate: "2026-04-03T06:00:00Z",
                  endDate: "2026-04-03T06:00:05Z",
                  numericValue: 143,
                  categoryValue: null,
                  source: {
                    name: "Workout",
                  },
                  metadata: {
                    HKMetadataKeySyncIdentifier: "abc-1",
                  },
                },
              ],
            },
          },
          deletedActivityIds: [],
        },
        null,
        2,
      ),
      "utf8",
    );

    const imported = await importAppleHealthSource(snapshotPath);
    expect(imported.snapshot.provider).toBe("appleHealth");
    expect(imported.snapshot.activities.abc.hasStreams).toBe(true);
    expect(imported.snapshot.activities.abc.routeStreams?.latlng?.length).toBe(2);
    expect(imported.snapshot.collections.heartRate?.samples).toHaveLength(1);
    expect(imported.snapshot.collections.heartRate?.samples[0]?.metadata?.HKMetadataKeySyncIdentifier).toBe("abc-1");

    await fs.rm(tempDir, { force: true, recursive: true });
  });

  it("imports workouts and routes from an Apple Health export.xml bundle", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "measured-apple-health-xml-"));
    const routeDir = path.join(tempDir, "workout-routes");
    const workoutId = "2E5A1E76-6C98-4B89-8D3B-4B0A45D8C9E1";

    await fs.mkdir(routeDir, { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "export.xml"),
      [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<HealthData>",
        `<Workout uuid="${workoutId}" workoutActivityType="HKWorkoutActivityTypeRunning" startDate="2026-04-02 07:22:00 +1100" endDate="2026-04-02 08:06:48 +1100" duration="44.8" durationUnit="min" totalDistance="8.043" totalDistanceUnit="km" sourceName="Workout" device="name:Apple Watch, model:Watch" />`,
        "</HealthData>",
      ].join(""),
      "utf8",
    );
    await fs.writeFile(
      path.join(routeDir, `route_${workoutId}.gpx`),
      [
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
        "<gpx>",
        "<trk><trkseg>",
        "<trkpt lat=\"-33.8700\" lon=\"151.2100\"><ele>14.2</ele><time>2026-04-01T20:22:00Z</time></trkpt>",
        "<trkpt lat=\"-33.8710\" lon=\"151.2120\"><ele>14.6</ele><time>2026-04-01T20:22:10Z</time></trkpt>",
        "<trkpt lat=\"-33.8720\" lon=\"151.2140\"><ele>15.0</ele><time>2026-04-01T20:22:20Z</time></trkpt>",
        "</trkseg></trk>",
        "</gpx>",
      ].join(""),
      "utf8",
    );

    const imported = await importAppleHealthSource(tempDir);
    const activity = imported.snapshot.activities[workoutId];

    expect(activity).toBeDefined();
    expect(activity.sportType).toBe("run");
    expect(activity.hasStreams).toBe(true);
    expect(activity.routeStreams?.latlng?.length).toBe(3);
    expect(activity.summaryPolyline).not.toBeNull();
    expect(imported.manifest.routeCount).toBe(1);

    await fs.rm(tempDir, { force: true, recursive: true });
  });
});
