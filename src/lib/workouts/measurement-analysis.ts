import type {
  AppleHealthWorkoutMeasurements,
  WorkoutNoteAnalysisAppleHealthMeasurementSection,
  WorkoutNoteAnalysisStravaMeasurementSection,
  WorkoutRouteStreams,
  WorkoutSourceSummary,
} from "./schema";

export function buildAppleHealthMeasurementAnalysisSections(
  measurements: AppleHealthWorkoutMeasurements,
): WorkoutNoteAnalysisAppleHealthMeasurementSection[] {
  const sections: WorkoutNoteAnalysisAppleHealthMeasurementSection[] = [];
  const heartRateSeries = findAppleHealthSeries(measurements, "heartRate");
  if (heartRateSeries) {
    const markdown = buildAppleHealthHeartRateMarkdown(measurements, heartRateSeries.points);
    if (markdown) {
      sections.push({
        kind: "appleHealthMeasurement",
        measurement: "heartRate",
        markdown,
      });
    }
  }

  const cadenceSeries = findAppleHealthSeries(measurements, "cadence");
  if (cadenceSeries) {
    const markdown = buildAppleHealthCadenceMarkdown(measurements, cadenceSeries.points);
    if (markdown) {
      sections.push({
        kind: "appleHealthMeasurement",
        measurement: "cadence",
        markdown,
      });
    }
  }

  return sections;
}

export function buildStravaMeasurementAnalysisSections(
  summary: WorkoutSourceSummary,
  routeStreams: WorkoutRouteStreams | null,
): WorkoutNoteAnalysisStravaMeasurementSection[] {
  const sections: WorkoutNoteAnalysisStravaMeasurementSection[] = [];

  const paceMarkdown = buildStravaPaceMarkdown(summary, routeStreams);
  if (paceMarkdown) {
    sections.push({
      kind: "stravaMeasurement",
      measurement: "pace",
      markdown: paceMarkdown,
    });
  }

  const heartRateMarkdown = buildStravaHeartRateMarkdown(summary, routeStreams);
  if (heartRateMarkdown) {
    sections.push({
      kind: "stravaMeasurement",
      measurement: "heartRate",
      markdown: heartRateMarkdown,
    });
  }

  const movingMarkdown = buildStravaMovingMarkdown(summary, routeStreams);
  if (movingMarkdown) {
    sections.push({
      kind: "stravaMeasurement",
      measurement: "moving",
      markdown: movingMarkdown,
    });
  }

  const elevationMarkdown = buildStravaElevationMarkdown(summary, routeStreams);
  if (elevationMarkdown) {
    sections.push({
      kind: "stravaMeasurement",
      measurement: "elevation",
      markdown: elevationMarkdown,
    });
  }

  return sections;
}

type AppleHealthPoint = AppleHealthWorkoutMeasurements["series"][number]["points"][number];

function buildAppleHealthHeartRateMarkdown(measurements: AppleHealthWorkoutMeasurements, points: AppleHealthPoint[]) {
  const filteredPoints = sanitizeAppleHealthPoints(points);
  if (filteredPoints.length === 0) {
    return "";
  }

  const averageValue = average(filteredPoints.map((point) => point.value));
  const min = Math.min(...filteredPoints.map((point) => point.value));
  const max = Math.max(...filteredPoints.map((point) => point.value));
  const split = splitAppleHealthPoints(filteredPoints, measurements.elapsedTimeSeconds);
  const lines = [
    `- Apple Health recorded \`${filteredPoints.length}\` during-run heart-rate samples. Average HR was \`${formatNumber(
      averageValue,
      1,
    )} bpm\`, ranging from \`${formatNumber(min, 1)}\` to \`${formatNumber(max, 1)} bpm\`.`,
  ];

  if (split) {
    const drift = split.secondHalfAverage - split.firstHalfAverage;
    lines.push(
      `- First-half average HR was \`${formatNumber(split.firstHalfAverage, 1)} bpm\` and second-half average HR was \`${formatNumber(
        split.secondHalfAverage,
        1,
      )} bpm\` (${formatSignedNumber(drift, 1)} bpm), which ${describeHeartRateDrift(drift)}.`,
    );
  }

  return lines.join("\n");
}

function buildAppleHealthCadenceMarkdown(measurements: AppleHealthWorkoutMeasurements, points: AppleHealthPoint[]) {
  const filteredPoints = sanitizeAppleHealthPoints(points).filter((point) => point.value >= 100 && point.value <= 230);
  if (filteredPoints.length === 0) {
    return "";
  }

  const averageCadence = average(filteredPoints.map((point) => point.value));
  const minCadence = Math.min(...filteredPoints.map((point) => point.value));
  const maxCadence = Math.max(...filteredPoints.map((point) => point.value));
  const excludedCount = points.length - filteredPoints.length;
  const split = splitAppleHealthPoints(filteredPoints, measurements.elapsedTimeSeconds);
  const rangeSentence =
    excludedCount > 0
      ? ` after excluding \`${excludedCount}\` start-stop outlier${excludedCount === 1 ? "" : "s"} below \`100 spm\``
      : "";
  const lines = [
    `- Apple Health cadence averaged \`${formatNumber(averageCadence, 1)} spm\`, with a working range of \`${formatNumber(
      minCadence,
      1,
    )}\` to \`${formatNumber(maxCadence, 1)} spm\`${rangeSentence}.`,
  ];

  if (split) {
    const cadenceChange = split.secondHalfAverage - split.firstHalfAverage;
    lines.push(
      `- First-half cadence averaged \`${formatNumber(split.firstHalfAverage, 1)} spm\` and second-half cadence averaged \`${formatNumber(
        split.secondHalfAverage,
        1,
      )} spm\` (${formatSignedNumber(cadenceChange, 1)} spm), which ${describeCadenceChange(cadenceChange)}.`,
    );
  }

  return lines.join("\n");
}

function buildStravaPaceMarkdown(summary: WorkoutSourceSummary, routeStreams: WorkoutRouteStreams | null) {
  if (!summary.actualDistanceKm || !summary.movingTimeSeconds) {
    return "";
  }

  const overallPaceSecondsPerKm = summary.movingTimeSeconds / summary.actualDistanceKm;
  const split = estimateStravaPaceSplit(summary, routeStreams);
  const lines = [
    `- Strava moving pace averaged \`${formatPace(overallPaceSecondsPerKm)} /km\` across \`${formatNumber(
      summary.actualDistanceKm,
      3,
    )} km\` in \`${formatDuration(summary.movingTimeSeconds)}\` moving time.`,
  ];

  if (split) {
    const paceDeltaSeconds = split.secondHalfPaceSecondsPerKm - split.firstHalfPaceSecondsPerKm;
    lines.push(
      `- Estimated first-half moving pace was \`${formatPace(split.firstHalfPaceSecondsPerKm)} /km\` and second-half pace was \`${formatPace(
        split.secondHalfPaceSecondsPerKm,
      )} /km\` (${formatSignedSeconds(Math.round(paceDeltaSeconds))} s/km), so ${describePaceChange(
        paceDeltaSeconds,
      )}.`,
    );
  }

  return lines.join("\n");
}

function buildStravaHeartRateMarkdown(summary: WorkoutSourceSummary, routeStreams: WorkoutRouteStreams | null) {
  const points = buildDistanceAnnotatedSeries(routeStreams?.distance ?? null, routeStreams?.heartrate ?? null);
  if (points.length === 0 && summary.averageHeartrate === null && summary.maxHeartrate === null) {
    return "";
  }

  const overallAverage = summary.averageHeartrate ?? average(points.map((point) => point.value));
  const overallMax = summary.maxHeartrate ?? max(points.map((point) => point.value));
  const split = splitDistanceAnnotatedSeries(points);
  const lines = [
    `- Strava summary HR came in at \`${formatNullableNumber(overallAverage, 1)} bpm\` average and \`${formatNullableNumber(
      overallMax,
      0,
    )} bpm\` max.`,
  ];

  if (split) {
    const drift = split.secondHalfAverage - split.firstHalfAverage;
    lines.push(
      `- Distance-split HR averaged \`${formatNumber(split.firstHalfAverage, 1)} bpm\` in the first half and \`${formatNumber(
        split.secondHalfAverage,
        1,
      )} bpm\` in the second (${formatSignedNumber(drift, 1)} bpm), which ${describeHeartRateDrift(drift)}.`,
    );
  }

  return lines.join("\n");
}

function buildStravaMovingMarkdown(summary: WorkoutSourceSummary, routeStreams: WorkoutRouteStreams | null) {
  if (!summary.movingTimeSeconds || !summary.elapsedTimeSeconds) {
    return "";
  }

  const movingRatio = summary.movingTimeSeconds / summary.elapsedTimeSeconds;
  const lines = [
    `- Moving time was \`${formatDuration(summary.movingTimeSeconds)}\` out of \`${formatDuration(
      summary.elapsedTimeSeconds,
    )}\` elapsed (${formatPercent(movingRatio)}), which ${describeMovingRatio(movingRatio)}.`,
  ];

  const movingStats = summarizeMovingFlags(routeStreams?.moving ?? null);
  if (movingStats) {
    lines.push(
      `- The downsampled moving stream shows \`${movingStats.stopSegments}\` stop segment${
        movingStats.stopSegments === 1 ? "" : "s"
      } and \`${formatPercent(movingStats.stationaryShare)}\` stationary samples, so ${describeMovingStream(
        movingStats.stationaryShare,
        movingStats.stopSegments,
      )}.`,
    );
  }

  return lines.join("\n");
}

function buildStravaElevationMarkdown(summary: WorkoutSourceSummary, routeStreams: WorkoutRouteStreams | null) {
  const altitude = sanitizeNumberArray(routeStreams?.altitude ?? null);
  const distance = sanitizeNumberArray(routeStreams?.distance ?? null);
  const computedGain = estimatePositiveElevationGain(altitude);
  if (altitude.length === 0 && summary.actualDistanceKm === null && computedGain === null) {
    return "";
  }

  const gainMeters = chooseElevationGain(computedGain);
  const lines: string[] = [];
  if (gainMeters !== null && altitude.length > 0) {
    lines.push(
      `- Strava logged about \`${formatNumber(gainMeters, 1)} m\` of climbing, with altitude moving between roughly \`${formatNumber(
        Math.min(...altitude),
        1,
      )} m\` and \`${formatNumber(Math.max(...altitude), 1)} m\`.`,
    );
  } else if (gainMeters !== null) {
    lines.push(`- Strava logged about \`${formatNumber(gainMeters, 1)} m\` of climbing for this run.`);
  } else if (altitude.length > 0) {
    lines.push(
      `- Altitude ranged from roughly \`${formatNumber(Math.min(...altitude), 1)} m\` to \`${formatNumber(
        Math.max(...altitude),
        1,
      )} m\` across the route.`,
    );
  }

  const split = splitElevationGainByDistance(distance, altitude);
  if (split) {
    lines.push(
      `- Estimated climbing was \`${formatNumber(split.firstHalfGain, 1)} m\` in the first half and \`${formatNumber(
        split.secondHalfGain,
        1,
      )} m\` in the second, so ${describeElevationDistribution(split.firstHalfGain, split.secondHalfGain)}.`,
    );
  }

  return lines.join("\n");
}

function findAppleHealthSeries(
  measurements: AppleHealthWorkoutMeasurements,
  key: "heartRate" | "cadence",
) {
  return measurements.series.find((series) => series.key === key && series.section === "duringWorkout") ?? null;
}

function sanitizeAppleHealthPoints(points: AppleHealthPoint[]) {
  return points
    .filter((point) => Number.isFinite(point.offsetSeconds) && Number.isFinite(point.value))
    .sort((left, right) => left.offsetSeconds - right.offsetSeconds);
}

function splitAppleHealthPoints(points: AppleHealthPoint[], elapsedTimeSeconds: number | null) {
  if (points.length < 4) {
    return null;
  }

  const lastOffset = points[points.length - 1]?.offsetSeconds ?? 0;
  const halfSeconds = Math.max(1, (elapsedTimeSeconds ?? lastOffset) / 2);
  const firstHalf = points.filter((point) => point.offsetSeconds <= halfSeconds);
  const secondHalf = points.filter((point) => point.offsetSeconds > halfSeconds);
  if (firstHalf.length === 0 || secondHalf.length === 0) {
    return null;
  }

  return {
    firstHalfAverage: average(firstHalf.map((point) => point.value)),
    secondHalfAverage: average(secondHalf.map((point) => point.value)),
  };
}

function estimateStravaPaceSplit(summary: WorkoutSourceSummary, routeStreams: WorkoutRouteStreams | null) {
  const distance = sanitizeNumberArray(routeStreams?.distance ?? null);
  const velocity = sanitizeNumberArray(routeStreams?.velocitySmooth ?? null);
  if (distance.length < 2 || velocity.length < 2 || !summary.actualDistanceKm || !summary.movingTimeSeconds) {
    return null;
  }

  const maxIndex = Math.min(distance.length, velocity.length);
  const totalDistanceMeters = Math.max(distance[maxIndex - 1] ?? 0, summary.actualDistanceKm * 1000);
  if (totalDistanceMeters <= 0) {
    return null;
  }

  const halfDistanceMeters = totalDistanceMeters / 2;
  let firstHalfDistanceMeters = 0;
  let secondHalfDistanceMeters = 0;
  let firstHalfTimeSeconds = 0;
  let secondHalfTimeSeconds = 0;

  for (let index = 1; index < maxIndex; index += 1) {
    const previousDistance = distance[index - 1] ?? 0;
    const currentDistance = distance[index] ?? 0;
    const deltaDistance = currentDistance - previousDistance;
    if (!Number.isFinite(deltaDistance) || deltaDistance <= 0) {
      continue;
    }

    const speedSamples = [velocity[index - 1], velocity[index]].filter((sample): sample is number => sample > 0);
    if (speedSamples.length === 0) {
      continue;
    }

    const segmentSpeed = average(speedSamples);
    const segmentTime = deltaDistance / segmentSpeed;
    const midpointDistance = previousDistance + deltaDistance / 2;
    if (midpointDistance <= halfDistanceMeters) {
      firstHalfDistanceMeters += deltaDistance;
      firstHalfTimeSeconds += segmentTime;
    } else {
      secondHalfDistanceMeters += deltaDistance;
      secondHalfTimeSeconds += segmentTime;
    }
  }

  if (
    firstHalfDistanceMeters <= 0 ||
    secondHalfDistanceMeters <= 0 ||
    firstHalfTimeSeconds <= 0 ||
    secondHalfTimeSeconds <= 0
  ) {
    return null;
  }

  const estimatedMovingTime = firstHalfTimeSeconds + secondHalfTimeSeconds;
  const timeScale = estimatedMovingTime > 0 ? summary.movingTimeSeconds / estimatedMovingTime : 1;
  const scaledFirstHalfTimeSeconds = firstHalfTimeSeconds * timeScale;
  const scaledSecondHalfTimeSeconds = secondHalfTimeSeconds * timeScale;

  return {
    firstHalfPaceSecondsPerKm: scaledFirstHalfTimeSeconds / (firstHalfDistanceMeters / 1000),
    secondHalfPaceSecondsPerKm: scaledSecondHalfTimeSeconds / (secondHalfDistanceMeters / 1000),
  };
}

function buildDistanceAnnotatedSeries(distanceInput: number[] | null, valuesInput: number[] | null) {
  const distance = sanitizeNumberArray(distanceInput);
  const values = sanitizeNumberArray(valuesInput);
  const maxIndex = Math.min(distance.length, values.length);
  const points: Array<{ distanceMeters: number; value: number }> = [];

  for (let index = 0; index < maxIndex; index += 1) {
    const distanceMeters = distance[index];
    const value = values[index];
    if (!Number.isFinite(distanceMeters) || !Number.isFinite(value)) {
      continue;
    }

    points.push({ distanceMeters, value });
  }

  return points;
}

function splitDistanceAnnotatedSeries(points: Array<{ distanceMeters: number; value: number }>) {
  if (points.length < 4) {
    return null;
  }

  const totalDistanceMeters = points[points.length - 1]?.distanceMeters ?? 0;
  if (totalDistanceMeters <= 0) {
    return null;
  }

  const halfDistanceMeters = totalDistanceMeters / 2;
  const firstHalf = points.filter((point) => point.distanceMeters <= halfDistanceMeters);
  const secondHalf = points.filter((point) => point.distanceMeters > halfDistanceMeters);
  if (firstHalf.length === 0 || secondHalf.length === 0) {
    return null;
  }

  return {
    firstHalfAverage: average(firstHalf.map((point) => point.value)),
    secondHalfAverage: average(secondHalf.map((point) => point.value)),
  };
}

function summarizeMovingFlags(flagsInput: boolean[] | null) {
  if (!Array.isArray(flagsInput) || flagsInput.length === 0) {
    return null;
  }

  let stationaryCount = 0;
  let stopSegments = 0;
  let previousMoving = true;
  for (const flag of flagsInput) {
    if (!flag) {
      stationaryCount += 1;
      if (previousMoving) {
        stopSegments += 1;
      }
    }
    previousMoving = flag;
  }

  return {
    stationaryShare: stationaryCount / flagsInput.length,
    stopSegments,
  };
}

function estimatePositiveElevationGain(altitude: number[]) {
  if (altitude.length < 2) {
    return null;
  }

  let gainMeters = 0;
  for (let index = 1; index < altitude.length; index += 1) {
    const gain = altitude[index]! - altitude[index - 1]!;
    if (gain > 0) {
      gainMeters += gain;
    }
  }

  return gainMeters;
}

function splitElevationGainByDistance(distance: number[], altitude: number[]) {
  const maxIndex = Math.min(distance.length, altitude.length);
  if (maxIndex < 2) {
    return null;
  }

  const totalDistanceMeters = distance[maxIndex - 1] ?? 0;
  if (totalDistanceMeters <= 0) {
    return null;
  }

  const halfDistanceMeters = totalDistanceMeters / 2;
  let firstHalfGain = 0;
  let secondHalfGain = 0;
  for (let index = 1; index < maxIndex; index += 1) {
    const gain = (altitude[index] ?? 0) - (altitude[index - 1] ?? 0);
    if (gain <= 0) {
      continue;
    }

    const midpointDistance = ((distance[index] ?? 0) + (distance[index - 1] ?? 0)) / 2;
    if (midpointDistance <= halfDistanceMeters) {
      firstHalfGain += gain;
    } else {
      secondHalfGain += gain;
    }
  }

  return {
    firstHalfGain,
    secondHalfGain,
  };
}

function chooseElevationGain(computedGain: number | null) {
  if (computedGain !== null && computedGain > 0) {
    return computedGain;
  }

  return null;
}

function sanitizeNumberArray(input: number[] | null) {
  if (!Array.isArray(input)) {
    return [];
  }

  return input.filter((value): value is number => Number.isFinite(value));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function max(values: number[]) {
  return values.reduce((highest, value) => (value > highest ? value : highest), Number.NEGATIVE_INFINITY);
}

function formatNumber(value: number, fractionDigits: number) {
  return value.toFixed(fractionDigits);
}

function formatNullableNumber(value: number | null, fractionDigits: number) {
  if (value === null || Number.isNaN(value)) {
    return "n/a";
  }

  return formatNumber(value, fractionDigits);
}

function formatSignedNumber(value: number, fractionDigits: number) {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(fractionDigits)}`;
}

function formatDuration(totalSeconds: number) {
  const roundedSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(roundedSeconds / 3600);
  const minutes = Math.floor((roundedSeconds % 3600) / 60);
  const seconds = roundedSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatPace(secondsPerKm: number) {
  const rounded = Math.max(0, Math.round(secondsPerKm));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatSignedSeconds(seconds: number) {
  const prefix = seconds > 0 ? "+" : "";
  return `${prefix}${seconds}`;
}

function formatPercent(ratio: number) {
  return `${(ratio * 100).toFixed(1)}%`;
}

function describeHeartRateDrift(drift: number) {
  if (drift >= 8) {
    return "shows clear late cardiovascular drift";
  }

  if (drift >= 3) {
    return "shows a modest late rise in aerobic cost";
  }

  if (drift <= -3) {
    return "came down late rather than drifting upward";
  }

  return "reads as broadly stable across the run";
}

function describeCadenceChange(change: number) {
  if (change <= -3) {
    return "suggests some late turnover fade";
  }

  if (change >= 3) {
    return "suggests turnover lifted rather than falling away";
  }

  return "looks mechanically stable";
}

function describePaceChange(changeSecondsPerKm: number) {
  if (changeSecondsPerKm >= 15) {
    return "pace faded meaningfully in the back half";
  }

  if (changeSecondsPerKm >= 5) {
    return "pace eased a little late";
  }

  if (changeSecondsPerKm <= -5) {
    return "pace picked up through the second half";
  }

  return "pace stayed broadly even";
}

function describeMovingRatio(ratio: number) {
  if (ratio >= 0.985) {
    return "kept stoppage cost negligible";
  }

  if (ratio >= 0.95) {
    return "shows only minor interruption cost";
  }

  if (ratio >= 0.9) {
    return "shows some stop-start interruption";
  }

  return "shows a materially stop-start session";
}

function describeMovingStream(stationaryShare: number, stopSegments: number) {
  if (stationaryShare <= 0.02 && stopSegments <= 2) {
    return "the run stayed very continuous";
  }

  if (stationaryShare <= 0.08) {
    return "the run was mostly continuous with a few interruptions";
  }

  return "the route included repeated interruptions";
}

function describeElevationDistribution(firstHalfGain: number, secondHalfGain: number) {
  if (firstHalfGain <= 0 && secondHalfGain <= 0) {
    return "the route was effectively flat";
  }

  if (firstHalfGain > secondHalfGain * 1.2) {
    return "most of the climbing landed earlier";
  }

  if (secondHalfGain > firstHalfGain * 1.2) {
    return "most of the climbing landed later";
  }

  return "the climbing load was split fairly evenly";
}
