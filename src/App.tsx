import {
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { CalendarDays, FileText, NotebookText, Search, X } from "lucide-react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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

export default function App() {
  const [view, setView] = useHashView();
  const [selectedWorkoutSlug, setSelectedWorkoutSlug] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [eventType, setEventType] = useState<string>("all");
  const [status, setStatus] = useState<WorkoutStatus>("all");
  const [selectedMonthKey, setSelectedMonthKey] = useState("");

  const filteredWorkouts = useMemo(
    () =>
      filterWorkouts({
        query: deferredQuery,
        eventType,
        status,
      }),
    [deferredQuery, eventType, status],
  );
  const monthGroups = useMemo(() => groupWorkoutsByMonth(filteredWorkouts), [filteredWorkouts]);
  const selectedWorkout = selectedWorkoutSlug ? getWorkoutBySlug(selectedWorkoutSlug) : null;
  const selectedMonth =
    monthGroups.find((month) => month.key === selectedMonthKey) ?? monthGroups[0] ?? null;

  useEffect(() => {
    if (selectedMonthKey.length === 0 && monthGroups[0]) {
      setSelectedMonthKey(monthGroups[0].key);
      return;
    }

    if (selectedMonthKey && !monthGroups.some((month) => month.key === selectedMonthKey)) {
      setSelectedMonthKey(monthGroups[0]?.key ?? "");
    }
  }, [monthGroups, selectedMonthKey]);

  useEffect(() => {
    if (selectedWorkoutSlug && !selectedWorkout) {
      setSelectedWorkoutSlug(null);
    }
  }, [selectedWorkout, selectedWorkoutSlug]);

  return (
    <div className="min-h-screen bg-page text-foreground">
      <div className="mx-auto min-h-screen w-full max-w-[110rem] lg:grid lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="border-b border-foreground/10 px-4 py-6 md:px-6 lg:min-h-screen lg:border-r lg:border-b-0 lg:px-8 lg:py-8">
          <div className="lg:sticky lg:top-0 lg:pt-2">
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
                onClick={() => setView("welcome")}
              />
              <SidebarNavButton
                active={view === "plan"}
                icon={<FileText className="size-4" />}
                label="Plan"
                onClick={() => setView("plan")}
              />
              <SidebarNavButton
                active={view === "calendar"}
                icon={<CalendarDays className="size-4" />}
                label="Calendar"
                onClick={() => setView("calendar")}
              />
            </nav>

            <dl className="mt-8 grid gap-5 border-t border-foreground/10 pt-6 text-sm">
              <MetadataRow label="Workouts loaded" value={String(allWorkouts.length)} />
              <MetadataRow label="Welcome source" value={welcomeDocument.sourcePath} />
              <MetadataRow label="Plan source" value={trainingPlan.sourcePath} />
              <MetadataRow label="Generated" value={formatTimestamp(generatedAt)} />
            </dl>
          </div>
        </aside>

        <div className="relative min-w-0 lg:flex">
          <main className="min-w-0 flex-1 px-4 py-6 md:px-6 md:py-8 lg:px-10 lg:py-10">
            {view === "welcome" ? (
              <MarkdownPage content={welcomeDocument.body} />
            ) : view === "plan" ? (
              <MarkdownPage content={trainingPlan.body} />
            ) : (
              <CalendarView
                eventType={eventType}
                monthGroups={monthGroups}
                query={query}
                selectedMonth={selectedMonth}
                selectedWorkoutSlug={selectedWorkoutSlug}
                status={status}
                onEventTypeChange={setEventType}
                onMonthChange={setSelectedMonthKey}
                onQueryChange={setQuery}
                onSelectWorkout={setSelectedWorkoutSlug}
                onStatusChange={setStatus}
              />
            )}
          </main>

          <div
            aria-hidden={!selectedWorkout}
            className={cn(
              "fixed inset-0 z-30 bg-foreground/10 transition-opacity lg:hidden",
              selectedWorkout ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            onClick={() => setSelectedWorkoutSlug(null)}
          />

          <aside
            className={cn(
              "fixed inset-y-0 right-0 z-40 w-[min(28rem,100vw)] border-l border-foreground/10 bg-background/95 px-4 py-6 backdrop-blur transition-[transform,width] duration-300 lg:static lg:z-auto lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-0",
              selectedWorkout
                ? "translate-x-0 lg:w-[24rem] xl:w-[28rem]"
                : "pointer-events-none translate-x-full lg:pointer-events-none lg:w-0 lg:translate-x-0",
            )}
          >
            <div
              className={cn(
                "h-full overflow-y-auto lg:sticky lg:top-0 lg:h-screen lg:px-6 lg:py-10",
                selectedWorkout ? "opacity-100" : "opacity-0",
              )}
            >
              {selectedWorkout ? (
                <WorkoutDetailPanel
                  workout={selectedWorkout}
                  onClose={() => setSelectedWorkoutSlug(null)}
                />
              ) : null}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function MarkdownPage({ content }: { content: string }) {
  return (
    <div className="py-2">
      <div className="markdown-prose">
        <MarkdownContent content={content} />
      </div>
    </div>
  );
}

function CalendarView({
  query,
  eventType,
  status,
  monthGroups,
  selectedMonth,
  selectedWorkoutSlug,
  onQueryChange,
  onEventTypeChange,
  onStatusChange,
  onMonthChange,
  onSelectWorkout,
}: {
  query: string;
  eventType: string;
  status: WorkoutStatus;
  monthGroups: MonthGroup[];
  selectedMonth: MonthGroup | null;
  selectedWorkoutSlug: string | null;
  onQueryChange: (value: string) => void;
  onEventTypeChange: (value: string) => void;
  onStatusChange: (value: WorkoutStatus) => void;
  onMonthChange: (value: string) => void;
  onSelectWorkout: (slug: string) => void;
}) {
  return (
    <section className="py-2">
      <div className="mb-3 flex items-center gap-2">
        <CalendarDays className="size-4 text-muted-foreground" />
        <p className="eyebrow">Calendar</p>
      </div>

      <div className="border-t border-foreground/10 pt-5">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-black md:text-4xl">Workout calendar</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Search titles and note bodies, filter the note set, then open any workout in the
            right sidebar.
          </p>
        </div>

        <div className="mt-6 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,0.8fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-11"
              placeholder="Search workout notes"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </div>

          <Select value={eventType} onChange={(event) => onEventTypeChange(event.target.value)}>
            <option value="all">All event types</option>
            {availableEventTypes.map((item) => (
              <option key={item} value={item}>
                {toTitleCase(item)}
              </option>
            ))}
          </Select>

          <Select
            value={status}
            onChange={(event) => onStatusChange(event.target.value as WorkoutStatus)}
          >
            <option value="all">All statuses</option>
            <option value="planned">Planned only</option>
            <option value="completed">Completed only</option>
          </Select>

          <Select
            disabled={monthGroups.length === 0}
            value={selectedMonth?.key ?? ""}
            onChange={(event) => onMonthChange(event.target.value)}
          >
            {monthGroups.length === 0 ? (
              <option value="">No matching months</option>
            ) : (
              monthGroups.map((month) => (
                <option key={month.key} value={month.key}>
                  {month.label}
                </option>
              ))
            )}
          </Select>
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
              No workouts match the current search and filter set.
            </p>
          </div>
        )}
      </div>
    </section>
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
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black md:text-3xl">{month.label}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {month.days.reduce((sum, day) => sum + day.workouts.length, 0)} workouts in view.
          </p>
        </div>
      </div>

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
                            {workout.expectedDistanceKm !== null
                              ? ` · ${formatDistance(workout.expectedDistanceKm)}`
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
  onClose,
}: {
  workout: WorkoutNote;
  onClose: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start gap-3 border-b border-foreground/10 pb-4">
        <div className="min-w-0">
          <p className="eyebrow">Workout Note</p>
          <h2 className="mt-2 text-2xl font-black">{workout.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{formatDisplayDate(workout.date)}</p>
        </div>
        <Button
          className="ml-auto size-9 shrink-0 rounded-[0.35rem] p-0"
          type="button"
          variant="secondary"
          onClick={onClose}
        >
          <X className="size-4" />
          <span className="sr-only">Close note</span>
        </Button>
      </div>

      <div className="mt-5 grid gap-4 border-b border-foreground/10 pb-5 text-sm">
        <MetadataRow label="Event type" value={workout.eventType} />
        <MetadataRow label="Expected distance" value={formatDistance(workout.expectedDistanceKm)} />
        <MetadataRow label="Status" value={formatCompletedTimestamp(workout.completed)} />
        <MetadataRow label="All day" value={workout.allDay ? "Yes" : "No"} />
        <MetadataRow label="Type" value={workout.type} />
        <MetadataRow label="Source file" value={workout.sourcePath} />
      </div>

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

function useHashView(): [View, (view: View) => void] {
  const [view, setView] = useState<View>(() =>
    typeof window === "undefined" ? "welcome" : getViewFromHash(window.location.hash),
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!window.location.hash) {
      window.history.replaceState(null, "", "#welcome");
    }

    const handleHashChange = () => {
      setView(getViewFromHash(window.location.hash));
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  const navigate = (nextView: View) => {
    const nextHash =
      nextView === "calendar" ? "#calendar" : nextView === "plan" ? "#plan" : "#welcome";

    if (window.location.hash === nextHash) {
      setView(nextView);
      return;
    }

    window.location.hash = nextHash;
  };

  return [view, navigate];
}

function getViewFromHash(hash: string): View {
  if (hash === "#calendar") {
    return "calendar";
  }

  if (hash === "#plan") {
    return "plan";
  }

  return "welcome";
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
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
