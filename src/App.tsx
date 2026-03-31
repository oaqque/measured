import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { format } from "date-fns";
import {
  CalendarDays,
  FileText,
  GripVertical,
  ListFilter,
  NotebookText,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { RouteMap } from "@/components/RouteMap";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  allWorkouts,
  availableEventTypes,
  filterWorkouts,
  formatCompletedTimestamp,
  formatDisplayDate,
  formatDistance,
  generatedAt,
  getWorkoutBySlug,
  groupWorkoutsByMonth,
  trainingPlan,
  welcomeDocument,
} from "@/lib/workouts/load";
import type { WorkoutFilters, WorkoutNote } from "@/lib/workouts/schema";
import { cn } from "@/lib/utils";

type View = "welcome" | "plan" | "calendar";
type MonthGroup = ReturnType<typeof groupWorkoutsByMonth>[number];
type WorkoutStatus = WorkoutFilters["status"];
type ActiveResizePanel = "left" | "right";

const FINGERPRINT_STROKES = [
  { color: "#1d2a6d", d: "M2 12a10 10 0 0 1 18-6" },
  { color: "#24479d", d: "M9 6.8a6 6 0 0 1 9 5.2v2" },
  { color: "#1f63d2", d: "M21.8 16c.2-2 .131-5.354 0-6" },
  { color: "#2388ef", d: "M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" },
  { color: "#39b8ff", d: "M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" },
  { color: "#63ddff", d: "M14 13.12c0 2.38 0 6.38-1 8.88" },
  { color: "#8ef2ff", d: "M17.29 21.02c.12-.6.43-2.3.5-3.02" },
  { color: "#c6fbff", d: "M8.65 22c.21-.66.45-1.32.57-2" },
  { color: "#ffffff", d: "M2 16h.01" },
] as const;
const LEFT_SIDEBAR_MIN_WIDTH = 240;
const LEFT_SIDEBAR_MAX_WIDTH = 420;
const RIGHT_SIDEBAR_MIN_WIDTH = 320;
const RIGHT_SIDEBAR_MAX_WIDTH = 960;
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 520;

export default function App() {
  const [view, setView] = usePathView();
  const [selectedWorkoutSlug, setSelectedWorkoutSlug] = useState<string | null>(null);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(296);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(RIGHT_SIDEBAR_DEFAULT_WIDTH);
  const [eventType, setEventType] = useState<string>("all");
  const [status, setStatus] = useState<WorkoutStatus>("all");
  const [selectedMonthKey, setSelectedMonthKey] = useState("");
  const [activeResizePanel, setActiveResizePanel] = useState<ActiveResizePanel | null>(null);
  const resizeStateRef = useRef<{
    panel: ActiveResizePanel;
    startX: number;
    startWidth: number;
  } | null>(null);

  const filteredWorkouts = useMemo(
    () =>
      filterWorkouts({
        query: "",
        eventType,
        status,
      }),
    [eventType, status],
  );
  const monthGroups = useMemo(() => groupWorkoutsByMonth(filteredWorkouts), [filteredWorkouts]);
  const selectedWorkout = selectedWorkoutSlug ? getWorkoutBySlug(selectedWorkoutSlug) : null;
  const stravaRunCount = useMemo(
    () => allWorkouts.filter((workout) => workout.stravaId !== null).length,
    [],
  );
  const selectedMonth =
    monthGroups.find((month) => month.key === selectedMonthKey) ?? monthGroups[0] ?? null;

  useEffect(() => {
    if (selectedMonthKey.length === 0 && monthGroups[0]) {
      setSelectedMonthKey(resolveDefaultMonthKey(monthGroups));
      return;
    }

    if (selectedMonthKey && !monthGroups.some((month) => month.key === selectedMonthKey)) {
      setSelectedMonthKey(resolveDefaultMonthKey(monthGroups));
    }
  }, [monthGroups, selectedMonthKey]);

  useEffect(() => {
    if (selectedWorkoutSlug && !selectedWorkout) {
      setSelectedWorkoutSlug(null);
    }
  }, [selectedWorkout, selectedWorkoutSlug]);

  useEffect(() => {
    if (!selectedWorkout) {
      return;
    }

    setRightSidebarOpen(true);
  }, [selectedWorkout]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      if (resizeState.panel === "left") {
        const nextWidth = clampNumber(
          resizeState.startWidth + (event.clientX - resizeState.startX),
          LEFT_SIDEBAR_MIN_WIDTH,
          LEFT_SIDEBAR_MAX_WIDTH,
        );
        setLeftSidebarWidth(nextWidth);
        return;
      }

      const nextWidth = clampNumber(
        resizeState.startWidth - (event.clientX - resizeState.startX),
        RIGHT_SIDEBAR_MIN_WIDTH,
        RIGHT_SIDEBAR_MAX_WIDTH,
      );
      setRightSidebarWidth(nextWidth);
    };

    const handlePointerUp = () => {
      setActiveResizePanel(null);
      resizeStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const navigateToView = (nextView: View) => {
    if (nextView !== "calendar") {
      setSelectedWorkoutSlug(null);
      setRightSidebarOpen(false);
    } else {
      setSelectedMonthKey((current) => {
        if (current && monthGroups.some((month) => month.key === current)) {
          return current;
        }

        return resolveDefaultMonthKey(monthGroups);
      });
    }

    setView(nextView);
  };

  const openWorkout = (slug: string) => {
    const workout = getWorkoutBySlug(slug);
    if (!workout) {
      return;
    }

    setEventType("all");
    setStatus("all");
    setSelectedMonthKey(workout.date.slice(0, 7));
    setSelectedWorkoutSlug(slug);
    setRightSidebarOpen(true);
    setView("calendar");
  };

  const startResize = (panel: ActiveResizePanel, event: ReactPointerEvent<HTMLDivElement>) => {
    resizeStateRef.current = {
      panel,
      startX: event.clientX,
      startWidth: panel === "left" ? leftSidebarWidth : rightSidebarWidth,
    };
    setActiveResizePanel(panel);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleMarkdownLink = (href: string) => {
    if (href === "README.md") {
      navigateToView("plan");
      return true;
    }

    if (href === "WELCOME.md") {
      navigateToView("welcome");
      return true;
    }

    if (href === "notes" || href === "notes/") {
      navigateToView("calendar");
      return true;
    }

    const slug = workoutHrefToSlug(href);
    if (!slug) {
      return false;
    }

    openWorkout(slug);
    return true;
  };

  return (
    <div className="h-screen overflow-hidden bg-page text-foreground">
      <div className="flex h-full">
        <aside
          className="hidden shrink-0 overflow-hidden border-r border-foreground/10 bg-background/55 lg:block"
          style={{ width: `${leftSidebarWidth}px` }}
        >
          <div className="h-full overflow-y-auto px-8 py-8">
            <div className="mx-auto w-full max-w-44">
              <BrandMark className="block h-auto w-full" />
            </div>

            <div className="mt-5 text-center">
              <p className="text-3xl font-black md:text-4xl">measured.</p>
            </div>

            <nav className="mt-8 grid gap-2 border-t border-foreground/10 pt-6 text-sm">
              <SidebarNavButton
                active={view === "welcome"}
                icon={<NotebookText className="size-4" />}
                label="Welcome"
                onClick={() => navigateToView("welcome")}
              />
              <SidebarNavButton
                active={view === "plan"}
                icon={<FileText className="size-4" />}
                label="Plan"
                onClick={() => navigateToView("plan")}
              />
              <SidebarNavButton
                active={view === "calendar"}
                icon={<CalendarDays className="size-4" />}
                label="Calendar"
                onClick={() => navigateToView("calendar")}
              />
            </nav>

            <dl className="mt-8 grid gap-5 border-t border-foreground/10 pt-6 text-sm">
              <MetadataRow label="Notes loaded" value={String(allWorkouts.length)} />
              <MetadataRow label="Strava runs loaded" value={String(stravaRunCount)} />
              <MetadataRow label="Generated" value={formatTimestamp(generatedAt)} />
            </dl>
          </div>
        </aside>

        <ResizeHandle
          className="hidden lg:flex"
          onPointerDown={(event) => startResize("left", event)}
        />

        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <header className="z-20 border-b border-foreground/10 bg-background/85 backdrop-blur">
            <div className="flex h-14 items-center justify-between gap-4 px-4 md:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-sm font-black text-foreground">
                  measured.
                </span>
                <span className="hidden text-sm text-muted-foreground md:inline">
                  {formatViewLabel(view)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  aria-label={rightSidebarOpen ? "Hide details" : "Show details"}
                  className="size-9 rounded-[0.35rem] p-0"
                  type="button"
                  variant="secondary"
                  onClick={() => setRightSidebarOpen((current) => !current)}
                >
                  {rightSidebarOpen ? (
                    <PanelRightClose className="size-4" />
                  ) : (
                    <PanelRightOpen className="size-4" />
                  )}
                  <span className="sr-only">{rightSidebarOpen ? "Hide details" : "Show details"}</span>
                </Button>
              </div>
            </div>
          </header>

          <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <main className="h-full min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-6 md:py-8 lg:px-10 lg:py-10">
              {view === "welcome" ? (
                <MarkdownPage content={welcomeDocument.body} onLinkClick={handleMarkdownLink} />
              ) : view === "plan" ? (
                <MarkdownPage content={trainingPlan.body} onLinkClick={handleMarkdownLink} />
              ) : (
                <CalendarView
                  eventType={eventType}
                  monthGroups={monthGroups}
                  selectedMonth={selectedMonth}
                  selectedWorkoutSlug={selectedWorkoutSlug}
                  status={status}
                  onEventTypeChange={setEventType}
                  onMonthChange={setSelectedMonthKey}
                  onSelectWorkout={openWorkout}
                  onStatusChange={setStatus}
                />
              )}
            </main>

            <div
              aria-hidden={!rightSidebarOpen}
              className={cn(
                "absolute inset-0 z-30 bg-foreground/10 transition-opacity lg:hidden",
                rightSidebarOpen ? "opacity-100" : "pointer-events-none opacity-0",
              )}
              onClick={() => setRightSidebarOpen(false)}
            />

            <div
              className={cn(
                "hidden overflow-hidden lg:flex",
                activeResizePanel === "right" ? "transition-none" : "transition-[width,opacity] duration-300 ease-out",
                rightSidebarOpen ? "w-4 opacity-100" : "pointer-events-none w-0 opacity-0",
              )}
            >
              <ResizeHandle
                className="flex"
                onPointerDown={(event) => startResize("right", event)}
              />
            </div>

            <aside
              aria-hidden={!rightSidebarOpen}
              className={cn(
                "absolute bottom-0 right-0 top-0 z-40 overflow-hidden lg:static lg:z-auto",
                activeResizePanel === "right"
                  ? "transition-none"
                  : "transition-[transform,opacity] duration-300 ease-out lg:transition-[width,opacity]",
                rightSidebarOpen
                  ? "translate-x-0 opacity-100"
                  : "pointer-events-none translate-x-full opacity-0 lg:translate-x-0",
              )}
              style={{
                width: rightSidebarOpen ? `${rightSidebarWidth}px` : "0px",
                maxWidth: "100vw",
              }}
            >
              {rightSidebarOpen ? (
                <div className="h-full w-[min(28rem,100vw)] border-l border-foreground/10 bg-background/95 backdrop-blur lg:w-full lg:bg-background/65 lg:backdrop-blur-0">
                  <div className="h-full overflow-y-auto px-4 py-6 lg:px-6 lg:py-8">
                    {selectedWorkout ? (
                      <WorkoutDetailPanel workout={selectedWorkout} />
                    ) : (
                      <div className="flex h-full items-center justify-center">
                        <div className="max-w-xs text-center">
                          <p className="text-sm font-black uppercase text-muted-foreground">
                            Details
                          </p>
                          <p className="mt-3 text-sm leading-6 text-muted-foreground">
                            Open a workout note from the calendar to inspect its metadata and full
                            note content here.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

function MarkdownPage({
  content,
  onLinkClick,
}: {
  content: string;
  onLinkClick?: (href: string) => boolean;
}) {
  return (
    <div className="py-2">
      <div className="markdown-prose">
        <MarkdownContent content={content} onLinkClick={onLinkClick} />
      </div>
    </div>
  );
}

function CalendarView({
  eventType,
  status,
  monthGroups,
  selectedMonth,
  selectedWorkoutSlug,
  onEventTypeChange,
  onStatusChange,
  onMonthChange,
  onSelectWorkout,
}: {
  eventType: string;
  status: WorkoutStatus;
  monthGroups: MonthGroup[];
  selectedMonth: MonthGroup | null;
  selectedWorkoutSlug: string | null;
  onEventTypeChange: (value: string) => void;
  onStatusChange: (value: WorkoutStatus) => void;
  onMonthChange: (value: string) => void;
  onSelectWorkout: (slug: string) => void;
}) {
  return (
    <section className="py-2">
      <div className="border-t border-foreground/10 pt-5">
        <div className="flex items-center justify-end gap-2">
          <MonthPicker
            monthGroups={monthGroups}
            selectedMonth={selectedMonth}
            onMonthChange={onMonthChange}
          />

          <CalendarFilterMenu
            eventType={eventType}
            status={status}
            onEventTypeChange={onEventTypeChange}
            onStatusChange={onStatusChange}
          />
        </div>

        {selectedMonth ? (
          <CalendarMonthGrid
            month={selectedMonth}
            selectedWorkoutSlug={selectedWorkoutSlug}
            onSelectWorkout={onSelectWorkout}
          />
        ) : (
          <div className="border-t border-foreground/10 py-10">
            <p className="text-sm text-muted-foreground">
              No workouts match the current filter set.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function MonthPicker({
  monthGroups,
  selectedMonth,
  onMonthChange,
}: {
  monthGroups: MonthGroup[];
  selectedMonth: MonthGroup | null;
  onMonthChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedMonthKey = selectedMonth?.key ?? "";
  const selectedDate = selectedMonthKey ? monthKeyToDate(selectedMonthKey) : undefined;
  const [pickerMonth, setPickerMonth] = useState<Date>(() => selectedDate ?? new Date());
  const allowedMonthKeys = useMemo(
    () => new Set(monthGroups.map((month) => month.key)),
    [monthGroups],
  );

  useEffect(() => {
    if (selectedMonthKey) {
      setPickerMonth(monthKeyToDate(selectedMonthKey));
    }
  }, [selectedMonthKey]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          className="h-10 min-w-40 justify-between rounded-[0.35rem] px-3 py-0"
          disabled={monthGroups.length === 0}
          type="button"
          variant="secondary"
        >
          <span>{selectedMonth?.label ?? "Pick month"}</span>
          <CalendarDays className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        avoidCollisions={false}
        className="w-auto p-0"
        side="bottom"
      >
        <Calendar
          className="rounded-[0.35rem]"
          disabled={(date) => !allowedMonthKeys.has(format(date, "yyyy-MM"))}
          mode="single"
          month={pickerMonth}
          selected={selectedDate}
          onMonthChange={setPickerMonth}
          onSelect={(date) => {
            if (!date) {
              return;
            }

            const monthKey = format(date, "yyyy-MM");
            if (!allowedMonthKeys.has(monthKey)) {
              return;
            }

            onMonthChange(monthKey);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function CalendarFilterMenu({
  eventType,
  status,
  onEventTypeChange,
  onStatusChange,
}: {
  eventType: string;
  status: WorkoutStatus;
  onEventTypeChange: (value: string) => void;
  onStatusChange: (value: WorkoutStatus) => void;
}) {
  const activeFilterCount = Number(eventType !== "all") + Number(status !== "all");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={
            activeFilterCount > 0 ? `Filters active: ${activeFilterCount}` : "Open filters"
          }
          className="h-10 w-10 rounded-[0.35rem] p-0"
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
        <DropdownMenuLabel>Add filter</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          checked={status === "planned"}
          onCheckedChange={(checked) => onStatusChange(checked ? "planned" : "all")}
        >
          Add filter: planned only
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={status === "completed"}
          onCheckedChange={(checked) => onStatusChange(checked ? "completed" : "all")}
        >
          Add filter: completed only
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Add filter</DropdownMenuLabel>
        {availableEventTypes.map((item) => (
          <DropdownMenuCheckboxItem
            checked={eventType === item}
            key={item}
            onCheckedChange={(checked) => onEventTypeChange(checked ? item : "all")}
          >
            {`Add filter: ${toTitleCase(item)}`}
          </DropdownMenuCheckboxItem>
        ))}

        {activeFilterCount > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                onEventTypeChange("all");
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

function CalendarMonthGrid({
  month,
  selectedWorkoutSlug,
  onSelectWorkout,
}: {
  month: MonthGroup;
  selectedWorkoutSlug: string | null;
  onSelectWorkout: (slug: string) => void;
}) {
  const cells = useMemo(() => buildCalendarCells(month), [month]);

  return (
    <div className="mt-8">
      <div className="grid grid-cols-7 border-t border-l border-foreground/10 text-[10px] font-extrabold uppercase text-muted-foreground">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <div className="border-r border-b border-foreground/10 px-2 py-1" key={day}>
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 border-l border-foreground/10 sm:grid-cols-2 lg:grid-cols-7">
        {cells.map((cell) => (
          <div
            className={cn(
              "min-h-28 border-r border-b border-foreground/10 px-2 py-2",
              cell.date ? "bg-transparent" : "bg-background/40",
            )}
            key={cell.key}
          >
            {cell.date ? (
              <div className="flex h-full flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-black">{Number(cell.date.slice(-2))}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {cell.workouts.length === 0 ? "Rest" : `${cell.workouts.length} item${cell.workouts.length === 1 ? "" : "s"}`}
                  </p>
                </div>

                <div className="flex flex-col gap-1">
                  {cell.workouts.map((workout) => {
                    const selected = workout.slug === selectedWorkoutSlug;

                    return (
                      <Button
                        className="h-auto w-full items-start justify-start rounded-[0.35rem] px-2 py-1.5 text-left whitespace-normal"
                        key={workout.slug}
                        type="button"
                        variant={selected ? "default" : "secondary"}
                        onClick={() => onSelectWorkout(workout.slug)}
                      >
                        <span className="flex w-full flex-col gap-1">
                          <span className="text-[10px] font-extrabold uppercase opacity-70">
                            {toTitleCase(workout.eventType)}
                          </span>
                          <span className="text-[13px] leading-[1rem]">{workout.title}</span>
                          <span
                            className={cn(
                              "text-[11px] opacity-70",
                              selected ? "text-primary-foreground" : "text-muted-foreground",
                            )}
                          >
                            {workout.completed ? "Completed" : "Planned"}
                            {(workout.completed
                              ? workout.actualDistanceKm
                              : workout.expectedDistanceKm) !== null
                              ? ` · ${formatDistance(
                                  workout.completed
                                    ? workout.actualDistanceKm
                                    : workout.expectedDistanceKm,
                                )}`
                              : ""}
                          </span>
                        </span>
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkoutDetailPanel({
  workout,
}: {
  workout: WorkoutNote;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b border-foreground/10 pb-4">
        <div className="min-w-0">
          <p className="eyebrow">Workout Note</p>
          <h2 className="mt-2 text-2xl font-black">{workout.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{formatDisplayDate(workout.date)}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 border-b border-foreground/10 pb-5 text-sm">
        <MetadataRow label="Event type" value={workout.eventType} />
        <MetadataRow label="Expected distance" value={formatDistance(workout.expectedDistanceKm)} />
        <MetadataRow label="Actual distance" value={formatDistance(workout.actualDistanceKm)} />
        <MetadataRow label="Status" value={formatCompletedTimestamp(workout.completed)} />
        <MetadataRow
          label="Strava activity"
          value={workout.stravaId === null ? "Not linked" : String(workout.stravaId)}
        />
        <MetadataRow label="All day" value={workout.allDay ? "Yes" : "No"} />
        <MetadataRow label="Type" value={workout.type} />
        <MetadataRow label="Source file" value={workout.sourcePath} />
      </div>

      {workout.summaryPolyline ? (
        <div className="mt-5 border-b border-foreground/10 pb-5">
          <RouteMap
            activityId={workout.stravaId}
            generatedAt={generatedAt}
            hasStravaStreams={workout.hasStravaStreams}
            polyline={workout.summaryPolyline}
            title={workout.title}
          />
        </div>
      ) : null}

      <div className="markdown-prose mt-5 flex-1">
        <MarkdownContent content={workout.body} />
      </div>
    </div>
  );
}

function SidebarNavButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button
      className={cn(
        "h-10 w-full justify-start rounded-[0.35rem] px-3 py-2 text-sm transition-colors duration-300",
        active
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : "bg-transparent text-foreground hover:bg-surface-panel-alt/55 hover:text-primary",
      )}
      type="button"
      variant="ghost"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </Button>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="eyebrow">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function ResizeHandle({
  className,
  onPointerDown,
}: {
  className?: string;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={cn(
        "group relative hidden w-4 shrink-0 cursor-col-resize items-stretch justify-center bg-transparent",
        className,
      )}
      onPointerDown={onPointerDown}
    >
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/10 transition-colors group-hover:bg-primary/35" />
      <div className="absolute left-1/2 top-1/2 flex size-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[0.35rem] bg-background/75 text-muted-foreground opacity-0 shadow-sm ring-1 ring-foreground/10 transition-opacity group-hover:opacity-100">
        <GripVertical className="size-4" />
      </div>
    </div>
  );
}

function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <g>
        {FINGERPRINT_STROKES.map((stroke, index) => (
          <path
            className="fingerprint-stroke"
            d={stroke.d}
            key={stroke.d}
            pathLength="1"
            style={
              {
                "--fingerprint-delay": `${index * -0.2}s`,
                "--fingerprint-stroke": stroke.color,
              } as CSSProperties
            }
          />
        ))}
      </g>
    </svg>
  );
}

function usePathView(): [View, (view: View) => void] {
  const [view, setView] = useState<View>(() =>
    typeof window === "undefined" ? "welcome" : getViewFromPath(window.location.pathname),
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!window.location.pathname || window.location.pathname === "/index.html") {
      window.history.replaceState(null, "", "/");
    }

    const handlePopState = () => {
      setView(getViewFromPath(window.location.pathname));
    };

    handlePopState();
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const navigate = (nextView: View) => {
    const nextPath =
      nextView === "calendar" ? "/calendar" : nextView === "plan" ? "/plan" : "/";

    if (window.location.pathname === nextPath) {
      setView(nextView);
      return;
    }

    window.history.pushState(null, "", nextPath);
    setView(nextView);
  };

  return [view, navigate];
}

function getViewFromPath(pathname: string): View {
  if (pathname === "/calendar") {
    return "calendar";
  }

  if (pathname === "/plan") {
    return "plan";
  }

  return "welcome";
}

function formatViewLabel(view: View) {
  if (view === "plan") {
    return "Plan";
  }

  if (view === "calendar") {
    return "Calendar";
  }

  return "Welcome";
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

function monthKeyToDate(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function resolveDefaultMonthKey(monthGroups: MonthGroup[]) {
  const todayMonthKey = getTodayMonthKey();
  return monthGroups.find((month) => month.key === todayMonthKey)?.key ?? monthGroups[0]?.key ?? "";
}

function getTodayMonthKey() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function toTitleCase(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildCalendarCells(month: MonthGroup) {
  const [year, monthNumber] = month.key.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1);
  const leadingEmptyDays = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const workoutsByDate = new Map(month.days.map((day) => [day.date, day.workouts]));
  const cells: Array<{ key: string; date: string | null; workouts: WorkoutNote[] }> = [];

  for (let index = 0; index < leadingEmptyDays; index += 1) {
    cells.push({ key: `empty-start-${index}`, date: null, workouts: [] });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month.key}-${String(day).padStart(2, "0")}`;
    cells.push({
      key: date,
      date,
      workouts: workoutsByDate.get(date) ?? [],
    });
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      key: `empty-end-${cells.length}`,
      date: null,
      workouts: [],
    });
  }

  return cells;
}

function workoutHrefToSlug(href: string) {
  const normalizedHref = href.split("#")[0]?.split("?")[0] ?? "";
  if (!normalizedHref.startsWith("notes/") || !normalizedHref.endsWith(".md")) {
    return null;
  }

  const fileName = decodeURIComponent(normalizedHref.slice("notes/".length));
  return fileName
    .replace(/\.md$/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
