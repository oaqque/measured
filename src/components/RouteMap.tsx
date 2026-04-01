import { useEffect, useMemo, useState } from "react";
import { LocateFixed, Minus, Play, Plus, Route, SwatchBook } from "lucide-react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";
import { divIcon, latLngBounds, type LatLngBoundsExpression, type Map as LeafletMap } from "leaflet";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { WorkoutRouteStreams } from "@/lib/workouts/schema";
import { clearRouteStreamsCache, loadRouteStreamsForActivity } from "@/lib/workouts/routes";
import { cn } from "@/lib/utils";

type RouteCoordinate = [number, number];
type RouteColorMode = "route" | "pace" | "heartrate" | "moving" | "elevation";
type RouteLegendItem = {
  color: string;
  label: string;
  opacity?: number;
};
type RouteSegment = {
  color: string;
  index: number;
  key: string;
  opacity: number;
  positions: [RouteCoordinate, RouteCoordinate];
  weight: number;
};

const ROUTE_MODES: Array<{ id: RouteColorMode; label: string }> = [
  { id: "route", label: "Route" },
  { id: "pace", label: "Pace" },
  { id: "heartrate", label: "Heart rate" },
  { id: "moving", label: "Moving" },
  { id: "elevation", label: "Elevation" },
];

const START_MARKER_RADIUS = 9;
const FINISH_FLAG_ICON = divIcon({
  className: "route-finish-flag",
  html: [
    '<div style="position:relative;width:34px;height:34px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35));">',
    '<span style="position:absolute;left:9px;top:2px;width:3px;height:27px;border-radius:999px;background:#162447;"></span>',
    '<span style="position:absolute;left:12px;top:4px;width:18px;height:12px;background:#f97316;clip-path:polygon(0 0,100% 18%,74% 50%,100% 100%,0 100%);border-radius:1px;"></span>',
    "</div>",
  ].join(""),
  iconAnchor: [10, 30],
  iconSize: [34, 34],
});

export function RouteMap({
  activityId,
  className,
  generatedAt,
  hasStravaStreams,
  polyline,
  title,
}: {
  activityId: number | null;
  className?: string;
  generatedAt: string;
  hasStravaStreams: boolean;
  polyline: string;
  title: string;
}) {
  const [routeStreams, setRouteStreams] = useState<WorkoutRouteStreams | null>(null);
  const [routeStreamsLoaded, setRouteStreamsLoaded] = useState(false);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const [hmrEpoch, setHmrEpoch] = useState(0);
  const [animationNonce, setAnimationNonce] = useState(0);
  const [drawProgress, setDrawProgress] = useState(1);

  useEffect(() => {
    if (!import.meta.hot) {
      return;
    }

    const handleAfterUpdate = () => {
      clearRouteStreamsCache();
      setHmrEpoch((current) => current + 1);
    };

    import.meta.hot.on("vite:afterUpdate", handleAfterUpdate);
    return () => {
      import.meta.hot?.off("vite:afterUpdate", handleAfterUpdate);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!hasStravaStreams || activityId === null) {
      setRouteStreams(null);
      setRouteStreamsLoaded(false);
      return () => {
        cancelled = true;
      };
    }

    setRouteStreamsLoaded(false);
    loadRouteStreamsForActivity(activityId, `${generatedAt}:${hmrEpoch}`)
      .then((payload) => {
        if (cancelled) {
          return;
        }
        setRouteStreams(payload);
        setRouteStreamsLoaded(true);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setRouteStreams(null);
        setRouteStreamsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [activityId, generatedAt, hasStravaStreams, hmrEpoch]);

  const [mode, setMode] = useState<RouteColorMode>("route");
  const streamedCoordinates = routeStreams?.latlng ?? null;
  const summaryCoordinates = useMemo<RouteCoordinate[]>(() => decodePolyline(polyline), [polyline]);
  const baseCoordinates = streamedCoordinates && streamedCoordinates.length > 1 ? streamedCoordinates : summaryCoordinates;
  const bounds = useMemo<LatLngBoundsExpression | null>(() => {
    if (baseCoordinates.length === 0) {
      return null;
    }

    return latLngBounds(baseCoordinates);
  }, [baseCoordinates]);
  const segments = useMemo(
    () => buildRouteSegments(baseCoordinates, routeStreams, mode),
    [baseCoordinates, routeStreams, mode],
  );
  const visibleSegments = useMemo(
    () => trimRouteSegments(segments, drawProgress),
    [drawProgress, segments],
  );
  const availableModes = useMemo(() => getAvailableModes(routeStreams), [routeStreams]);
  const legendItems = useMemo(() => getLegendItems(mode, routeStreams), [mode, routeStreams]);

  useEffect(() => {
    if (availableModes.includes(mode)) {
      return;
    }

    setMode("route");
  }, [availableModes, mode]);

  useEffect(() => {
    setAnimationNonce((current) => current + 1);
  }, [activityId, generatedAt]);

  useEffect(() => {
    if (segments.length === 0) {
      setDrawProgress(1);
      return;
    }

    let animationFrame = 0;
    let startTime = 0;
    const durationMs = 5000;
    setDrawProgress(0);

    const tick = (timestamp: number) => {
      if (startTime === 0) {
        startTime = timestamp;
      }

      const progress = Math.min(1, (timestamp - startTime) / durationMs);
      const easedProgress = 1 - (1 - progress) ** 2;
      setDrawProgress(easedProgress);

      if (progress < 1) {
        animationFrame = window.requestAnimationFrame(tick);
      }
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [animationNonce, segments]);

  if (baseCoordinates.length === 0 || !bounds) {
    return (
      <div
        className={cn(
          "flex h-60 items-center justify-center border border-foreground/10 bg-background/50 text-sm text-muted-foreground",
          className,
        )}
      >
        Route data unavailable.
      </div>
    );
  }

  const start = baseCoordinates[0];
  const finish = baseCoordinates[baseCoordinates.length - 1];
  const sameEndpoint = finish[0] === start[0] && finish[1] === start[1];

  return (
    <div className={cn("overflow-hidden border border-foreground/10 bg-background/50", className)}>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-foreground/10 px-3 py-2">
        <div>
          <p className="eyebrow">Route</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{title}</p>
        </div>
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                aria-label={`Open colour legend for ${
                  ROUTE_MODES.find((item) => item.id === mode)?.label ?? "Route"
                }`}
                className="size-9 rounded-[0.35rem] p-0"
                type="button"
                variant="secondary"
              >
                <SwatchBook className="size-4" />
                <span className="sr-only">Open colour legend</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <div className="px-2 pb-1.5 pt-1">
                <p className="text-sm font-semibold text-foreground">
                  {ROUTE_MODES.find((item) => item.id === mode)?.label ?? "Route"}
                </p>
              </div>
              <div className="space-y-1">
                {legendItems.map((item) => (
                  <div
                    className="flex items-center justify-between gap-3 rounded-[0.3rem] px-2 py-2 text-sm text-foreground"
                    key={item.label}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="block h-1.5 w-8 rounded-full"
                        style={{
                          backgroundColor: item.color,
                          opacity: item.opacity ?? 1,
                        }}
                      />
                      <span className="text-muted-foreground">{item.label}</span>
                    </div>
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`Open route display modes. Current mode: ${
                  ROUTE_MODES.find((item) => item.id === mode)?.label ?? "Route"
                }`}
                className="size-9 rounded-[0.35rem] p-0"
                type="button"
                variant="secondary"
              >
                <Route className="size-4" />
                <span className="sr-only">Open route display modes</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Route mode</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={mode} onValueChange={(value) => setMode(value as RouteColorMode)}>
                {ROUTE_MODES.map((item) => (
                  <DropdownMenuRadioItem
                    disabled={!availableModes.includes(item.id)}
                    key={item.id}
                    value={item.id}
                  >
                    {item.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {hasStravaStreams && !routeStreamsLoaded ? (
        <div className="border-b border-foreground/10 px-3 py-2 text-[11px] font-medium text-muted-foreground">
          Loading route stream data…
        </div>
      ) : null}
      <div className="relative h-64 w-full">
        <div className="absolute top-[10px] right-[10px] z-[500] flex flex-col gap-1">
          <Button
            aria-label="Zoom in"
            className="size-9 border border-foreground/10 bg-background/95 p-0 shadow-sm"
            type="button"
            variant="secondary"
            onClick={() => mapInstance?.zoomIn()}
          >
            <Plus className="size-4" />
            <span className="sr-only">Zoom in</span>
          </Button>
          <Button
            aria-label="Zoom out"
            className="size-9 border border-foreground/10 bg-background/95 p-0 shadow-sm"
            type="button"
            variant="secondary"
            onClick={() => mapInstance?.zoomOut()}
          >
            <Minus className="size-4" />
            <span className="sr-only">Zoom out</span>
          </Button>
          <Button
            aria-label="Recenter map to route"
            className="size-9 border border-foreground/10 bg-background/95 p-0 shadow-sm"
            type="button"
            variant="secondary"
            onClick={() => {
              if (!mapInstance) {
                return;
              }

              flyToRouteBounds(mapInstance, bounds);
            }}
          >
            <LocateFixed className="size-4" />
            <span className="sr-only">Recenter map to route</span>
          </Button>
          <Button
            aria-label="Replay route animation"
            className="size-9 border border-foreground/10 bg-background/95 p-0 shadow-sm"
            type="button"
            variant="secondary"
            onClick={() => setAnimationNonce((current) => current + 1)}
          >
            <Play className="size-4" />
            <span className="sr-only">Replay route animation</span>
          </Button>
        </div>
        <MapContainer
          attributionControl
          className="h-full w-full"
          center={start}
          scrollWheelZoom
          zoom={3}
          zoomControl={false}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
            maxZoom={20}
            subdomains={["a", "b", "c", "d"]}
            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          />
          {visibleSegments.map((segment) => (
            <Polyline
              key={segment.key}
              pathOptions={{
                color: segment.color,
                lineCap: "round",
                lineJoin: "round",
                opacity: segment.opacity,
                weight: segment.weight,
              }}
              positions={segment.positions}
            />
          ))}
          <CircleMarker
            center={start}
            pathOptions={{
              color: "#f4fdff",
              fillColor: "#f97316",
              fillOpacity: 1,
              weight: 2.5,
            }}
            radius={START_MARKER_RADIUS}
          />
          {!sameEndpoint ? (
            <Marker icon={FINISH_FLAG_ICON} position={finish} />
          ) : null}
          <MapInstanceBridge onReady={setMapInstance} />
          <MapViewportSync bounds={bounds} />
        </MapContainer>
      </div>
    </div>
  );
}

function MapViewportSync({
  bounds,
}: {
  bounds: LatLngBoundsExpression;
}) {
  const map = useMap();

  useEffect(() => {
    fitRouteBounds(map, bounds, false);
  }, [bounds, map]);

  useEffect(() => {
    const container = map.getContainer();
    const resizeObserver = new ResizeObserver(() => {
      fitRouteBounds(map, bounds, false);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [bounds, map]);

  return null;
}

function MapInstanceBridge({
  onReady,
}: {
  onReady: (map: LeafletMap) => void;
}) {
  const map = useMap();

  useEffect(() => {
    onReady(map);
  }, [map, onReady]);

  return null;
}

function fitRouteBounds(
  map: LeafletMap,
  bounds: LatLngBoundsExpression,
  animate: boolean,
) {
  map.invalidateSize();
  map.fitBounds(bounds, {
    animate,
    padding: [20, 20],
  });
}

function flyToRouteBounds(map: LeafletMap, bounds: LatLngBoundsExpression) {
  map.invalidateSize();
  map.flyToBounds(bounds, {
    duration: 0.45,
    padding: [20, 20],
  });
}

function getAvailableModes(routeStreams: WorkoutRouteStreams | null): RouteColorMode[] {
  const modes: RouteColorMode[] = ["route"];
  if (canColorByNumericStream(routeStreams?.latlng, routeStreams?.velocitySmooth)) {
    modes.push("pace");
  }
  if (canColorByNumericStream(routeStreams?.latlng, routeStreams?.heartrate)) {
    modes.push("heartrate");
  }
  if (canColorByBooleanStream(routeStreams?.latlng, routeStreams?.moving)) {
    modes.push("moving");
  }
  if (canColorByNumericStream(routeStreams?.latlng, routeStreams?.altitude)) {
    modes.push("elevation");
  }
  return modes;
}

function getLegendItems(
  mode: RouteColorMode,
  routeStreams: WorkoutRouteStreams | null,
): RouteLegendItem[] {
  if (mode === "pace") {
    return [
      { color: "#7f1d1d", label: "< 4:17 /km" },
      { color: "#b91c1c", label: "4:18-4:48 /km" },
      { color: "#ea580c", label: "4:49-5:27 /km" },
      { color: "#ca8a04", label: "5:28-6:19 /km" },
      { color: "#0284c7", label: "6:20-7:30 /km" },
      { color: "#1d4ed8", label: "> 7:30 /km" },
    ];
  }

  if (mode === "heartrate") {
    return [
      { color: "#1d4ed8", label: "Z1 < 135 bpm" },
      { color: "#0284c7", label: "Z2 135-144 bpm" },
      { color: "#ca8a04", label: "Z3 145-154 bpm" },
      { color: "#ea580c", label: "Z4 155-164 bpm" },
      { color: "#b91c1c", label: "Z5 165-174 bpm" },
      { color: "#7f1d1d", label: "Z6 175+ bpm" },
    ];
  }

  if (mode === "moving") {
    return [
      { color: "#1f63d2", label: "Moving", opacity: 0.98 },
      { color: "#b4bfd8", label: "Stopped", opacity: 0.72 },
    ];
  }

  if (mode === "elevation") {
    return getElevationLegendItems(routeStreams?.altitude ?? null);
  }

  return [{ color: "#1d2a6d", label: "Route" }];
}

function buildRouteSegments(
  coordinates: RouteCoordinate[],
  routeStreams: WorkoutRouteStreams | null,
  mode: RouteColorMode,
) : RouteSegment[] {
  if (mode === "pace" && canColorByNumericStream(routeStreams?.latlng, routeStreams?.velocitySmooth)) {
    return buildNumericSegments(
      routeStreams!.latlng!,
      routeStreams!.velocitySmooth!,
      speedToColor,
      "pace",
    );
  }

  if (
    mode === "heartrate" &&
    canColorByNumericStream(routeStreams?.latlng, routeStreams?.heartrate)
  ) {
    return buildNumericSegments(
      routeStreams!.latlng!,
      routeStreams!.heartrate!,
      heartrateToColor,
      "heartrate",
    );
  }

  if (mode === "moving" && canColorByBooleanStream(routeStreams?.latlng, routeStreams?.moving)) {
    return buildBooleanSegments(routeStreams!.latlng!, routeStreams!.moving!, "moving");
  }

  if (mode === "elevation" && canColorByNumericStream(routeStreams?.latlng, routeStreams?.altitude)) {
    return buildElevationSegments(routeStreams!.latlng!, routeStreams!.altitude!, "elevation");
  }

  return buildSolidSegments(coordinates, "route-base", "#1d2a6d", 0.92, 4);
}

function buildSolidSegments(
  coordinates: RouteCoordinate[],
  keyPrefix: string,
  color: string,
  opacity: number,
  weight: number,
): RouteSegment[] {
  const segments: RouteSegment[] = [];

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    segments.push({
      color,
      index,
      key: `${keyPrefix}-${index}`,
      opacity,
      positions: [coordinates[index], coordinates[index + 1]],
      weight,
    });
  }

  return segments;
}

function buildNumericSegments(
  coordinates: RouteCoordinate[],
  values: number[],
  colorForValue: (value: number) => string,
  keyPrefix: string,
) : RouteSegment[] {
  const segments: RouteSegment[] = [];

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const finish = coordinates[index + 1];
    const startValue = values[index];
    const finishValue = values[index + 1] ?? startValue;
    if (startValue === undefined || finishValue === undefined) {
      continue;
    }

    const metricValue = (startValue + finishValue) / 2;
    segments.push({
      color: colorForValue(metricValue),
      index,
      key: `${keyPrefix}-${index}`,
      opacity: 0.98,
      positions: [start, finish],
      weight: 5,
    });
  }

  return segments;
}

function buildBooleanSegments(
  coordinates: RouteCoordinate[],
  values: boolean[],
  keyPrefix: string,
) : RouteSegment[] {
  const segments: RouteSegment[] = [];

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const state = values[index + 1] ?? values[index];
    if (state === undefined) {
      continue;
    }

    segments.push({
      color: state ? "#1f63d2" : "#b4bfd8",
      index,
      key: `${keyPrefix}-${index}`,
      opacity: state ? 0.98 : 0.72,
      positions: [coordinates[index], coordinates[index + 1]],
      weight: 5,
    });
  }

  return segments;
}

function buildElevationSegments(
  coordinates: RouteCoordinate[],
  values: number[],
  keyPrefix: string,
): RouteSegment[] {
  const bounds = getElevationBounds(values);
  if (!bounds) {
    return buildSolidSegments(coordinates, keyPrefix, "#1d2a6d", 0.92, 4);
  }

  return buildNumericSegments(
    coordinates,
    values,
    (value) => elevationToColor(value, bounds.min, bounds.max),
    keyPrefix,
  );
}

function trimRouteSegments(segments: RouteSegment[], progress: number): RouteSegment[] {
  if (segments.length === 0 || progress <= 0) {
    return [];
  }

  if (progress >= 1) {
    return segments;
  }

  const maxSegmentProgress = progress * segments.length;
  const completedSegments = Math.floor(maxSegmentProgress);
  const partialProgress = maxSegmentProgress - completedSegments;
  const visibleSegments = segments.slice(0, completedSegments);

  if (completedSegments >= segments.length || partialProgress <= 0) {
    return visibleSegments;
  }

  const nextSegment = segments[completedSegments];
  const [start, finish] = nextSegment.positions;
  visibleSegments.push({
    ...nextSegment,
    key: `${nextSegment.key}-partial`,
    positions: [start, interpolateCoordinate(start, finish, partialProgress)],
  });

  return visibleSegments;
}

function interpolateCoordinate(
  start: RouteCoordinate,
  finish: RouteCoordinate,
  progress: number,
): RouteCoordinate {
  return [
    start[0] + (finish[0] - start[0]) * progress,
    start[1] + (finish[1] - start[1]) * progress,
  ];
}

function canColorByNumericStream(
  coordinates: WorkoutRouteStreams["latlng"] | null | undefined,
  values: number[] | null | undefined,
) {
  return Boolean(coordinates && values && coordinates.length > 1 && values.length > 1);
}

function canColorByBooleanStream(
  coordinates: WorkoutRouteStreams["latlng"] | null | undefined,
  values: boolean[] | null | undefined,
) {
  return Boolean(coordinates && values && coordinates.length > 1 && values.length > 1);
}

function speedToColor(speedMps: number) {
  const speedKph = speedMps * 3.6;
  if (speedKph >= 14) {
    return "#7f1d1d";
  }
  if (speedKph >= 12.5) {
    return "#b91c1c";
  }
  if (speedKph >= 11) {
    return "#ea580c";
  }
  if (speedKph >= 9.5) {
    return "#ca8a04";
  }
  if (speedKph >= 8) {
    return "#0284c7";
  }
  return "#1d4ed8";
}

function heartrateToColor(heartrate: number) {
  if (heartrate >= 175) {
    return "#7f1d1d";
  }
  if (heartrate >= 165) {
    return "#b91c1c";
  }
  if (heartrate >= 155) {
    return "#ea580c";
  }
  if (heartrate >= 145) {
    return "#ca8a04";
  }
  if (heartrate >= 135) {
    return "#0284c7";
  }
  return "#1d4ed8";
}

function getElevationLegendItems(values: number[] | null): RouteLegendItem[] {
  const bounds = getElevationBounds(values);
  if (!bounds) {
    return [{ color: "#1d2a6d", label: "Elevation" }];
  }

  const steps = 5;
  const range = bounds.max - bounds.min;
  const colors = ["#1d4ed8", "#0284c7", "#16a34a", "#ea580c", "#b91c1c"];

  if (range < 1) {
    return [{ color: colors[2], label: `${Math.round(bounds.min)} m` }];
  }

  return colors.map((color, index) => {
    const start = bounds.min + (range * index) / steps;
    const end = bounds.min + (range * (index + 1)) / steps;
    const roundedStart = Math.round(start);
    const roundedEnd = Math.round(end);
    const label =
      index === colors.length - 1
        ? `${roundedStart}-${roundedEnd} m`
        : `${roundedStart}-${roundedEnd} m`;

    return { color, label };
  });
}

function getElevationBounds(values: number[] | null) {
  if (!values || values.length < 2) {
    return null;
  }

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  values.forEach((value) => {
    if (!Number.isFinite(value)) {
      return;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return { min, max };
}

function elevationToColor(value: number, min: number, max: number) {
  const range = max - min;
  if (range <= 0) {
    return "#16a34a";
  }

  const ratio = (value - min) / range;
  if (ratio >= 0.8) {
    return "#b91c1c";
  }
  if (ratio >= 0.6) {
    return "#ea580c";
  }
  if (ratio >= 0.4) {
    return "#16a34a";
  }
  if (ratio >= 0.2) {
    return "#0284c7";
  }
  return "#1d4ed8";
}

function decodePolyline(encoded: string): RouteCoordinate[] {
  const coordinates: RouteCoordinate[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < encoded.length) {
    const latitudeResult = decodePolylineValue(encoded, index);
    latitude += latitudeResult.value;
    index = latitudeResult.nextIndex;

    const longitudeResult = decodePolylineValue(encoded, index);
    longitude += longitudeResult.value;
    index = longitudeResult.nextIndex;

    coordinates.push([latitude / 1e5, longitude / 1e5]);
  }

  return coordinates;
}

function decodePolylineValue(encoded: string, startIndex: number) {
  let result = 0;
  let shift = 0;
  let index = startIndex;
  let byte = 0;

  do {
    byte = encoded.charCodeAt(index) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
    index += 1;
  } while (byte >= 0x20 && index < encoded.length + 1);

  const value = result & 1 ? ~(result >> 1) : result >> 1;
  return { value, nextIndex: index };
}
