import { describe, expect, it } from "vitest";
import {
  convertLegacyMarkdownWorkoutNote,
  parseWorkoutNoteSourceDocument,
  renderWorkoutNoteSourceDocumentBody,
} from "@/lib/workouts/source-note";

describe("workout source note documents", () => {
  it("converts legacy markdown notes into structured analysis sections", () => {
    const document = convertLegacyMarkdownWorkoutNote(
      "2026-04-08 8 km Easy Aerobic Run.md",
      `---
title: 8 km Easy Aerobic Run
allDay: true
type: single
date: '2026-04-08'
completed: 2026-04-08T00:34:09.000Z
eventType: run
expectedDistance: 8 km
activityRefs:
  strava: '18021212059'
  appleHealth: D27B55F8-0C31-4EA6-93AA-319919312399
---
## Program

- 8 km easy aerobic run

## Analysis

### Intention

- Stayed aerobic.

### Apple Health Heart Rate

- HR sat lower than Tuesday.

### Personal Note

- Sun was out.
`,
    );

    expect(document.sections).toEqual([
      {
        kind: "program",
        markdown: "- 8 km easy aerobic run",
      },
      {
        kind: "analysis",
        sections: [
          { kind: "intention", markdown: "- Stayed aerobic." },
          {
            kind: "appleHealthMeasurement",
            measurement: "heartRate",
            markdown: "- HR sat lower than Tuesday.",
          },
          { kind: "personalNote", markdown: "- Sun was out." },
        ],
      },
    ]);
  });

  it("renders structured measurement analysis sections back to markdown", () => {
    const document = parseWorkoutNoteSourceDocument(
      "2026-04-08 8 km Easy Aerobic Run.json",
      JSON.stringify(
        {
          schemaVersion: 1,
          title: "8 km Easy Aerobic Run",
          allDay: true,
          type: "single",
          date: "2026-04-08",
          completed: "2026-04-08T00:34:09.000Z",
          eventType: "run",
          sections: [
            {
              kind: "program",
              markdown: "- 8 km easy aerobic run",
            },
            {
              kind: "analysis",
              sections: [
                { kind: "intention", markdown: "- Stayed aerobic." },
                {
                  kind: "appleHealthMeasurement",
                  measurement: "cadence",
                  markdown: "- Cadence stayed stable.",
                },
                {
                  kind: "stravaMeasurement",
                  measurement: "pace",
                  markdown: "- Pace drifted late.",
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
    );

    expect(renderWorkoutNoteSourceDocumentBody(document)).toBe(`## Program

- 8 km easy aerobic run

## Analysis

### Intention

- Stayed aerobic.

### Apple Health Cadence

- Cadence stayed stable.

### Strava Pace

- Pace drifted late.`);
  });

  it("parses optional media embeds from source documents", () => {
    const document = parseWorkoutNoteSourceDocument(
      "2026-04-17 5 km Easy Recovery Run.json",
      JSON.stringify(
        {
          schemaVersion: 1,
          title: "5 km Easy Recovery Run",
          allDay: true,
          type: "single",
          date: "2026-04-17",
          completed: false,
          eventType: "run",
          media: {
            provider: "spotify",
            url: "https://open.spotify.com/track/2TpxZ7JUBn3uw46aR7qd6V",
            title: "Recovery playlist",
          },
          sections: [
            {
              kind: "program",
              markdown: "- 5 km easy recovery run",
            },
          ],
        },
        null,
        2,
      ),
    );

    expect(document.media).toEqual({
      provider: "spotify",
      url: "https://open.spotify.com/track/2TpxZ7JUBn3uw46aR7qd6V",
      title: "Recovery playlist",
    });
  });
});
