import type { ComponentType } from "react";
import {
  Accessibility,
  Circle,
  CircleCheck,
  CircleX,
  Dribbble,
  Dumbbell,
  Trophy,
} from "lucide-react";
import { SportShoeIcon } from "@/features/calendar/WorkoutIcons";
import { getTodayDateKey } from "@/lib/calendar";
import type { WorkoutEventType, WorkoutFilters, WorkoutNote } from "@/lib/workouts/schema";

type WorkoutEventTypeIcon = ComponentType<{ className?: string }>;
export type WorkoutStatusTone = "completed" | "default" | "overdue";

const EVENT_TYPE_META: Record<WorkoutEventType, { icon: WorkoutEventTypeIcon; label: string }> = {
  run: { icon: SportShoeIcon, label: "Run" },
  basketball: { icon: Dribbble, label: "Basketball" },
  strength: { icon: Dumbbell, label: "Strength" },
  mobility: { icon: Accessibility, label: "Mobility" },
  race: { icon: Trophy, label: "Race" },
};

export const DEFAULT_EVENT_TYPES: WorkoutEventType[] = ["run", "race"];

export function getWorkoutEventTypeMeta(eventType: WorkoutEventType) {
  return EVENT_TYPE_META[eventType];
}

export function hasDefaultEventTypes(eventTypes: WorkoutFilters["eventType"]) {
  return (
    eventTypes.length === DEFAULT_EVENT_TYPES.length &&
    DEFAULT_EVENT_TYPES.every((item) => eventTypes.includes(item))
  );
}

export function toggleWorkoutEventType(
  eventTypes: WorkoutFilters["eventType"],
  item: WorkoutEventType,
): WorkoutFilters["eventType"] {
  const selected = eventTypes.includes(item);
  if (selected) {
    const nextEventTypes = eventTypes.filter((eventType) => eventType !== item);
    return nextEventTypes.length > 0 ? nextEventTypes : eventTypes;
  }

  return [...eventTypes, item];
}

export function getWorkoutStatusTone(workout: WorkoutNote): WorkoutStatusTone {
  if (workout.completed) {
    return "completed";
  }

  if (workout.date < getTodayDateKey()) {
    return "overdue";
  }

  return "default";
}

export function getWorkoutCardToneClasses(tone: WorkoutStatusTone, selected: boolean) {
  if (selected) {
    return "bg-primary text-primary-foreground hover:bg-primary/90";
  }

  if (tone === "overdue") {
    return "bg-rose-100/85 text-foreground hover:bg-rose-200/80";
  }

  if (tone === "completed") {
    return "bg-emerald-100/80 text-foreground hover:bg-emerald-200/70";
  }

  return "bg-surface-panel-alt text-foreground hover:bg-surface-hero/65";
}

export function getWorkoutStatusIconMeta(tone: WorkoutStatusTone) {
  if (tone === "completed") {
    return {
      className: "text-emerald-700",
      icon: CircleCheck,
      label: "Completed",
    };
  }

  if (tone === "overdue") {
    return {
      className: "text-rose-700",
      icon: CircleX,
      label: "Overdue",
    };
  }

  return {
    className: "text-muted-foreground",
    icon: Circle,
    label: "Planned",
  };
}
