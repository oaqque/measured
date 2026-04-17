import {
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Moon,
  Sun,
  Wind,
} from "lucide-react";
import { decodePolyline, type RouteCoordinate } from "@/lib/workouts/polyline";
import type { WorkoutNote } from "@/lib/workouts/schema";
import { cn } from "@/lib/utils";
import {
  getWorkoutCardToneClasses,
  getWorkoutEventTypeMeta,
  getWorkoutStatusIconMeta,
  getWorkoutStatusTone,
} from "@/features/calendar/calendarMeta";
import { Button } from "@/components/ui/button";

export function WorkoutPreviewCard({
  compact = false,
  fullBleed = false,
  selected,
  workout,
  onSelectWorkout,
}: {
  compact?: boolean;
  fullBleed?: boolean;
  selected: boolean;
  workout: WorkoutNote;
  onSelectWorkout: (slug: string) => void;
}) {
  const statusTone = getWorkoutStatusTone(workout);

  return (
    <Button
      className={cn(
        "relative h-full w-full items-start justify-start overflow-hidden px-3 py-3 text-left whitespace-normal transition-transform",
        fullBleed ? "rounded-none shadow-none" : "rounded-[0.65rem] shadow-sm",
        compact ? "min-h-20 px-2.5 py-2.5" : "min-h-24",
        getWorkoutCardToneClasses(statusTone, selected),
      )}
      data-clickable="true"
      type="button"
      variant="secondary"
      onClick={() => onSelectWorkout(workout.slug)}
    >
      <WorkoutCardBackground selected={selected} workout={workout} />
      <WorkoutCardContent compact={compact} fullBleed={fullBleed} selected={selected} workout={workout} />
    </Button>
  );
}

function WorkoutCardContent({
  compact = false,
  fullBleed = false,
  selected,
  workout,
}: {
  compact?: boolean;
  fullBleed?: boolean;
  selected: boolean;
  workout: WorkoutNote;
}) {
  const displayDistance = getWorkoutCardDistance(workout);
  const displayDistanceKm = getWorkoutCardDistanceKm(workout);
  const eventTypeMeta = getWorkoutEventTypeMeta(workout.eventType);
  const statusTone = getWorkoutStatusTone(workout);
  const statusMeta = getWorkoutStatusIconMeta(statusTone);
  const EventTypeIcon = eventTypeMeta.icon;
  const iconSizeClass = compact ? "size-3.5" : "size-4";
  const routeOutlinePath = getWorkoutCardRouteOutlinePath(workout.summaryPolyline);
  const StatusIcon = statusMeta.icon;
  const backgroundImageUrl = getWorkoutCardBackgroundImageUrl(workout);
  const hasBackgroundImage = backgroundImageUrl !== null;
  const weatherIconMeta = getWorkoutWeatherIconMeta(workout);
  const WeatherIcon = weatherIconMeta?.icon ?? null;
  const weatherIconClassName = weatherIconMeta?.className ?? null;
  const usesImageForeground = hasBackgroundImage;
  const baseIconColorClass = usesImageForeground
    ? "text-white"
    : selected
      ? "text-primary-foreground"
      : "text-foreground";
  const statusIconColorClass = fullBleed
    ? baseIconColorClass
    : selected
      ? "text-primary-foreground"
      : hasBackgroundImage
        ? "text-white"
        : statusMeta.className;
  const weatherColorClass = fullBleed
    ? baseIconColorClass
    : selected
      ? "text-primary-foreground/90"
      : hasBackgroundImage
        ? "text-white/90"
        : weatherIconClassName;
  const distanceColorClass = fullBleed
    ? hasBackgroundImage
      ? "text-white"
      : baseIconColorClass
    : selected || hasBackgroundImage
      ? "text-primary-foreground"
      : "text-foreground";

  return (
    <span
      aria-label={
        [
          displayDistance
            ? `${eventTypeMeta.label}, ${displayDistance} kilometres`
            : eventTypeMeta.label,
          statusMeta.label,
        ].join(", ")
      }
      className="relative flex h-full w-full"
    >
      {routeOutlinePath ? (
        <WorkoutCardRouteOutline
          compact={compact}
          fullBleed={fullBleed}
          hasBackgroundImage={hasBackgroundImage}
          useWhiteForeground={hasBackgroundImage}
          path={routeOutlinePath}
          selected={selected}
        />
      ) : null}
      <span className="absolute left-0 top-0 flex items-start justify-start">
        <EventTypeIcon
          aria-hidden="true"
          className={cn(iconSizeClass, baseIconColorClass)}
        />
      </span>
      <span className="absolute right-0 top-0 flex items-start justify-end">
        <StatusIcon
          aria-hidden="true"
          className={cn(
            compact ? "size-3.5" : "size-4",
            statusIconColorClass,
          )}
        />
      </span>
      {WeatherIcon ? (
        <span className="absolute bottom-0 right-0 flex items-end justify-end">
          <WeatherIcon
            aria-hidden="true"
            className={cn(compact ? "size-3.5" : "size-4", weatherColorClass)}
          />
        </span>
      ) : null}
      {displayDistance ? (
        <span
          className={cn(
            "flex h-full w-full items-center justify-center font-extrabold tabular-nums",
            getWorkoutCardDistanceSizeClass(displayDistanceKm, compact),
            distanceColorClass,
          )}
        >
          {displayDistance}
        </span>
      ) : (
        <span className="h-full w-full" />
      )}
    </span>
  );
}

function WorkoutCardBackground({
  selected,
  workout,
}: {
  selected: boolean;
  workout: WorkoutNote;
}) {
  const backgroundImageUrl = getWorkoutCardBackgroundImageUrl(workout);
  if (!backgroundImageUrl) {
    return null;
  }

  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat",
          selected ? "opacity-[0.9]" : "opacity-[0.98]",
        )}
        style={{ backgroundImage: `url("${backgroundImageUrl}")` }}
      />
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0",
          selected
            ? "bg-gradient-to-br from-primary/55 via-primary/28 to-primary/52"
            : "bg-gradient-to-br from-black/48 via-black/22 to-black/56",
        )}
      />
    </>
  );
}

function WorkoutCardRouteOutline({
  compact,
  fullBleed,
  hasBackgroundImage,
  path,
  selected,
  useWhiteForeground,
}: {
  compact: boolean;
  fullBleed: boolean;
  hasBackgroundImage: boolean;
  path: string;
  selected: boolean;
  useWhiteForeground: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        compact ? "px-1 py-0.5" : "px-1.5 py-1",
      )}
    >
      <svg className="size-full" preserveAspectRatio="xMidYMid meet" viewBox="0 0 100 60">
        <path
          d={path}
          fill="none"
          stroke={useWhiteForeground ? "#ffffff" : fullBleed ? "currentColor" : hasBackgroundImage ? "#ffffff" : "currentColor"}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={
            useWhiteForeground
              ? selected
                ? 0.72
                : 0.62
              : fullBleed
                ? selected
                  ? 0.2
                  : 0.14
                : hasBackgroundImage
                  ? selected
                    ? 0.72
                    : 0.62
                  : selected
                    ? 0.24
                    : 0.16
          }
          strokeWidth={compact ? 1.8 : 1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

function getWorkoutWeatherIconMeta(workout: WorkoutNote) {
  const weatherCode = workout.weather?.weatherCode;
  if (weatherCode === null || weatherCode === undefined) {
    return null;
  }

  if (weatherCode === 0) {
    return {
      className: "text-amber-600",
      icon: Sun,
      label: "Clear",
    };
  }

  if (weatherCode === 1 || weatherCode === 2 || weatherCode === 3) {
    return {
      className: "text-sky-700",
      icon: Cloud,
      label: "Cloudy",
    };
  }

  if (weatherCode === 45 || weatherCode === 48) {
    return {
      className: "text-slate-500",
      icon: CloudFog,
      label: "Fog",
    };
  }

  if (weatherCode >= 51 && weatherCode <= 57) {
    return {
      className: "text-cyan-700",
      icon: CloudDrizzle,
      label: "Drizzle",
    };
  }

  if ((weatherCode >= 61 && weatherCode <= 67) || (weatherCode >= 80 && weatherCode <= 82)) {
    return {
      className: "text-blue-700",
      icon: CloudRain,
      label: "Rain",
    };
  }

  if ((weatherCode >= 71 && weatherCode <= 77) || weatherCode === 85 || weatherCode === 86) {
    return {
      className: "text-sky-500",
      icon: CloudSnow,
      label: "Snow",
    };
  }

  if (weatherCode >= 95) {
    return {
      className: "text-violet-700",
      icon: CloudLightning,
      label: "Thunderstorm",
    };
  }

  if ((workout.weather?.windSpeedKph ?? 0) >= 20) {
    return {
      className: "text-teal-700",
      icon: Wind,
      label: "Windy",
    };
  }

  return {
    className: "text-indigo-700",
    icon: Moon,
    label: "Night",
  };
}

function getWorkoutCardBackgroundImageUrl(workout: WorkoutNote) {
  return workout.primaryImageUrl ?? workout.mediaThumbnailUrl ?? null;
}

function getWorkoutCardRouteOutlinePath(summaryPolyline: string | null) {
  if (!summaryPolyline) {
    return null;
  }

  return buildRouteOutlinePath(decodePolyline(summaryPolyline));
}

function getWorkoutCardDistance(workout: WorkoutNote) {
  const distanceKm = getWorkoutCardDistanceKm(workout);
  if (distanceKm === null || distanceKm <= 0) {
    return null;
  }

  return formatCompactDistance(distanceKm);
}

function getWorkoutCardDistanceKm(workout: WorkoutNote) {
  return workout.completed ? workout.actualDistanceKm : workout.expectedDistanceKm;
}

function getWorkoutCardDistanceSizeClass(distanceKm: number | null, compact: boolean) {
  if (distanceKm === null) {
    return compact ? "text-[12px] leading-none" : "text-[14px] leading-none";
  }

  if (distanceKm >= 42) {
    return compact ? "text-[24px] leading-none" : "text-[34px] leading-none";
  }

  if (distanceKm >= 30) {
    return compact ? "text-[21px] leading-none" : "text-[30px] leading-none";
  }

  if (distanceKm >= 21) {
    return compact ? "text-[18px] leading-none" : "text-[26px] leading-none";
  }

  if (distanceKm >= 12) {
    return compact ? "text-[16px] leading-none" : "text-[22px] leading-none";
  }

  if (distanceKm >= 8) {
    return compact ? "text-[14px] leading-none" : "text-[18px] leading-none";
  }

  if (distanceKm >= 5) {
    return compact ? "text-[12px] leading-none" : "text-[15px] leading-none";
  }

  return compact ? "text-[11px] leading-none" : "text-[13px] leading-none";
}

function buildRouteOutlinePath(coordinates: RouteCoordinate[]) {
  if (coordinates.length < 2) {
    return null;
  }

  let minLatitude = coordinates[0][0];
  let maxLatitude = coordinates[0][0];
  let minLongitude = coordinates[0][1];
  let maxLongitude = coordinates[0][1];

  for (const [latitude, longitude] of coordinates) {
    minLatitude = Math.min(minLatitude, latitude);
    maxLatitude = Math.max(maxLatitude, latitude);
    minLongitude = Math.min(minLongitude, longitude);
    maxLongitude = Math.max(maxLongitude, longitude);
  }

  const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.00001);
  const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.00001);
  const viewBoxWidth = 100;
  const viewBoxHeight = 60;
  const padding = 5;
  const scale = Math.min(
    (viewBoxWidth - padding * 2) / longitudeSpan,
    (viewBoxHeight - padding * 2) / latitudeSpan,
  );
  const horizontalInset = (viewBoxWidth - longitudeSpan * scale) / 2;
  const verticalInset = (viewBoxHeight - latitudeSpan * scale) / 2;

  return coordinates
    .map(([latitude, longitude], index) => {
      const x = horizontalInset + (longitude - minLongitude) * scale;
      const y = verticalInset + (maxLatitude - latitude) * scale;
      return `${index === 0 ? "M" : "L"}${formatRouteOutlineCoordinate(x)} ${formatRouteOutlineCoordinate(y)}`;
    })
    .join(" ");
}

function formatRouteOutlineCoordinate(value: number) {
  return value.toFixed(2);
}

function formatCompactDistance(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return rounded % 1 === 0 ? `${rounded.toFixed(0)}` : `${rounded.toFixed(1)}`;
}
