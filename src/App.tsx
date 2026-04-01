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
  ArrowDown,
  ArrowUp,
  CalendarDays,
  FileText,
  GripVertical,
  History,
  ListFilter,
  Menu,
  NotebookText,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { MobileDetailSheet } from "@/components/MobileDetailSheet";
import { MarkdownContent } from "@/components/MarkdownContent";
import { RouteMap } from "@/components/RouteMap";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
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
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  allChangelogEntries,
  allWorkouts,
  availableEventTypes,
  filterWorkouts,
  formatChangelogDate,
  formatCompletedTimestamp,
  formatDisplayDate,
  formatDistance,
  generatedAt,
  getChangelogEntriesForFile,
  getWorkoutBySlug,
  groupWorkoutsByMonth,
  trainingPlan,
  welcomeDocument,
} from "@/lib/workouts/load";
import type { ChangelogEntry, WorkoutFilters, WorkoutNote } from "@/lib/workouts/schema";
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
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
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
  const welcomeChanges = useMemo(
    () => getChangelogEntriesForFile(welcomeDocument.sourcePath),
    [],
  );
  const planChanges = useMemo(
    () => getChangelogEntriesForFile(trainingPlan.sourcePath),
    [],
  );
  const selectedWorkoutChanges = useMemo(
    () => (selectedWorkout ? getChangelogEntriesForFile(selectedWorkout.sourcePath) : []),
    [selectedWorkout],
  );
  const changelogFocusedFile = useMemo(() => {
    if (selectedWorkout) {
      return selectedWorkout.sourcePath;
    }

    if (view === "welcome") {
      return welcomeDocument.sourcePath;
    }

    if (view === "plan") {
      return trainingPlan.sourcePath;
    }

    return null;
  }, [selectedWorkout, trainingPlan.sourcePath, view, welcomeDocument.sourcePath]);
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
      if (resizeStateRef.current) {
        setActiveResizePanel(null);
        resizeStateRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, []);

  const navigateToView = (nextView: View) => {
    setMobileNavOpen(false);
    setChangelogOpen(false);

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
    const normalizedHref = href.split("#")[0]?.split("?")[0] ?? href;

    if (normalizedHref === "README.md") {
      navigateToView("plan");
      return true;
    }

    if (normalizedHref === "WELCOME.md") {
      navigateToView("welcome");
      return true;
    }

    if (normalizedHref === "changelog" || normalizedHref === "changelog/") {
      setChangelogOpen(true);
      return true;
    }

    if (normalizedHref === "notes" || normalizedHref === "notes/") {
      navigateToView("calendar");
      return true;
    }

    const slug = workoutHrefToSlug(normalizedHref);
    if (!slug) {
      return false;
    }

    openWorkout(slug);
    return true;
  };

  const handleChangelogLink = (href: string) => {
    setChangelogOpen(false);
    return handleMarkdownLink(href);
  };

  return (
    <div className="h-screen overflow-hidden bg-page text-foreground">
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent className="w-[min(20rem,100vw)] p-0 sm:max-w-none lg:hidden" side="left">
          <div className="h-full overflow-y-auto bg-background/98 px-6 py-6">
            <SidebarContent
              generatedAtLabel={formatTimestamp(generatedAt)}
              notesLoaded={allWorkouts.length}
              stravaRunsLoaded={stravaRunCount}
              view={view}
              onNavigate={navigateToView}
            />
          </div>
        </SheetContent>
      </Sheet>

      <MobileDetailSheet open={!isDesktop && rightSidebarOpen} onOpenChange={setRightSidebarOpen}>
        {selectedWorkout ? (
          <WorkoutDetailPanel
            relatedChanges={selectedWorkoutChanges}
            workout={selectedWorkout}
            onFileClick={handleMarkdownLink}
            onLinkClick={handleMarkdownLink}
          />
        ) : (
          <EmptyDetailState />
        )}
      </MobileDetailSheet>

      <div className="flex h-full">
        <aside
          className="hidden shrink-0 overflow-hidden border-r border-foreground/10 bg-page lg:block"
          style={{ width: `${leftSidebarWidth}px` }}
        >
          <div className="h-full overflow-y-auto px-8 py-8">
            <SidebarContent
              generatedAtLabel={formatTimestamp(generatedAt)}
              notesLoaded={allWorkouts.length}
              stravaRunsLoaded={stravaRunCount}
              view={view}
              onNavigate={navigateToView}
            />
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
                <Button
                  aria-label="Open navigation"
                  className="size-9 rounded-[0.35rem] p-0 lg:hidden"
                  type="button"
                  variant="secondary"
                  onClick={() => setMobileNavOpen(true)}
                >
                  <Menu className="size-4" />
                  <span className="sr-only">Open navigation</span>
                </Button>
                <span className="text-sm font-black text-foreground">
                  measured.
                </span>
                <span className="hidden text-sm text-muted-foreground md:inline">
                  {formatViewLabel(view)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Popover open={changelogOpen} onOpenChange={setChangelogOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      aria-label="Open changelog"
                      className="size-9 rounded-[0.35rem] p-0"
                      type="button"
                      variant="secondary"
                    >
                      <History className="size-4" />
                      <span className="sr-only">Open changelog</span>
                    </Button>
                  </PopoverTrigger>

                  <PopoverContent
                    align="end"
                    className="w-[min(44rem,calc(100vw-2rem))] max-w-none p-0"
                    side="bottom"
                  >
                    <ChangelogPopoverPanel
                      focusedFile={changelogFocusedFile}
                      onFileClick={handleChangelogLink}
                      onLinkClick={handleChangelogLink}
                    />
                  </PopoverContent>
                </Popover>

                <Button
                  aria-label={rightSidebarOpen ? "Hide details" : "Show details"}
                  className="hidden size-9 rounded-[0.35rem] p-0 lg:inline-flex"
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
                <MarkdownPage
                  content={welcomeDocument.body}
                  relatedChanges={welcomeChanges}
                  sourcePath={welcomeDocument.sourcePath}
                  onFileClick={handleMarkdownLink}
                  onLinkClick={handleMarkdownLink}
                />
              ) : view === "plan" ? (
                <MarkdownPage
                  content={trainingPlan.body}
                  relatedChanges={planChanges}
                  sourcePath={trainingPlan.sourcePath}
                  onFileClick={handleMarkdownLink}
                  onLinkClick={handleMarkdownLink}
                />
              ) : (
                <CalendarView
                  eventType={eventType}
                  filteredWorkouts={filteredWorkouts}
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
                "hidden overflow-hidden lg:static lg:z-auto lg:flex",
                activeResizePanel === "right"
                  ? "transition-none"
                  : "transition-[width,opacity] duration-300 ease-out",
                rightSidebarOpen
                  ? "opacity-100"
                  : "pointer-events-none opacity-0",
              )}
              style={{
                width: rightSidebarOpen ? `${rightSidebarWidth}px` : "0px",
              }}
            >
              {rightSidebarOpen ? (
                <div className="h-full w-full border-l border-foreground/10 bg-page">
                  <div className="h-full overflow-y-auto px-4 py-6 lg:px-6 lg:py-8">
                    {selectedWorkout ? (
                      <WorkoutDetailPanel
                        relatedChanges={selectedWorkoutChanges}
                        workout={selectedWorkout}
                        onFileClick={handleMarkdownLink}
                        onLinkClick={handleMarkdownLink}
                      />
                    ) : (
                      <EmptyDetailState />
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

function SidebarContent({
  generatedAtLabel,
  notesLoaded,
  stravaRunsLoaded,
  view,
  onNavigate,
}: {
  generatedAtLabel: string;
  notesLoaded: number;
  stravaRunsLoaded: number;
  view: View;
  onNavigate: (view: View) => void;
}) {
  return (
    <>
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
          onClick={() => onNavigate("welcome")}
        />
        <SidebarNavButton
          active={view === "plan"}
          icon={<FileText className="size-4" />}
          label="Plan"
          onClick={() => onNavigate("plan")}
        />
        <SidebarNavButton
          active={view === "calendar"}
          icon={<CalendarDays className="size-4" />}
          label="Calendar"
          onClick={() => onNavigate("calendar")}
        />
      </nav>

      <dl className="mt-8 grid gap-5 border-t border-foreground/10 pt-6 text-sm">
        <MetadataRow label="Notes loaded" value={String(notesLoaded)} />
        <MetadataRow label="Strava runs loaded" value={String(stravaRunsLoaded)} />
        <MetadataRow label="Generated" value={generatedAtLabel} />
      </dl>
    </>
  );
}

function EmptyDetailState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="max-w-xs text-center">
        <p className="text-sm font-black uppercase text-muted-foreground">
          Details
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Open a workout note from the calendar to inspect its metadata and full note content here.
        </p>
      </div>
    </div>
  );
}

function MarkdownPage({
  content,
  relatedChanges,
  sourcePath,
  onFileClick,
  onLinkClick,
}: {
  content: string;
  relatedChanges: ChangelogEntry[];
  sourcePath: string;
  onFileClick: (sourcePath: string) => void;
  onLinkClick?: (href: string) => boolean;
}) {
  return (
    <div className="py-2">
      <div className="markdown-prose">
        <MarkdownContent content={content} onLinkClick={onLinkClick} />
      </div>
      <RelatedChangesSection
        className="mt-10"
        currentSourcePath={sourcePath}
        entries={relatedChanges}
        onFileClick={onFileClick}
        onLinkClick={onLinkClick}
        title="Applies here"
      />
    </div>
  );
}

function ChangelogPopoverPanel({
  focusedFile,
  onFileClick,
  onLinkClick,
}: {
  focusedFile: string | null;
  onFileClick: (sourcePath: string) => void;
  onLinkClick: (href: string) => boolean;
}) {
  const visibleEntries = useMemo(
    () =>
      focusedFile
        ? allChangelogEntries.filter((entry) => entry.affectedFiles.includes(focusedFile))
        : allChangelogEntries,
    [focusedFile],
  );

  return (
    <section className="p-5 md:p-6">
      <div className="border-b border-foreground/10 pb-4">
        <div>
          <p className="eyebrow">Changelog</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {focusedFile === null
              ? "Training plan and note changes across the repo."
              : `Showing changes for ${formatAffectedFileLabel(focusedFile)}.`}
          </p>
        </div>
      </div>

      {visibleEntries.length > 0 ? (
        <ChangelogTimeline
          className="mt-6 max-h-[min(70vh,48rem)] overflow-y-auto pl-3 pr-1"
          entries={visibleEntries}
          onFileClick={onFileClick}
          onLinkClick={onLinkClick}
        />
      ) : (
        <div className="py-10">
          <p className="text-sm text-muted-foreground">
            {focusedFile === null
              ? "No changelog entries match the current file filter."
              : `No changelog entries apply to ${formatAffectedFileLabel(focusedFile)} yet.`}
          </p>
        </div>
      )}
    </section>
  );
}

function RelatedChangesSection({
  className,
  currentSourcePath,
  entries,
  onFileClick,
  onLinkClick,
  title,
}: {
  className?: string;
  currentSourcePath: string;
  entries: ChangelogEntry[];
  onFileClick: (sourcePath: string) => void;
  onLinkClick?: (href: string) => boolean;
  title: string;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <section className={cn("border-t border-foreground/10 pt-6", className)}>
      <p className="eyebrow">{title}</p>
      <ChangelogTimeline
        className="mt-5"
        compact
        currentSourcePath={currentSourcePath}
        entries={entries}
        onFileClick={onFileClick}
        onLinkClick={onLinkClick}
      />
    </section>
  );
}

function ChangelogTimeline({
  className,
  compact = false,
  currentSourcePath,
  entries,
  onFileClick,
  onLinkClick,
}: {
  className?: string;
  compact?: boolean;
  currentSourcePath?: string;
  entries: ChangelogEntry[];
  onFileClick: (sourcePath: string) => void;
  onLinkClick?: (href: string) => boolean;
}) {
  return (
    <div className={cn("space-y-0", className)}>
      {entries.map((entry, index) => (
        <article
          className={cn(
            "relative border-l border-foreground/10 pl-6",
            compact ? (index === entries.length - 1 ? "" : "pb-6") : (index === entries.length - 1 ? "" : "pb-10"),
          )}
          key={entry.slug}
        >
          <span className="absolute top-1 left-0 size-3 -translate-x-1/2 rounded-full border border-background bg-primary" />

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-muted-foreground">
              {formatChangelogDate(entry.date)}
            </p>
            {entry.scope ? (
              <p className="text-xs font-semibold text-muted-foreground">
                {toTitleCase(entry.scope)}
              </p>
            ) : null}
          </div>

          <h3 className={cn("mt-1 font-black", compact ? "text-lg" : "text-2xl")}>
            {entry.title}
          </h3>

          {entry.tags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {entry.tags.map((tag) => (
                <span
                  className="rounded-[0.35rem] border border-foreground/10 px-2 py-1 text-[11px] font-semibold text-muted-foreground"
                  key={tag}
                >
                  {toTitleCase(tag)}
                </span>
              ))}
            </div>
          ) : null}

          <div className={cn("markdown-prose", compact ? "mt-3" : "mt-4")}>
            <MarkdownContent content={entry.body} onLinkClick={onLinkClick} />
          </div>

          {entry.affectedFiles.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {entry.affectedFiles.map((file) => {
                const isCurrentFile = currentSourcePath === file;

                return (
                  <Button
                    className="h-auto rounded-[0.35rem] px-2.5 py-1.5 text-xs"
                    disabled={isCurrentFile}
                    key={file}
                    type="button"
                    variant="secondary"
                    onClick={() => onFileClick(file)}
                  >
                    {isCurrentFile ? "Current file" : formatAffectedFileLabel(file)}
                  </Button>
                );
              })}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function CalendarView({
  eventType,
  filteredWorkouts,
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
  filteredWorkouts: WorkoutNote[];
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
            filteredWorkouts={filteredWorkouts}
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
  filteredWorkouts,
  month,
  selectedWorkoutSlug,
  onSelectWorkout,
}: {
  filteredWorkouts: WorkoutNote[];
  month: MonthGroup;
  selectedWorkoutSlug: string | null;
  onSelectWorkout: (slug: string) => void;
}) {
  const cells = useMemo(() => {
    const workoutsByDate = new Map<string, WorkoutNote[]>();

    filteredWorkouts.forEach((workout) => {
      const workouts = workoutsByDate.get(workout.date);
      if (workouts) {
        workouts.push(workout);
        return;
      }

      workoutsByDate.set(workout.date, [workout]);
    });

    return buildCalendarCells(month, workoutsByDate);
  }, [filteredWorkouts, month]);
  const monthDays = month.days;

  return (
    <div className="mt-8">
      <div className="grid gap-3 lg:hidden">
        {monthDays.map((day) => (
          <section
            className="rounded-[0.35rem] border border-foreground/10 bg-background/70 px-3 py-3"
            key={day.date}
          >
            <div className="flex items-baseline justify-between gap-3 border-b border-foreground/10 pb-2">
              <div>
                <p className="text-base font-black">{formatDayLabel(day.date)}</p>
                <p className="text-[11px] uppercase text-muted-foreground">
                  {formatDayWeekday(day.date)}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                {day.workouts.length === 0 ? "Rest" : `${day.workouts.length} item${day.workouts.length === 1 ? "" : "s"}`}
              </p>
            </div>

            {day.workouts.length > 0 ? (
              <div className="mt-3 flex flex-col gap-2">
                {day.workouts.map((workout) => {
                  const selected = workout.slug === selectedWorkoutSlug;

                  return (
                    <Button
                      className="h-auto w-full items-start justify-start rounded-[0.35rem] px-3 py-2 text-left whitespace-normal"
                      key={workout.slug}
                      type="button"
                      variant={selected ? "default" : "secondary"}
                      onClick={() => onSelectWorkout(workout.slug)}
                    >
                      <span className="flex w-full flex-col gap-1">
                        <span className="text-[10px] font-extrabold uppercase opacity-70">
                          {toTitleCase(workout.eventType)}
                        </span>
                        <span className="text-[13px] leading-[1.1rem]">{workout.title}</span>
                        <WorkoutCardMeta selected={selected} workout={workout} />
                      </span>
                    </Button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">Rest day.</p>
            )}
          </section>
        ))}
      </div>

      <div className="hidden lg:block">
        <div className="grid grid-cols-7 border-t border-l border-foreground/10 text-[10px] font-extrabold uppercase text-muted-foreground">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
            <div className="border-r border-b border-foreground/10 px-2 py-1" key={day}>
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 border-l border-foreground/10">
          {cells.map((cell) => (
            <div
              className={cn(
                "min-h-28 border-r border-b border-foreground/10 px-2 py-2",
                cell.isOutsideMonth ? "bg-background/40" : "bg-transparent",
              )}
              key={cell.key}
            >
              {cell.date ? (
                <div className="flex h-full flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={cn(
                        "text-sm font-black",
                        cell.isOutsideMonth ? "text-muted-foreground/70" : "text-foreground",
                      )}
                    >
                      {Number(cell.date.slice(-2))}
                    </p>
                    {!cell.isOutsideMonth ? (
                      <p className="text-[11px] text-muted-foreground">
                        {cell.workouts.length === 0 ? "Rest" : `${cell.workouts.length} item${cell.workouts.length === 1 ? "" : "s"}`}
                      </p>
                    ) : null}
                  </div>

                  {cell.workouts.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {cell.workouts.map((workout) => {
                        const selected = workout.slug === selectedWorkoutSlug;

                        return (
                          <Button
                            className={cn(
                              "h-auto w-full items-start justify-start rounded-[0.35rem] px-2 py-1.5 text-left whitespace-normal",
                              cell.isOutsideMonth && "opacity-80",
                            )}
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
                              <WorkoutCardMeta selected={selected} workout={workout} />
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkoutCardMeta({
  selected,
  workout,
}: {
  selected: boolean;
  workout: WorkoutNote;
}) {
  const displayDistance =
    (workout.completed ? workout.actualDistanceKm : workout.expectedDistanceKm) !== null
      ? formatDistance(workout.completed ? workout.actualDistanceKm : workout.expectedDistanceKm)
      : null;
  const distanceDelta = getDistanceDelta(workout);

  return (
    <span className="flex items-center justify-between gap-2">
      <span
        className={cn(
          "text-[11px] opacity-70",
          selected ? "text-primary-foreground" : "text-muted-foreground",
        )}
      >
        {workout.completed ? "Completed" : "Planned"}
        {displayDistance ? ` · ${displayDistance}` : ""}
      </span>
      {distanceDelta ? (
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold",
            distanceDelta.direction === "up"
              ? selected
                ? "text-emerald-200"
                : "text-emerald-700"
              : selected
                ? "text-rose-200"
                : "text-rose-700",
          )}
        >
          {distanceDelta.direction === "up" ? (
            <ArrowUp className="size-3" />
          ) : (
            <ArrowDown className="size-3" />
          )}
          <span>{formatDeltaKm(distanceDelta.value)}</span>
        </span>
      ) : null}
    </span>
  );
}

function WorkoutDetailPanel({
  relatedChanges,
  workout,
  onFileClick,
  onLinkClick,
}: {
  relatedChanges: ChangelogEntry[];
  workout: WorkoutNote;
  onFileClick: (sourcePath: string) => void;
  onLinkClick: (href: string) => boolean;
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

      <Accordion className="mt-5 border-b border-foreground/10" collapsible type="single">
        <AccordionItem className="border-b-0" value="metadata">
          <AccordionTrigger className="py-3 text-base font-semibold">
            Metadata
          </AccordionTrigger>
          <AccordionContent>
            <div className="grid gap-4 pt-1 text-sm">
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
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <RelatedChangesSection
        className="mt-5"
        currentSourcePath={workout.sourcePath}
        entries={relatedChanges}
        onFileClick={onFileClick}
        onLinkClick={onLinkClick}
        title="Related changes"
      />

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
        <MarkdownContent content={workout.body} onLinkClick={onLinkClick} />
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

    if (
      !window.location.pathname ||
      window.location.pathname === "/index.html" ||
      window.location.pathname === "/changelog"
    ) {
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
      nextView === "calendar"
        ? "/calendar"
        : nextView === "plan"
          ? "/plan"
          : "/";

    if (window.location.pathname === nextPath) {
      setView(nextView);
      return;
    }

    window.history.pushState(null, "", nextPath);
    setView(nextView);
  };

  return [view, navigate];
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(query);
    const updateMatch = () => {
      setMatches(mediaQuery.matches);
    };

    updateMatch();
    mediaQuery.addEventListener("change", updateMatch);
    return () => {
      mediaQuery.removeEventListener("change", updateMatch);
    };
  }, [query]);

  return matches;
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

function getDistanceDelta(workout: WorkoutNote) {
  if (workout.expectedDistanceKm === null || workout.actualDistanceKm === null) {
    return null;
  }

  const difference = workout.actualDistanceKm - workout.expectedDistanceKm;
  if (Math.abs(difference) < 0.05) {
    return null;
  }

  return {
    direction: difference > 0 ? "up" : "down",
    value: Math.abs(difference),
  } as const;
}

function formatDeltaKm(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)} km`;
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

function formatDayLabel(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${value}T00:00:00`));
}

function formatDayWeekday(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
  }).format(new Date(`${value}T00:00:00`));
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

function formatAffectedFileLabel(sourcePath: string) {
  if (sourcePath === "README.md") {
    return "README.md";
  }

  if (sourcePath === "WELCOME.md") {
    return "WELCOME.md";
  }

  if (sourcePath.startsWith("notes/")) {
    return sourcePath.slice("notes/".length).replace(/\.md$/u, "");
  }

  if (sourcePath.startsWith("changelog/")) {
    return sourcePath.slice("changelog/".length).replace(/\.md$/u, "");
  }

  return sourcePath.replace(/\.md$/u, "");
}

function buildCalendarCells(
  month: MonthGroup,
  workoutsByDate: Map<string, WorkoutNote[]>,
) {
  const [year, monthNumber] = month.key.split("-").map(Number);
  const firstDay = new Date(year, monthNumber - 1, 1);
  const leadingEmptyDays = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthNumber, 0).getDate();
  const cells: Array<{
    date: string;
    isOutsideMonth: boolean;
    key: string;
    workouts: WorkoutNote[];
  }> = [];
  const previousMonth = new Date(year, monthNumber - 2, 1);
  const previousMonthDays = new Date(previousMonth.getFullYear(), previousMonth.getMonth() + 1, 0).getDate();

  for (let index = 0; index < leadingEmptyDays; index += 1) {
    const day = previousMonthDays - leadingEmptyDays + index + 1;
    const date = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    cells.push({
      key: `adjacent-start-${date}`,
      date,
      isOutsideMonth: true,
      workouts: workoutsByDate.get(date) ?? [],
    });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${month.key}-${String(day).padStart(2, "0")}`;
    cells.push({
      key: date,
      date,
      isOutsideMonth: false,
      workouts: workoutsByDate.get(date) ?? [],
    });
  }

  let nextMonthDay = 1;
  const nextMonth = new Date(year, monthNumber, 1);
  while (cells.length % 7 !== 0) {
    const date = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-${String(nextMonthDay).padStart(2, "0")}`;
    cells.push({
      key: `adjacent-end-${date}`,
      date,
      isOutsideMonth: true,
      workouts: workoutsByDate.get(date) ?? [],
    });
    nextMonthDay += 1;
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
