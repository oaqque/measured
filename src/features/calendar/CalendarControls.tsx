import { useState } from "react";
import { Calendar1, ListFilter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_EVENT_TYPES, getWorkoutEventTypeMeta, hasDefaultEventTypes, toggleWorkoutEventType } from "@/features/calendar/calendarMeta";
import { useMediaQuery } from "@/features/calendar/useMediaQuery";
import { formatDateKey, formatMonthLabel, parseDateKey } from "@/lib/calendar";
import { availableEventTypes } from "@/lib/workouts/load";
import type { WorkoutFilters } from "@/lib/workouts/schema";
import { cn } from "@/lib/utils";

type WorkoutStatus = WorkoutFilters["status"];

export function CalendarControls({
  calendarFocusDate,
  eventType,
  status,
  todayDateKey,
  onEventTypeChange,
  onFocusDateChange,
  onStatusChange,
}: {
  calendarFocusDate: string;
  eventType: WorkoutFilters["eventType"];
  status: WorkoutStatus;
  todayDateKey: string;
  onEventTypeChange: (value: WorkoutFilters["eventType"]) => void;
  onFocusDateChange: (value: string) => void;
  onStatusChange: (value: WorkoutStatus) => void;
}) {
  const isDesktopViewport = useMediaQuery("(min-width: 1024px)");

  return (
    <div className="flex items-stretch gap-2 lg:inline-flex lg:flex-wrap lg:items-stretch lg:gap-0">
      <Button
        aria-label="Jump to today"
        className="size-10 shrink-0 rounded-[0.5rem] p-0 lg:rounded-none lg:rounded-l-[0.35rem] lg:border-r lg:border-foreground/10"
        data-clickable="true"
        type="button"
        variant="secondary"
        onClick={() => onFocusDateChange(todayDateKey)}
      >
        <Calendar1 className="size-4" />
        <span className="sr-only">Jump to today</span>
      </Button>

      <MonthPicker
        selectedDateKey={calendarFocusDate}
        triggerClassName="min-w-0 flex-1 rounded-[0.5rem] px-4 lg:min-w-44 lg:rounded-none lg:border-r lg:border-foreground/10 lg:px-3"
        onDateChange={onFocusDateChange}
      />

      {isDesktopViewport ? (
        <DesktopEventTypeFilters eventType={eventType} onEventTypeChange={onEventTypeChange} />
      ) : null}

      <CalendarFilterMenu
        eventType={eventType}
        includeEventTypes={!isDesktopViewport}
        status={status}
        triggerClassName="size-10 shrink-0 rounded-[0.5rem] p-0 lg:rounded-none lg:rounded-r-[0.35rem]"
        onEventTypeChange={onEventTypeChange}
        onStatusChange={onStatusChange}
      />
    </div>
  );
}

function DesktopEventTypeFilters({
  eventType,
  onEventTypeChange,
}: {
  eventType: WorkoutFilters["eventType"];
  onEventTypeChange: (value: WorkoutFilters["eventType"]) => void;
}) {
  return (
    <div className="hidden lg:inline-flex lg:items-stretch">
      {availableEventTypes.map((item) => {
        const EventTypeIcon = getWorkoutEventTypeMeta(item).icon;
        const selected = eventType.includes(item);
        const label = getWorkoutEventTypeMeta(item).label;

        return (
          <Button
            aria-label={`${selected ? "Hide" : "Show"} ${label}`}
            className={cn(
              "size-10 rounded-none border-r border-foreground/10 p-0",
              selected
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-surface-panel-alt text-foreground hover:bg-surface-hero/65",
            )}
            data-clickable="true"
            key={item}
            type="button"
            variant="secondary"
            onClick={() => onEventTypeChange(toggleWorkoutEventType(eventType, item))}
          >
            <EventTypeIcon className="size-4" />
            <span className="sr-only">{`${selected ? "Hide" : "Show"} ${label}`}</span>
          </Button>
        );
      })}
    </div>
  );
}

function MonthPicker({
  selectedDateKey,
  triggerClassName,
  onDateChange,
}: {
  selectedDateKey: string;
  triggerClassName?: string;
  onDateChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedDate = selectedDateKey ? parseDateKey(selectedDateKey) : undefined;
  const [pickerMonthOverride, setPickerMonthOverride] = useState<Date | null>(null);
  const isMobileViewport = useMediaQuery("(max-width: 1023px)");
  const selectedMonthLabel = selectedDate ? formatMonthLabel(selectedDateKey) : "Pick month";
  const pickerMonth = pickerMonthOverride ?? selectedDate ?? new Date();

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setPickerMonthOverride(selectedDate ?? new Date());
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          className={cn(
            "min-h-10 min-w-44 justify-between rounded-[0.35rem] px-3 py-2",
            triggerClassName,
          )}
          data-clickable="true"
          disabled={!selectedDateKey}
          type="button"
          variant="secondary"
        >
          <span className="flex min-w-0 flex-col items-start text-left leading-tight">
            <span className="truncate">{selectedMonthLabel}</span>
          </span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align={isMobileViewport ? "center" : "end"}
        className="w-auto p-0"
        side={isMobileViewport ? "top" : "bottom"}
      >
        <Calendar
          className="rounded-[0.35rem]"
          mode="single"
          month={pickerMonth}
          selected={selectedDate}
          onMonthChange={setPickerMonthOverride}
          onSelect={(date) => {
            if (!date) {
              return;
            }

            onDateChange(formatDateKey(date));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function CalendarFilterMenu({
  eventType,
  includeEventTypes = true,
  status,
  triggerClassName,
  onEventTypeChange,
  onStatusChange,
}: {
  eventType: WorkoutFilters["eventType"];
  includeEventTypes?: boolean;
  status: WorkoutStatus;
  triggerClassName?: string;
  onEventTypeChange: (value: WorkoutFilters["eventType"]) => void;
  onStatusChange: (value: WorkoutStatus) => void;
}) {
  const activeFilterCount = Number(!hasDefaultEventTypes(eventType)) + Number(status !== "all");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={activeFilterCount > 0 ? `Filters active: ${activeFilterCount}` : "Open filters"}
          className={cn("size-10 rounded-[0.35rem] p-0", triggerClassName)}
          data-clickable="true"
          type="button"
          variant="secondary"
        >
          <ListFilter className="size-4" />
          <span className="sr-only">
            {activeFilterCount > 0 ? `Filters active: ${activeFilterCount}` : "Open filters"}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuCheckboxItem
          checked={status === "planned"}
          onCheckedChange={(checked) => onStatusChange(checked ? "planned" : "all")}
        >
          Planned
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={status === "completed"}
          onCheckedChange={(checked) => onStatusChange(checked ? "completed" : "all")}
        >
          Completed
        </DropdownMenuCheckboxItem>

        {includeEventTypes ? (
          <>
            <DropdownMenuSeparator />
            {availableEventTypes.map((item) => {
              const EventTypeIcon = getWorkoutEventTypeMeta(item).icon;
              const selected = eventType.includes(item);

              return (
                <DropdownMenuCheckboxItem
                  checked={selected}
                  key={item}
                  onCheckedChange={() => onEventTypeChange(toggleWorkoutEventType(eventType, item))}
                >
                  <EventTypeIcon className="size-4" />
                  {getWorkoutEventTypeMeta(item).label}
                </DropdownMenuCheckboxItem>
              );
            })}
          </>
        ) : null}

        {activeFilterCount > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                onEventTypeChange(DEFAULT_EVENT_TYPES);
                onStatusChange("all");
              }}
            >
              Clear filters
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
