import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface AppleHealthActivityExport {
  activityId: string;
  sportType: string | null;
  startDate: string | null;
  distanceMeters: number | null;
  distanceKm: number | null;
  movingTimeSeconds: number | null;
  elapsedTimeSeconds: number | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  summaryPolyline: string | null;
  detailFetchedAt: string | null;
  hasStreams: boolean;
  routeStreams: {
    latlng: Array<[number, number]> | null;
    altitude: number[] | null;
    distance: number[] | null;
    heartrate: number[] | null;
    velocitySmooth: number[] | null;
    moving: boolean[] | null;
  } | null;
  source: {
    bundleIdentifier: string | null;
    name: string | null;
    deviceName: string | null;
    deviceModel: string | null;
  } | null;
}

export interface AppleHealthCollectionSampleExport {
  sampleId: string;
  startDate: string | null;
  endDate: string | null;
  numericValue: number | null;
  categoryValue: number | null;
  textValue: string | null;
  payload: Record<string, string> | null;
  source: {
    bundleIdentifier: string | null;
    name: string | null;
    deviceName: string | null;
    deviceModel: string | null;
  } | null;
  metadata: Record<string, string> | null;
}

export interface AppleHealthCollectionExport {
  key: string;
  kind: string;
  displayName: string;
  unit: string | null;
  objectTypeIdentifier: string | null;
  queryStrategy: string | null;
  requiresPerObjectAuthorization: boolean | null;
  samples: AppleHealthCollectionSampleExport[];
}

export interface AppleHealthCacheExport {
  generatedAt: string;
  provider: "appleHealth";
  registryGeneratedAt?: string | null;
  activities: Record<string, AppleHealthActivityExport>;
  collections: Record<string, AppleHealthCollectionExport>;
  deletedActivityIds: string[];
}

export interface AppleHealthImportManifest {
  importedAt: string;
  importKind: "normalizedSnapshot" | "appleHealthXml";
  sourcePath: string;
  workoutCount: number;
  routeCount: number;
  warnings: string[];
}

export async function importAppleHealthSource(sourcePath: string): Promise<{
  manifest: AppleHealthImportManifest;
  snapshot: AppleHealthCacheExport;
}> {
  const resolvedPath = path.resolve(sourcePath);
  const stats = await fs.stat(resolvedPath);
  const importedAt = new Date().toISOString();

  const normalizedSnapshotPath = stats.isDirectory()
    ? await resolveExistingPath([
        path.join(resolvedPath, "cache-export.json"),
        path.join(resolvedPath, "apple-health-export.json"),
      ])
    : resolvedPath.endsWith(".json")
      ? resolvedPath
      : null;

  if (normalizedSnapshotPath) {
    const fileContent = await fs.readFile(normalizedSnapshotPath, "utf8");
    const snapshot = normalizeBridgeSnapshot(JSON.parse(fileContent) as Record<string, unknown>);
    return {
      manifest: {
        importedAt,
        importKind: "normalizedSnapshot",
        sourcePath: normalizedSnapshotPath,
        workoutCount: Object.keys(snapshot.activities).length,
        routeCount: Object.values(snapshot.activities).filter((activity) => activity.hasStreams).length,
        warnings: [],
      },
      snapshot,
    };
  }

  const xmlPath = stats.isDirectory()
    ? await resolveExistingPath([
        path.join(resolvedPath, "export.xml"),
        path.join(resolvedPath, "apple_health_export", "export.xml"),
      ])
    : resolvedPath.endsWith(".xml")
      ? resolvedPath
      : null;

  if (!xmlPath) {
    throw new Error(
      `Unsupported Apple Health import source: ${resolvedPath}. Expected a normalized snapshot JSON or an export.xml bundle.`,
    );
  }

  const routeDirectory = stats.isDirectory()
    ? await resolveExistingPath([
        path.join(resolvedPath, "workout-routes"),
        path.join(resolvedPath, "apple_health_export", "workout-routes"),
      ])
    : null;
  const { activities, warnings } = await parseAppleHealthXmlExport(xmlPath, routeDirectory);
  const snapshot: AppleHealthCacheExport = {
    generatedAt: importedAt,
    provider: "appleHealth",
    activities,
    collections: {},
    deletedActivityIds: [],
  };

  return {
    manifest: {
      importedAt,
      importKind: "appleHealthXml",
      sourcePath: resolvedPath,
      workoutCount: Object.keys(activities).length,
      routeCount: Object.values(activities).filter((activity) => activity.hasStreams).length,
      warnings,
    },
    snapshot,
  };
}

async function parseAppleHealthXmlExport(xmlPath: string, routeDirectory: string | null) {
  const activities: Record<string, AppleHealthActivityExport> = {};
  const warnings: string[] = [];

  for await (const workoutAttributes of streamAppleHealthWorkoutAttributes(xmlPath)) {
    const attributes = parseXmlAttributes(workoutAttributes);
    const activityId = attributes.uuid ?? attributes.UUID ?? null;
    if (!activityId) {
      warnings.push("Skipped workout without uuid attribute");
      continue;
    }

    const startDate = normalizeAppleDate(attributes.startDate ?? attributes.creationDate ?? null);
    const endDate = normalizeAppleDate(attributes.endDate ?? null);
    const elapsedTimeSeconds =
      normalizeDurationSeconds(attributes.duration ?? null, attributes.durationUnit ?? null) ??
      deriveElapsedTimeSeconds(startDate, endDate);
    const distanceMeters = normalizeDistanceMeters(attributes.totalDistance ?? null, attributes.totalDistanceUnit ?? null);
    const routeStreams = null;
    const source = normalizeSource(attributes);

    activities[activityId] = {
      activityId,
      sportType: normalizeWorkoutActivityType(attributes.workoutActivityType ?? null),
      startDate,
      distanceMeters,
      distanceKm: distanceMeters === null ? null : distanceMeters / 1000,
      movingTimeSeconds: elapsedTimeSeconds,
      elapsedTimeSeconds,
      averageHeartrate: null,
      maxHeartrate: null,
      summaryPolyline: null,
      detailFetchedAt: new Date().toISOString(),
      hasStreams: false,
      routeStreams,
      source,
    };
  }

  if (routeDirectory) {
    const routeFiles = await listFilesRecursively(routeDirectory, ".gpx");
    const parsedRoutes = await Promise.all(
      routeFiles.map(async (routePath) => ({
        routePath,
        route: await parseGpxRoute(routePath),
      })),
    );
    const availableRouteEntries = parsedRoutes.filter((entry) => entry.route !== null);
    const matchedRouteIds = new Set<string>();

    for (const entry of availableRouteEntries) {
      const directMatch = Object.keys(activities).find((activityId) =>
        path.basename(entry.routePath).toLowerCase().includes(activityId.toLowerCase()),
      );

      if (directMatch) {
        const route = entry.route;
        if (!route) {
          continue;
        }
        attachRouteToActivity(activities[directMatch], route);
        matchedRouteIds.add(directMatch);
      }
    }

    for (const entry of availableRouteEntries) {
      const route = entry.route;
      const firstPointTime = route?.startTime;
      if (!route || !firstPointTime) {
        continue;
      }

      const alreadyMatched = Object.entries(activities).find(([, activity]) => activity.summaryPolyline === route.summaryPolyline);
      if (alreadyMatched) {
        continue;
      }

      const nearestActivityId = findNearestWorkoutByStartTime(activities, firstPointTime, matchedRouteIds);
      if (!nearestActivityId) {
        warnings.push(`Unmatched GPX route file: ${path.basename(entry.routePath)}`);
        continue;
      }

      attachRouteToActivity(activities[nearestActivityId], route);
      matchedRouteIds.add(nearestActivityId);
    }
  }

  return { activities, warnings };
}

async function* streamAppleHealthWorkoutAttributes(xmlPath: string) {
  const stream = createReadStream(xmlPath, {
    encoding: "utf8",
    highWaterMark: 1024 * 1024,
  });
  let buffer = "";

  for await (const chunk of stream) {
    buffer += chunk;
    const extracted = extractWorkoutAttributesFromBuffer(buffer);
    buffer = extracted.rest;

    for (const attributes of extracted.attributesList) {
      yield attributes;
    }
  }

  const extracted = extractWorkoutAttributesFromBuffer(buffer, true);
  for (const attributes of extracted.attributesList) {
    yield attributes;
  }
}

function extractWorkoutAttributesFromBuffer(buffer: string, flush = false) {
  const attributesList: string[] = [];
  let cursor = 0;

  while (true) {
    const start = findNextWorkoutTag(buffer, cursor);
    if (start === -1) {
      return {
        attributesList,
        rest: flush ? "" : preservePotentialTagPrefix(buffer.slice(cursor)),
      };
    }

    const tagEnd = findTagEnd(buffer, start);
    if (tagEnd === -1) {
      return {
        attributesList,
        rest: buffer.slice(start),
      };
    }

    const isSelfClosing = buffer[tagEnd - 1] === "/";
    let endExclusive = tagEnd + 1;
    if (!isSelfClosing) {
      const closingTagIndex = buffer.indexOf("</Workout>", tagEnd + 1);
      if (closingTagIndex === -1) {
        return {
          attributesList,
          rest: buffer.slice(start),
        };
      }

      endExclusive = closingTagIndex + "</Workout>".length;
    }

    attributesList.push(buffer.slice(start + "<Workout".length, isSelfClosing ? tagEnd - 1 : tagEnd));
    cursor = endExclusive;
  }
}

function findNextWorkoutTag(buffer: string, fromIndex: number) {
  let index = buffer.indexOf("<Workout", fromIndex);
  while (index !== -1) {
    const nextCharacter = buffer[index + "<Workout".length] ?? "";
    if (!/[A-Za-z0-9:_-]/u.test(nextCharacter)) {
      return index;
    }

    index = buffer.indexOf("<Workout", index + "<Workout".length);
  }

  return -1;
}

function findTagEnd(buffer: string, startIndex: number) {
  let inQuote = false;
  let isEscaped = false;

  for (let index = startIndex; index < buffer.length; index += 1) {
    const character = buffer[index];

    if (inQuote) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === "\"") {
        inQuote = false;
      }
      continue;
    }

    if (character === "\"") {
      inQuote = true;
      continue;
    }

    if (character === ">") {
      return index;
    }
  }

  return -1;
}

function preservePotentialTagPrefix(value: string) {
  const partialStartIndex = value.lastIndexOf("<Work");
  return partialStartIndex === -1 ? "" : value.slice(partialStartIndex);
}

function normalizeBridgeSnapshot(raw: Record<string, unknown>): AppleHealthCacheExport {
  const provider = raw.provider;
  if (provider !== "appleHealth") {
    throw new Error(`Expected provider "appleHealth" in normalized snapshot, received ${String(provider)}`);
  }

  const rawActivities = raw.activities;
  if (!rawActivities || typeof rawActivities !== "object" || Array.isArray(rawActivities)) {
    throw new Error("Normalized Apple Health snapshot must contain an activities object");
  }

  const activities = Object.fromEntries(
    Object.entries(rawActivities).map(([activityId, value]) => [
      activityId,
      normalizeSnapshotActivity(activityId, value as Record<string, unknown>),
    ]),
  );

  return {
    generatedAt: normalizeIsoDateTime(raw.generatedAt) ?? new Date().toISOString(),
    provider: "appleHealth",
    registryGeneratedAt: normalizeIsoDateTime(raw.registryGeneratedAt),
    activities,
    collections: normalizeBridgeCollections(raw.collections),
    deletedActivityIds: Array.isArray(raw.deletedActivityIds)
      ? raw.deletedActivityIds
          .map((item) => normalizeString(item))
          .filter((item): item is string => item !== null)
      : [],
  };
}

function normalizeBridgeCollections(raw: unknown): Record<string, AppleHealthCollectionExport> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw).flatMap(([key, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return [];
      }

      return [[key, normalizeBridgeCollection(key, value as Record<string, unknown>)]];
    }),
  );
}

function normalizeBridgeCollection(
  collectionKey: string,
  raw: Record<string, unknown>,
): AppleHealthCollectionExport {
  return {
    key: normalizeString(raw.key) ?? collectionKey,
    kind: normalizeString(raw.kind) ?? "unknown",
    displayName: normalizeString(raw.displayName) ?? collectionKey,
    unit: normalizeString(raw.unit),
    objectTypeIdentifier: normalizeString(raw.objectTypeIdentifier),
    queryStrategy: normalizeString(raw.queryStrategy),
    requiresPerObjectAuthorization: normalizeBoolean(raw.requiresPerObjectAuthorization),
    samples: Array.isArray(raw.samples)
      ? raw.samples.flatMap((sample) => {
          if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
            return [];
          }

          return [normalizeBridgeCollectionSample(sample as Record<string, unknown>)];
        })
      : [],
  };
}

function normalizeBridgeCollectionSample(raw: Record<string, unknown>): AppleHealthCollectionSampleExport {
  return {
    sampleId: normalizeString(raw.sampleId) ?? randomUUID(),
    startDate: normalizeIsoDateTime(raw.startDate) ?? normalizeAppleDate(raw.startDate),
    endDate: normalizeIsoDateTime(raw.endDate) ?? normalizeAppleDate(raw.endDate),
    numericValue: normalizeNumber(raw.numericValue),
    categoryValue: normalizeInteger(raw.categoryValue),
    textValue: normalizeString(raw.textValue),
    payload: normalizeStringRecord(raw.payload),
    source: normalizeSourceMetadata(raw.source as Record<string, unknown> | null | undefined),
    metadata: normalizeStringRecord(raw.metadata),
  };
}

function normalizeSnapshotActivity(activityId: string, raw: Record<string, unknown>): AppleHealthActivityExport {
  const routeStreams = normalizeRouteStreams(raw.routeStreams as Record<string, unknown> | null | undefined);
  const hasStreams = raw.hasStreams === true || routeStreams !== null;

  return {
    activityId,
    sportType: normalizeString(raw.sportType),
    startDate: normalizeIsoDateTime(raw.startDate) ?? normalizeAppleDate(raw.startDate),
    distanceMeters: normalizeNumber(raw.distanceMeters),
    distanceKm: normalizeNumber(raw.distanceKm),
    movingTimeSeconds: normalizeInteger(raw.movingTimeSeconds),
    elapsedTimeSeconds: normalizeInteger(raw.elapsedTimeSeconds),
    averageHeartrate: normalizeNumber(raw.averageHeartrate),
    maxHeartrate: normalizeNumber(raw.maxHeartrate),
    summaryPolyline: normalizeString(raw.summaryPolyline),
    detailFetchedAt: normalizeIsoDateTime(raw.detailFetchedAt) ?? new Date().toISOString(),
    hasStreams,
    routeStreams,
    source: normalizeSourceMetadata(raw.source as Record<string, unknown> | null | undefined),
  };
}

async function resolveExistingPath(pathsToCheck: string[]) {
  for (const candidate of pathsToCheck) {
    try {
      await fs.stat(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function parseXmlAttributes(rawAttributes: string) {
  const attributes: Record<string, string> = {};

  for (const match of rawAttributes.matchAll(/([A-Za-z0-9:_-]+)="([^"]*)"/gu)) {
    attributes[match[1]] = decodeXmlEntities(match[2]);
  }

  return attributes;
}

function decodeXmlEntities(value: string) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function normalizeWorkoutActivityType(value: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized.includes("running")) {
    return "run";
  }
  if (normalized.includes("walking")) {
    return "walk";
  }
  if (normalized.includes("hiking")) {
    return "hike";
  }
  if (normalized.includes("cycling") || normalized.includes("biking")) {
    return "ride";
  }

  return normalized.replace(/^hkworkoutactivitytype/iu, "");
}

function normalizeAppleDate(value: unknown): string | null {
  const raw = normalizeString(value);
  if (!raw) {
    return null;
  }

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  const normalizedOffset = raw.replace(/ ([+-]\d{4})$/u, " $1").replace(
    /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) ([+-]\d{4})$/u,
    (_, dateTime, offset) => {
      const sign = offset.slice(0, 1);
      const hours = offset.slice(1, 3);
      const minutes = offset.slice(3, 5);
      return `${dateTime}${sign}${hours}:${minutes}`;
    },
  ).replace(" ", "T");

  const parsed = new Date(normalizedOffset);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeIsoDateTime(value: unknown) {
  const raw = normalizeString(value);
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function deriveElapsedTimeSeconds(startDate: string | null, endDate: string | null) {
  if (!startDate || !endDate) {
    return null;
  }

  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }

  return Math.round((end - start) / 1000);
}

function normalizeDurationSeconds(rawDuration: unknown, rawUnit: unknown) {
  const duration = normalizeNumber(rawDuration);
  const unit = normalizeString(rawUnit)?.toLowerCase();
  if (duration === null) {
    return null;
  }

  if (unit === "min" || unit === "minute" || unit === "minutes") {
    return Math.round(duration * 60);
  }
  if (unit === "h" || unit === "hr" || unit === "hour" || unit === "hours") {
    return Math.round(duration * 3600);
  }
  if (unit === "s" || unit === "sec" || unit === "second" || unit === "seconds") {
    return Math.round(duration);
  }

  return Math.round(duration);
}

function normalizeDistanceMeters(rawDistance: unknown, rawUnit: unknown) {
  const distance = normalizeNumber(rawDistance);
  const unit = normalizeString(rawUnit)?.toLowerCase();
  if (distance === null) {
    return null;
  }

  if (!unit || unit === "m") {
    return distance;
  }
  if (unit === "km") {
    return distance * 1000;
  }
  if (unit === "mi" || unit === "mile" || unit === "miles") {
    return distance * 1609.344;
  }

  return distance;
}

function normalizeSource(attributes: Record<string, string>) {
  const device = normalizeDevice(attributes.device ?? null);
  const source = {
    bundleIdentifier: null,
    name: normalizeString(attributes.sourceName),
    deviceName: device.deviceName,
    deviceModel: device.deviceModel,
  };

  return source.name || source.deviceName || source.deviceModel ? source : null;
}

function normalizeSourceMetadata(source: Record<string, unknown> | null | undefined) {
  if (!source) {
    return null;
  }

  const normalized = {
    bundleIdentifier: normalizeString(source.bundleIdentifier),
    name: normalizeString(source.name),
    deviceName: normalizeString(source.deviceName),
    deviceModel: normalizeString(source.deviceModel),
  };

  return normalized.bundleIdentifier || normalized.name || normalized.deviceName || normalized.deviceModel
    ? normalized
    : null;
}

function normalizeStringRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value)
    .map(([key, raw]) => [key, normalizeString(raw)] as const)
    .filter((entry): entry is [string, string] => entry[1] !== null);

  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function normalizeBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function normalizeDevice(value: string | null) {
  if (!value) {
    return { deviceName: null, deviceModel: null };
  }

  const nameMatch = value.match(/name:([^,]+)/iu);
  const modelMatch = value.match(/model:([^,]+)/iu);
  return {
    deviceName: nameMatch?.[1]?.trim() ?? null,
    deviceModel: modelMatch?.[1]?.trim() ?? null,
  };
}

async function listFilesRecursively(rootPath: string, extension: string): Promise<string[]> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        return listFilesRecursively(entryPath, extension);
      }
      return entry.name.toLowerCase().endsWith(extension) ? [entryPath] : [];
    }),
  );

  return nested.flat().sort((left, right) => left.localeCompare(right));
}

async function parseGpxRoute(routePath: string) {
  const content = await fs.readFile(routePath, "utf8");
  const pointPattern = /<trkpt\b[^>]*lat="([^"]+)"[^>]*lon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/gu;
  const coordinates: Array<[number, number]> = [];
  const altitude: number[] = [];
  const timestamps: Array<number | null> = [];

  for (const match of content.matchAll(pointPattern)) {
    const latitude = Number.parseFloat(match[1]);
    const longitude = Number.parseFloat(match[2]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      continue;
    }

    coordinates.push([latitude, longitude]);
    const body = match[3] ?? "";
    const altitudeMatch = body.match(/<ele>([^<]+)<\/ele>/u);
    altitude.push(altitudeMatch ? Number.parseFloat(altitudeMatch[1]) : Number.NaN);
    const timeMatch = body.match(/<time>([^<]+)<\/time>/u);
    timestamps.push(timeMatch ? new Date(timeMatch[1]).getTime() : null);
  }

  if (coordinates.length < 2) {
    return null;
  }

  const distanceSeries = buildDistanceSeries(coordinates);
  const velocitySeries = buildVelocitySeries(distanceSeries, timestamps);
  const normalizedAltitude = altitude.some((value) => Number.isFinite(value))
    ? altitude.map((value) => (Number.isFinite(value) ? value : altitude.find(Number.isFinite) ?? 0))
    : null;
  const startTime = timestamps.find((value): value is number => value !== null && Number.isFinite(value));

  return {
    latlng: coordinates,
    altitude: normalizedAltitude,
    distance: distanceSeries,
    heartrate: null,
    velocitySmooth: velocitySeries,
    moving: null,
    startTime: startTime ? new Date(startTime).toISOString() : null,
    summaryPolyline: encodePolyline(coordinates),
  };
}

function buildDistanceSeries(coordinates: Array<[number, number]>) {
  let totalDistance = 0;
  const distances = [0];

  for (let index = 1; index < coordinates.length; index += 1) {
    totalDistance += haversineDistanceMeters(coordinates[index - 1], coordinates[index]);
    distances.push(Number(totalDistance.toFixed(1)));
  }

  return distances;
}

function buildVelocitySeries(distanceSeries: number[], timestamps: Array<number | null>) {
  if (timestamps.length !== distanceSeries.length) {
    return null;
  }

  const velocities = [0];
  let hasValidVelocity = false;

  for (let index = 1; index < distanceSeries.length; index += 1) {
    const previousTime = timestamps[index - 1];
    const currentTime = timestamps[index];
    if (previousTime === null || currentTime === null || currentTime <= previousTime) {
      velocities.push(velocities[index - 1] ?? 0);
      continue;
    }

    const deltaDistance = distanceSeries[index] - distanceSeries[index - 1];
    const deltaSeconds = (currentTime - previousTime) / 1000;
    const velocity = deltaSeconds <= 0 ? 0 : deltaDistance / deltaSeconds;
    velocities.push(Number(velocity.toFixed(3)));
    hasValidVelocity = true;
  }

  return hasValidVelocity ? velocities : null;
}

function attachRouteToActivity(
  activity: AppleHealthActivityExport | undefined,
  route: NonNullable<Awaited<ReturnType<typeof parseGpxRoute>>>,
) {
  if (!activity) {
    return;
  }

  activity.hasStreams = true;
  activity.routeStreams = {
    latlng: route.latlng,
    altitude: route.altitude,
    distance: route.distance,
    heartrate: route.heartrate,
    velocitySmooth: route.velocitySmooth,
    moving: route.moving,
  };
  activity.summaryPolyline = route.summaryPolyline;
}

function findNearestWorkoutByStartTime(
  activities: Record<string, AppleHealthActivityExport>,
  routeStartTime: string,
  matchedRouteIds: Set<string>,
) {
  const routeStart = new Date(routeStartTime).getTime();
  let bestMatch: { activityId: string; deltaMs: number } | null = null;

  for (const [activityId, activity] of Object.entries(activities)) {
    if (!activity.startDate || matchedRouteIds.has(activityId)) {
      continue;
    }

    const activityStart = new Date(activity.startDate).getTime();
    if (!Number.isFinite(activityStart)) {
      continue;
    }

    const deltaMs = Math.abs(activityStart - routeStart);
    if (deltaMs > 10 * 60 * 1000) {
      continue;
    }

    if (!bestMatch || deltaMs < bestMatch.deltaMs) {
      bestMatch = { activityId, deltaMs };
    }
  }

  return bestMatch?.activityId ?? null;
}

function haversineDistanceMeters([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]) {
  const earthRadiusMeters = 6371000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const lat1Radians = toRadians(lat1);
  const lat2Radians = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1Radians) * Math.cos(lat2Radians) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function encodePolyline(coordinates: Array<[number, number]>) {
  let previousLatitude = 0;
  let previousLongitude = 0;

  return coordinates
    .map(([latitude, longitude]) => {
      const scaledLatitude = Math.round(latitude * 1e5);
      const scaledLongitude = Math.round(longitude * 1e5);
      const encodedLatitude = encodeSignedInteger(scaledLatitude - previousLatitude);
      const encodedLongitude = encodeSignedInteger(scaledLongitude - previousLongitude);
      previousLatitude = scaledLatitude;
      previousLongitude = scaledLongitude;
      return `${encodedLatitude}${encodedLongitude}`;
    })
    .join("");
}

function encodeSignedInteger(value: number) {
  let current = value < 0 ? ~(value << 1) : value << 1;
  let encoded = "";

  while (current >= 0x20) {
    encoded += String.fromCharCode((0x20 | (current & 0x1f)) + 63);
    current >>= 5;
  }

  encoded += String.fromCharCode(current + 63);
  return encoded;
}

function normalizeRouteStreams(raw: Record<string, unknown> | null | undefined) {
  if (!raw) {
    return null;
  }

  const latlng = Array.isArray(raw.latlng)
    ? raw.latlng
        .map((item) =>
          Array.isArray(item) && item.length === 2 && Number.isFinite(item[0]) && Number.isFinite(item[1])
            ? [Number(item[0]), Number(item[1])] as [number, number]
            : null,
        )
        .filter((item): item is [number, number] => item !== null)
    : null;

  return {
    latlng: latlng && latlng.length > 1 ? latlng : null,
    altitude: normalizeNumberSeries(raw.altitude),
    distance: normalizeNumberSeries(raw.distance),
    heartrate: normalizeNumberSeries(raw.heartrate),
    velocitySmooth: normalizeNumberSeries(raw.velocitySmooth),
    moving: normalizeBooleanSeries(raw.moving),
  };
}

function normalizeNumberSeries(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value
    .map((item) => normalizeNumber(item))
    .filter((item): item is number => item !== null);
  return normalized.length > 1 ? normalized : null;
}

function normalizeBooleanSeries(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value.filter((item): item is boolean => typeof item === "boolean");
  return normalized.length > 1 ? normalized : null;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeInteger(value: unknown) {
  const normalized = normalizeNumber(value);
  return normalized === null ? null : Math.trunc(normalized);
}

function normalizeString(value: unknown) {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return null;
}
