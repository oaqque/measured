import { useEffect, useMemo, useState } from "react";
import { Route, SwatchBook } from "lucide-react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  ZoomControl,
  useMap,
} from "react-leaflet";
import { latLngBounds, type LatLngBoundsExpression } from "leaflet";
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
import { loadRouteStreamsForActivity } from "@/lib/workouts/routes";
import { cn } from "@/lib/utils";

type RouteCoordinate = [number, number];
type RouteColorMode = "route" | "pace" | "heartrate" | "moving";
type RouteLegendItem = {
  color: string;
  label: string;
  opacity?: number;
};

const ROUTE_MODES: Array<{ id: RouteColorMode; label: string }> = [
  { id: "route", label: "Route" },
  { id: "pace", label: "Pace" },
  { id: "heartrate", label: "Heart rate" },
  { id: "moving", label: "Moving" },
];

export function RouteMap({
  activityId,
  className,
  hasStravaStreams,
  polyline,
  title,
}: {
  activityId: number | null;
  className?: string;
  hasStravaStreams: boolean;
  polyline: string;
  title: string;
}) {
  const [routeStreams, setRouteStreams] = useState<WorkoutRouteStreams | null>(null);
  const [routeStreamsLoaded, setRouteStreamsLoaded] = useState(false);

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
    loadRouteStreamsForActivity(activityId)
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
  }, [activityId, hasStravaStreams]);

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
  const availableModes = useMemo(() => getAvailableModes(routeStreams), [routeStreams]);
  const legendItems = useMemo(() => getLegendItems(mode), [mode]);

  useEffect(() => {
    if (availableModes.includes(mode)) {
      return;
    }

    setMode("route");
  }, [availableModes, mode]);

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
      <div className="h-64 w-full">
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
          <ZoomControl position="topright" />
          {segments.map((segment) => (
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
              fillColor: "#1f63d2",
              fillOpacity: 1,
              weight: 2,
            }}
            radius={4}
          />
          {!sameEndpoint ? (
            <CircleMarker
              center={finish}
              pathOptions={{
                color: "#162447",
                fillColor: "#8fb8f5",
                fillOpacity: 1,
                weight: 2,
              }}
              radius={4}
            />
          ) : null}
          <MapViewportSync bounds={bounds} start={start} />
        </MapContainer>
      </div>
    </div>
  );
}

function MapViewportSync({
  bounds,
  start,
}: {
  bounds: LatLngBoundsExpression;
  start: RouteCoordinate;
}) {
  const map = useMap();

  useEffect(() => {
    map.setView(start, 3, { animate: false });
    map.invalidateSize();
    map.fitBounds(bounds, {
      animate: false,
      padding: [20, 20],
    });
  }, [bounds, map, start]);

  useEffect(() => {
    const container = map.getContainer();
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
      map.fitBounds(bounds, {
        animate: false,
        padding: [20, 20],
      });
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [bounds, map]);

  return null;
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
  return modes;
}

function getLegendItems(mode: RouteColorMode): RouteLegendItem[] {
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

  return [{ color: "#1d2a6d", label: "Route" }];
}

function buildRouteSegments(
  coordinates: RouteCoordinate[],
  routeStreams: WorkoutRouteStreams | null,
  mode: RouteColorMode,
) {
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

  return [
    {
      color: "#1d2a6d",
      key: "route-base",
      opacity: 0.92,
      positions: coordinates,
      weight: 4,
    },
  ];
}

function buildNumericSegments(
  coordinates: RouteCoordinate[],
  values: number[],
  colorForValue: (value: number) => string,
  keyPrefix: string,
) {
  const segments: Array<{
    color: string;
    key: string;
    opacity: number;
    positions: RouteCoordinate[];
    weight: number;
  }> = [];

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
) {
  const segments: Array<{
    color: string;
    key: string;
    opacity: number;
    positions: RouteCoordinate[];
    weight: number;
  }> = [];

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const state = values[index + 1] ?? values[index];
    if (state === undefined) {
      continue;
    }

    segments.push({
      color: state ? "#1f63d2" : "#b4bfd8",
      key: `${keyPrefix}-${index}`,
      opacity: state ? 0.98 : 0.72,
      positions: [coordinates[index], coordinates[index + 1]],
      weight: 5,
    });
  }

  return segments;
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
