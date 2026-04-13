import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SVGProps,
} from "react";
import {
  Accessibility,
  Calendar1,
  CalendarDays,
  Circle,
  CircleCheck,
  CircleX,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  Dribbble,
  Dumbbell,
  FileText,
  Github,
  GripVertical,
  HeartPulse,
  History,
  ListFilter,
  Menu,
  Moon,
  NotebookText,
  Sun,
  Trophy,
  Wind,
} from "lucide-react";
import { MarkdownContent } from "@/components/MarkdownContent";
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
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  buildCalendarCells,
  buildCalendarWindow,
  chunkCalendarWeeks,
  DESKTOP_CALENDAR_ROW_HEIGHT,
  formatDateKey,
  formatDayLabel,
  formatDayWeekday,
  formatMonthLabel,
  freezeViewportScroll,
  getCalendarWindowShiftScrollOffset,
  getTodayDateKey,
  parseDateKey,
  MOBILE_CALENDAR_CARD_HEIGHT,
  resolveDefaultFocusDate,
  shiftCalendarWindow,
  shouldReleaseCalendarEdgeLock,
  type CalendarCell,
} from "@/lib/calendar";
import {
  allChangelogEntries,
  allGoalNotes,
  allWorkouts,
  availableEventTypes,
  filterWorkouts,
  formatChangelogDate,
  formatDisplayDate,
  generatedAt,
  getChangelogEntriesForFile,
  goalsDocument,
  heartRateDocument,
  getWorkoutBySlug,
  trainingPlan,
  welcomeDocument,
} from "@/lib/workouts/load";
import { decodePolyline, type RouteCoordinate } from "@/lib/workouts/polyline";
import type {
  ChangelogEntry,
  GoalNote,
  WorkoutEventType,
  WorkoutFilters,
  WorkoutNote,
} from "@/lib/workouts/schema";
import { cn } from "@/lib/utils";

type View = "welcome" | "goals" | "heart-rate" | "plan" | "calendar";
type WorkoutStatus = WorkoutFilters["status"];
type ActiveResizePanel = "left" | "right";
type AppRoute = {
  view: View;
  noteSlug: string | null;
};

const LEFT_SIDEBAR_MIN_WIDTH = 240;
const LEFT_SIDEBAR_MAX_WIDTH = 420;
const RIGHT_SIDEBAR_MIN_WIDTH = 320;
const RIGHT_SIDEBAR_MAX_WIDTH = 960;
const RIGHT_SIDEBAR_DEFAULT_WIDTH = 520;
type WorkoutEventTypeIcon = ComponentType<{ className?: string }>;
const LazyWorkoutNotePane = lazy(() => import("@/components/WorkoutNotePane"));

function SportShoeIcon({ className }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m15 10.42 4.8-5.07" />
      <path d="M19 18h3" />
      <path d="M9.5 22 21.414 9.415A2 2 0 0 0 21.2 6.4l-5.61-4.208A1 1 0 0 0 14 3v2a2 2 0 0 1-1.394 1.906L8.677 8.053A1 1 0 0 0 8 9c-.155 6.393-2.082 9-4 9a2 2 0 0 0 0 4h14" />
    </svg>
  );
}

const EVENT_TYPE_META: Record<WorkoutEventType, { icon: WorkoutEventTypeIcon; label: string }> = {
  run: { icon: SportShoeIcon, label: "Run" },
  basketball: { icon: Dribbble, label: "Basketball" },
  strength: { icon: Dumbbell, label: "Strength" },
  mobility: { icon: Accessibility, label: "Mobility" },
  race: { icon: Trophy, label: "Race" },
};
const DEFAULT_EVENT_TYPES: WorkoutEventType[] = ["run", "race"];

export default function App() {
  const [{ view, noteSlug: selectedWorkoutSlug }, navigateRoute] = useAppRoute();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [calendarFocusDateState, setCalendarFocusDate] = useState("");
  const [calendarViewportRequest, setCalendarViewportRequest] = useState(0);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(Boolean(selectedWorkoutSlug));
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(296);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(RIGHT_SIDEBAR_DEFAULT_WIDTH);
  const [eventType, setEventType] = useState<WorkoutFilters["eventType"]>(DEFAULT_EVENT_TYPES);
  const [status, setStatus] = useState<WorkoutStatus>("all");
  const previousSelectedWorkoutDateRef = useRef<string | null>(null);
  const previousViewRef = useRef<View | null>(null);
  const calendarScrollViewportRef = useRef<HTMLDivElement | null>(null);
  const calendarViewportFocusFrameRef = useRef<number | null>(null);
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
  const selectedWorkout = selectedWorkoutSlug ? getWorkoutBySlug(selectedWorkoutSlug) : null;
  const welcomeChanges = useMemo(
    () => getChangelogEntriesForFile(welcomeDocument.sourcePath),
    [],
  );
  const goalsChanges = useMemo(
    () => {
      const goalPaths = new Set([goalsDocument.sourcePath, ...allGoalNotes.map((goal) => goal.sourcePath)]);
      return allChangelogEntries.filter((entry) => entry.affectedFiles.some((file) => goalPaths.has(file)));
    },
    [],
  );
  const planChanges = useMemo(
    () => getChangelogEntriesForFile(trainingPlan.sourcePath),
    [],
  );
  const heartRateChanges = useMemo(
    () => getChangelogEntriesForFile(heartRateDocument.sourcePath),
    [],
  );
  const changelogFocusedFile = useMemo(() => {
    if (selectedWorkout) {
      return selectedWorkout.sourcePath;
    }

    if (view === "welcome") {
      return welcomeDocument.sourcePath;
    }

    if (view === "goals") {
      return goalsDocument.sourcePath;
    }

    if (view === "heart-rate") {
      return heartRateDocument.sourcePath;
    }

    if (view === "plan") {
      return trainingPlan.sourcePath;
    }

    return null;
  }, [selectedWorkout, view]);
  const stravaRunCount = useMemo(
    () => allWorkouts.filter((workout) => workout.stravaId !== null).length,
    [],
  );
  const calendarFocusDate = useMemo(() => {
    if (filteredWorkouts.length === 0) {
      return "";
    }

    if (calendarFocusDateState) {
      return calendarFocusDateState;
    }

    return selectedWorkout?.date ?? resolveDefaultFocusDate(filteredWorkouts);
  }, [calendarFocusDateState, filteredWorkouts, selectedWorkout]);
  const showSelectedWorkoutPane = selectedWorkout !== null && (isDesktop || rightSidebarOpen);

  function requestCalendarViewportFocus(options?: { defer?: boolean; resetScrollTop?: boolean }) {
    const run = () => {
      if (options?.resetScrollTop && calendarScrollViewportRef.current) {
        calendarScrollViewportRef.current.scrollTop = 0;
      }
      setCalendarViewportRequest((current) => current + 1);
    };

    if (!options?.defer) {
      run();
      return;
    }

    if (calendarViewportFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(calendarViewportFocusFrameRef.current);
    }

    calendarViewportFocusFrameRef.current = window.requestAnimationFrame(() => {
      calendarViewportFocusFrameRef.current = window.requestAnimationFrame(() => {
        calendarViewportFocusFrameRef.current = null;
        run();
      });
    });
  }

  useEffect(() => {
    if (selectedWorkoutSlug && !selectedWorkout) {
      navigateRoute({ view: "calendar", noteSlug: null }, { replace: true });
    }
  }, [navigateRoute, selectedWorkout, selectedWorkoutSlug]);

  useEffect(() => {
    if (selectedWorkout?.date) {
      previousSelectedWorkoutDateRef.current = selectedWorkout.date;
    }
  }, [selectedWorkout]);

  useLayoutEffect(() => {
    if (view === "calendar" && previousViewRef.current !== "calendar" && calendarScrollViewportRef.current) {
      calendarScrollViewportRef.current.scrollTop = 0;
    }
  }, [view]);

  useEffect(() => {
    if (view === "calendar" && previousViewRef.current !== "calendar") {
      requestCalendarViewportFocus({ defer: true });
    }

    previousViewRef.current = view;
  }, [view]);

  useEffect(() => {
    return () => {
      if (calendarViewportFocusFrameRef.current !== null) {
        window.cancelAnimationFrame(calendarViewportFocusFrameRef.current);
      }
    };
  }, []);

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
      setRightSidebarOpen(false);
    }

    navigateRoute({ view: nextView, noteSlug: null });
  };

  const focusCalendarDate = (value: string) => {
    setCalendarFocusDate(value);
  };

  const openWorkout = (slug: string, syncCalendarDate = true) => {
    const workout = getWorkoutBySlug(slug);
    if (!workout) {
      return;
    }

    setEventType(DEFAULT_EVENT_TYPES);
    setStatus("all");
    if (syncCalendarDate) {
      focusCalendarDate(workout.date);
    }

    if (selectedWorkoutSlug === slug && (isDesktop || rightSidebarOpen)) {
      if (!isDesktop) {
        setRightSidebarOpen(false);
      }
      setCalendarFocusDate(previousSelectedWorkoutDateRef.current ?? workout.date);
      navigateRoute({ view: "calendar", noteSlug: null });
      return;
    }

    if (!isDesktop) {
      setRightSidebarOpen(true);
    }
    navigateRoute({ view: "calendar", noteSlug: slug });
  };

  const openWorkoutFromCalendar = (slug: string) => {
    openWorkout(slug, false);
  };

  const handleDetailPanelOpenChange = (open: boolean) => {
    if (!open && selectedWorkoutSlug) {
      setRightSidebarOpen(false);
      setCalendarFocusDate(previousSelectedWorkoutDateRef.current ?? calendarFocusDate);
      navigateRoute({ view: "calendar", noteSlug: null });
      return;
    }

    setRightSidebarOpen(open);
  };

  const startResize = (panel: ActiveResizePanel, event: ReactPointerEvent<HTMLDivElement>) => {
    resizeStateRef.current = {
      panel,
      startX: event.clientX,
      startWidth: panel === "left" ? leftSidebarWidth : rightSidebarWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleMarkdownLink = (href: string) => {
    const normalizedHref = href.split("#")[0]?.split("?")[0] ?? href;

    if (normalizedHref === "README.md" || normalizedHref === "PLAN.md") {
      navigateToView("plan");
      return true;
    }

    if (normalizedHref === "GOALS.md") {
      navigateToView("goals");
      return true;
    }

    if (normalizedHref === "HEART_RATE.md") {
      navigateToView("heart-rate");
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
    <div className="h-dvh overflow-hidden overscroll-none bg-page text-foreground">
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          className="w-[min(20rem,100vw)] p-0 sm:max-w-none lg:hidden"
          overlayClassName="backdrop-blur-none"
          side="left"
        >
          <div className="sr-only">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription>Displays the mobile navigation menu.</SheetDescription>
          </div>
          <div className="app-scroll-pane h-full overflow-y-auto bg-background/98 px-6 py-6">
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

      <div className="flex h-full">
        <aside
          className="hidden shrink-0 overflow-hidden border-r border-foreground/10 bg-page lg:block"
          style={{ width: `${leftSidebarWidth}px` }}
        >
          <div className="app-scroll-pane h-full overflow-y-auto px-8 py-8">
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
                    className="w-[min(44rem,calc(100vw-2rem))] max-w-none bg-page p-0"
                    side="bottom"
                  >
                    <ChangelogPopoverPanel
                      focusedFile={changelogFocusedFile}
                      onFileClick={handleChangelogLink}
                      onLinkClick={handleChangelogLink}
                    />
                  </PopoverContent>
                </Popover>

              </div>
            </div>
          </header>

          <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <main className="h-full min-w-0 flex-1 overflow-hidden">
              {view === "calendar" ? (
                <>
                  <div
                    className={cn(
                      "app-scroll-pane calendar-scroll-pane h-full overflow-y-auto px-4 py-6 md:px-6 md:py-8 lg:px-10 lg:py-10",
                      showSelectedWorkoutPane && "hidden",
                    )}
                    ref={calendarScrollViewportRef}
                  >
                    <CalendarView
                      calendarFocusDate={calendarFocusDate}
                      eventType={eventType}
                      focusViewportRequest={calendarViewportRequest}
                      filteredWorkouts={filteredWorkouts}
                      scrollViewportRef={calendarScrollViewportRef}
                      selectedWorkoutSlug={selectedWorkoutSlug}
                      status={status}
                      onFocusDateChange={focusCalendarDate}
                      onEventTypeChange={setEventType}
                      onRequestViewportFocus={requestCalendarViewportFocus}
                      onSelectWorkout={openWorkoutFromCalendar}
                      onStatusChange={setStatus}
                    />
                  </div>
                  {showSelectedWorkoutPane ? (
                    <div className="h-full overflow-hidden px-4 py-6 md:px-6 md:py-8 lg:px-10 lg:py-10">
                      {selectedWorkout ? (
                        <Suspense fallback={<WorkoutNotePaneSkeleton />}>
                          <LazyWorkoutNotePane
                            key={selectedWorkout.slug}
                            workout={selectedWorkout}
                            onBack={() => handleDetailPanelOpenChange(false)}
                            onLinkClick={handleMarkdownLink}
                          />
                        </Suspense>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : view === "welcome" ? (
                <div className="app-scroll-pane h-full overflow-y-auto px-4 py-6 md:px-6 md:py-8 lg:px-10 lg:py-10">
                  <MarkdownPage
                    content={welcomeDocument.body}
                    relatedChanges={welcomeChanges}
                    sourcePath={welcomeDocument.sourcePath}
                    onFileClick={handleMarkdownLink}
                    onLinkClick={handleMarkdownLink}
                  />
                </div>
              ) : view === "goals" ? (
                <div className="app-scroll-pane h-full overflow-y-auto px-4 py-6 md:px-6 md:py-8 lg:px-10 lg:py-10">
                  <GoalsPage
                    goals={allGoalNotes}
                    intro={goalsDocument.body}
                    relatedChanges={goalsChanges}
                    sourcePath={goalsDocument.sourcePath}
                    onFileClick={handleMarkdownLink}
                    onLinkClick={handleMarkdownLink}
                  />
                </div>
              ) : view === "heart-rate" ? (
                <div className="app-scroll-pane h-full overflow-y-auto px-4 py-6 md:px-6 md:py-8 lg:px-10 lg:py-10">
                  <MarkdownPage
                    content={heartRateDocument.body}
                    relatedChanges={heartRateChanges}
                    sourcePath={heartRateDocument.sourcePath}
                    onFileClick={handleMarkdownLink}
                    onLinkClick={handleMarkdownLink}
                  />
                </div>
              ) : view === "plan" ? (
                <div className="app-scroll-pane h-full overflow-y-auto px-4 py-6 md:px-6 md:py-8 lg:px-10 lg:py-10">
                  <MarkdownPage
                    content={trainingPlan.body}
                    relatedChanges={planChanges}
                    showRelatedChanges={false}
                    sourcePath={trainingPlan.sourcePath}
                    onFileClick={handleMarkdownLink}
                    onLinkClick={handleMarkdownLink}
                  />
                </div>
              ) : null}
            </main>
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
          active={view === "goals"}
          icon={<Trophy className="size-4" />}
          label="Goals"
          onClick={() => onNavigate("goals")}
        />
        <SidebarNavButton
          active={view === "plan"}
          icon={<FileText className="size-4" />}
          label="Plan"
          onClick={() => onNavigate("plan")}
        />
        <SidebarNavButton
          active={view === "heart-rate"}
          icon={<HeartPulse className="size-4" />}
          label="Heart Rate"
          onClick={() => onNavigate("heart-rate")}
        />
        <SidebarNavButton
          active={view === "calendar"}
          icon={<CalendarDays className="size-4" />}
          label="Calendar"
          onClick={() => onNavigate("calendar")}
        />
      </nav>

      <div className="mt-4 border-t border-foreground/10 pt-4">
        <SidebarExternalLink
          href="https://github.com/oaqque/measured"
          icon={<Github className="size-4" />}
          label="GitHub"
        />
      </div>

      <dl className="mt-8 grid gap-5 border-t border-foreground/10 pt-6 text-sm">
        <MetadataRow label="Notes loaded" value={String(notesLoaded)} />
        <MetadataRow label="Strava runs loaded" value={String(stravaRunsLoaded)} />
        <MetadataRow label="Generated" value={generatedAtLabel} />
      </dl>
    </>
  );
}

function MarkdownPage({
  content,
  relatedChanges,
  showRelatedChanges = true,
  sourcePath,
  onFileClick,
  onLinkClick,
}: {
  content: string;
  relatedChanges: ChangelogEntry[];
  showRelatedChanges?: boolean;
  sourcePath: string;
  onFileClick: (sourcePath: string) => void;
  onLinkClick?: (href: string) => boolean;
}) {
  return (
    <div className="py-2">
      <div className="markdown-prose">
        <MarkdownContent content={content} onLinkClick={onLinkClick} />
      </div>
      {showRelatedChanges ? (
        <RelatedChangesSection
          className="mt-10"
          currentSourcePath={sourcePath}
          entries={relatedChanges}
          onFileClick={onFileClick}
          onLinkClick={onLinkClick}
          title="Applies here"
        />
      ) : null}
    </div>
  );
}

function GoalsPage({
  goals,
  intro,
  relatedChanges,
  sourcePath,
  onFileClick,
  onLinkClick,
}: {
  goals: GoalNote[];
  intro: string;
  relatedChanges: ChangelogEntry[];
  sourcePath: string;
  onFileClick: (sourcePath: string) => void;
  onLinkClick?: (href: string) => boolean;
}) {
  return (
    <div className="py-2">
      <div className="markdown-prose">
        <MarkdownContent content={intro} onLinkClick={onLinkClick} />
      </div>

      <section className="mt-8">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {goals.map((goal) => (
            <article
              className="flex min-h-64 flex-col rounded-[1.4rem] border border-foreground/10 bg-background/85 p-5 shadow-sm shadow-primary/5"
              key={goal.slug}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-[1rem] bg-surface-panel text-2xl">
                  <span aria-hidden="true">{goal.emoji}</span>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <p className="rounded-full bg-surface-elevated px-3 py-1 text-xs font-semibold text-muted-foreground">
                    {formatDisplayDate(goal.date)}
                  </p>
                  <p className="rounded-full bg-surface-panel px-3 py-1 text-xs font-semibold text-foreground">
                    {formatGoalCountdown(goal.date)}
                  </p>
                </div>
              </div>

              <h2 className="mt-4 text-xl font-black leading-tight text-foreground">
                {goal.title}
              </h2>

              <div className="markdown-prose mt-3 flex-1 text-sm">
                <MarkdownContent content={goal.body} onLinkClick={onLinkClick} />
              </div>

              <p className="mt-4 text-xs font-medium text-muted-foreground">
                {goal.sourcePath}
              </p>
            </article>
          ))}
        </div>
      </section>

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
  calendarFocusDate,
  eventType,
  focusViewportRequest,
  filteredWorkouts,
  scrollViewportRef,
  status,
  selectedWorkoutSlug,
  onFocusDateChange,
  onEventTypeChange,
  onRequestViewportFocus,
  onStatusChange,
  onSelectWorkout,
}: {
  calendarFocusDate: string;
  eventType: WorkoutFilters["eventType"];
  focusViewportRequest: number;
  filteredWorkouts: WorkoutNote[];
  scrollViewportRef: React.RefObject<HTMLDivElement | null>;
  status: WorkoutStatus;
  selectedWorkoutSlug: string | null;
  onFocusDateChange: (value: string) => void;
  onEventTypeChange: (value: WorkoutFilters["eventType"]) => void;
  onRequestViewportFocus: () => void;
  onStatusChange: (value: WorkoutStatus) => void;
  onSelectWorkout: (slug: string) => void;
}) {
  const todayDateKey = getTodayDateKey();
  const isMobileViewport = useMediaQuery("(max-width: 1023px)");

  return (
    <section className={cn("py-2", isMobileViewport ? "pb-28" : "")}>
      <div className="border-t border-foreground/10 pt-5">
        <div className="hidden items-center justify-end lg:flex">
          <CalendarControls
            calendarFocusDate={calendarFocusDate}
            eventType={eventType}
            status={status}
            todayDateKey={todayDateKey}
            onEventTypeChange={onEventTypeChange}
            onFocusDateChange={onFocusDateChange}
            onTodayClick={onRequestViewportFocus}
            onStatusChange={onStatusChange}
          />
        </div>

        {filteredWorkouts.length > 0 && calendarFocusDate ? (
          <CalendarMonthGrid
            calendarFocusDate={calendarFocusDate}
            focusViewportRequest={focusViewportRequest}
            filteredWorkouts={filteredWorkouts}
            scrollViewportRef={scrollViewportRef}
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

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] lg:hidden">
        <div className="pointer-events-auto mx-auto w-full max-w-xl rounded-[0.75rem] border border-foreground/10 bg-background/92 p-2 shadow-lg shadow-black/10 backdrop-blur">
          <CalendarControls
            calendarFocusDate={calendarFocusDate}
            eventType={eventType}
            status={status}
            todayDateKey={todayDateKey}
            onEventTypeChange={onEventTypeChange}
            onFocusDateChange={onFocusDateChange}
            onTodayClick={onRequestViewportFocus}
            onStatusChange={onStatusChange}
          />
        </div>
      </div>
    </section>
  );
}

function CalendarControls({
  calendarFocusDate,
  eventType,
  status,
  todayDateKey,
  onEventTypeChange,
  onFocusDateChange,
  onTodayClick,
  onStatusChange,
}: {
  calendarFocusDate: string;
  eventType: WorkoutFilters["eventType"];
  status: WorkoutStatus;
  todayDateKey: string;
  onEventTypeChange: (value: WorkoutFilters["eventType"]) => void;
  onFocusDateChange: (value: string) => void;
  onTodayClick: () => void;
  onStatusChange: (value: WorkoutStatus) => void;
}) {
  const isDesktopViewport = useMediaQuery("(min-width: 1024px)");

  return (
    <div className="flex items-stretch gap-2 lg:inline-flex lg:flex-wrap lg:items-stretch lg:gap-0">
      <Button
        aria-label="Jump to today"
        className="size-10 shrink-0 rounded-[0.5rem] p-0 lg:rounded-none lg:rounded-l-[0.35rem] lg:border-r lg:border-foreground/10"
        type="button"
        variant="secondary"
        onClick={() => {
          onFocusDateChange(todayDateKey);
          onTodayClick();
        }}
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
            className={cn(
              "size-10 rounded-none border-r border-foreground/10 p-0",
              selected
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-surface-panel-alt text-foreground hover:bg-surface-hero/65",
            )}
            aria-label={`${selected ? "Hide" : "Show"} ${label}`}
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
          aria-label={
            activeFilterCount > 0 ? `Filters active: ${activeFilterCount}` : "Open filters"
          }
          className={cn("size-10 rounded-[0.35rem] p-0", triggerClassName)}
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

function CalendarMonthGrid({
  calendarFocusDate,
  focusViewportRequest,
  filteredWorkouts,
  scrollViewportRef,
  selectedWorkoutSlug,
  onSelectWorkout,
}: {
  calendarFocusDate: string;
  focusViewportRequest: number;
  filteredWorkouts: WorkoutNote[];
  scrollViewportRef: React.RefObject<HTMLDivElement | null>;
  selectedWorkoutSlug: string | null;
  onSelectWorkout: (slug: string) => void;
}) {
  const isMobileViewport = useMediaQuery("(max-width: 1023px)");
  const mobileDaysRef = useRef<HTMLDivElement | null>(null);
  const desktopWeeksViewportRef = useRef<HTMLDivElement | null>(null);
  const shiftFrameRef = useRef<number | null>(null);
  const shiftIndicatorTimeoutRef = useRef<number | null>(null);
  const scrollShiftUnlockTimeoutRef = useRef<number | null>(null);
  const edgeLockRef = useRef<"backward" | "forward" | null>(null);
  const focusReadyRef = useRef(false);
  const windowShiftEnabledRef = useRef(false);
  const previousViewportScrollTopRef = useRef<number | null>(null);
  const pendingFocusScrollRef = useRef(false);
  const restoreViewportScrollRef = useRef<(() => void) | null>(null);
  const queuedWindowShiftRef = useRef<{
    count: number;
    direction: "backward" | "forward";
  } | null>(null);
  const previousFocusDateRef = useRef<string | null>(null);
  const previousFocusViewportRequestRef = useRef(focusViewportRequest);
  const pendingShiftAdjustmentRef = useRef<{
    direction: "backward" | "forward";
    scrollTop: number;
  } | null>(null);
  const [windowShiftDirection, setWindowShiftDirection] = useState<"backward" | "forward" | null>(null);
  const [shiftIndicatorDirection, setShiftIndicatorDirection] = useState<"backward" | "forward" | null>(null);
  const [visibleRange, setVisibleRange] = useState(() =>
    buildCalendarWindow(calendarFocusDate, isMobileViewport),
  );
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

    return buildCalendarCells(visibleRange.startDate, visibleRange.endDate, workoutsByDate);
  }, [filteredWorkouts, visibleRange.endDate, visibleRange.startDate]);
  const weeks = useMemo(() => chunkCalendarWeeks(cells), [cells]);
  const maxWeekStart = Math.max(weeks.length - 3, 0);

  const cancelPendingWindowShift = useCallback(() => {
    if (shiftFrameRef.current !== null) {
      window.cancelAnimationFrame(shiftFrameRef.current);
      shiftFrameRef.current = null;
    }
    if (shiftIndicatorTimeoutRef.current !== null) {
      window.clearTimeout(shiftIndicatorTimeoutRef.current);
      shiftIndicatorTimeoutRef.current = null;
    }
    pendingShiftAdjustmentRef.current = null;
    edgeLockRef.current = null;
    queuedWindowShiftRef.current = null;
    restoreViewportScrollRef.current?.();
    restoreViewportScrollRef.current = null;
    setWindowShiftDirection(null);
    setShiftIndicatorDirection(null);
  }, []);

  const resetViewportForFocus = useCallback(() => {
    const viewport = isMobileViewport ? scrollViewportRef.current : desktopWeeksViewportRef.current;
    if (!viewport) {
      previousViewportScrollTopRef.current = null;
      return;
    }

    viewport.scrollTop = 0;
    previousViewportScrollTopRef.current = 0;
  }, [isMobileViewport, scrollViewportRef]);

  const scheduleCalendarWindowShift = useCallback((direction: "backward" | "forward") => {
    const viewport = isMobileViewport ? scrollViewportRef.current : desktopWeeksViewportRef.current;
    if (!viewport || windowShiftDirection) {
      return;
    }

    if (shiftFrameRef.current !== null) {
      window.cancelAnimationFrame(shiftFrameRef.current);
    }
    if (shiftIndicatorTimeoutRef.current !== null) {
      window.clearTimeout(shiftIndicatorTimeoutRef.current);
      shiftIndicatorTimeoutRef.current = null;
    }

    pendingShiftAdjustmentRef.current = {
      direction,
      scrollTop: viewport.scrollTop,
    };
    if (!isMobileViewport) {
      restoreViewportScrollRef.current?.();
      restoreViewportScrollRef.current = freezeViewportScroll(viewport);
    }
    edgeLockRef.current = direction;
    setWindowShiftDirection(direction);
    setShiftIndicatorDirection(direction);

    shiftFrameRef.current = window.requestAnimationFrame(() => {
      shiftFrameRef.current = null;
      setVisibleRange((current) => shiftCalendarWindow(current, direction));
    });
  }, [isMobileViewport, scrollViewportRef, windowShiftDirection]);

  useEffect(() => {
    setVisibleRange(buildCalendarWindow(calendarFocusDate, isMobileViewport));
  }, [calendarFocusDate, isMobileViewport]);

  useEffect(() => {
    return () => {
      if (shiftFrameRef.current !== null) {
        window.cancelAnimationFrame(shiftFrameRef.current);
      }
      if (shiftIndicatorTimeoutRef.current !== null) {
        window.clearTimeout(shiftIndicatorTimeoutRef.current);
      }
      if (scrollShiftUnlockTimeoutRef.current !== null) {
        window.clearTimeout(scrollShiftUnlockTimeoutRef.current);
      }
      restoreViewportScrollRef.current?.();
      restoreViewportScrollRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const pendingShift = pendingShiftAdjustmentRef.current;
    if (!pendingShift) {
      return;
    }

    const viewport = isMobileViewport ? scrollViewportRef.current : desktopWeeksViewportRef.current;
    if (!viewport) {
      pendingShiftAdjustmentRef.current = null;
      setWindowShiftDirection(null);
      return;
    }

    const adjustment =
      pendingShift.direction === "backward"
        ? getCalendarWindowShiftScrollOffset(isMobileViewport)
        : -getCalendarWindowShiftScrollOffset(isMobileViewport);
    viewport.scrollTop = Math.max(0, pendingShift.scrollTop + adjustment);
    if (shouldReleaseCalendarEdgeLock(viewport, pendingShift.direction, isMobileViewport)) {
      edgeLockRef.current = null;
    }
    pendingShiftAdjustmentRef.current = null;
    requestAnimationFrame(() => {
      restoreViewportScrollRef.current?.();
      restoreViewportScrollRef.current = null;
    });
    setWindowShiftDirection(null);
    if (isMobileViewport) {
      if (shiftIndicatorTimeoutRef.current !== null) {
        window.clearTimeout(shiftIndicatorTimeoutRef.current);
      }
      shiftIndicatorTimeoutRef.current = window.setTimeout(() => {
        shiftIndicatorTimeoutRef.current = null;
        setShiftIndicatorDirection(null);
      }, 180);
      return;
    }

    setShiftIndicatorDirection(null);
  }, [cells, isMobileViewport, scrollViewportRef, weeks]);

  useEffect(() => {
    if (!calendarFocusDate) {
      focusReadyRef.current = false;
      windowShiftEnabledRef.current = false;
      previousViewportScrollTopRef.current = null;
      return;
    }

    const focusDateChanged = previousFocusDateRef.current !== calendarFocusDate;
    const focusRequestChanged = previousFocusViewportRequestRef.current !== focusViewportRequest;
    const shouldScrollToFocus =
      focusDateChanged || focusRequestChanged || pendingFocusScrollRef.current;

    previousFocusDateRef.current = calendarFocusDate;
    previousFocusViewportRequestRef.current = focusViewportRequest;

    if (isMobileViewport) {
      const targetDayCard = mobileDaysRef.current?.querySelector<HTMLElement>(
        `[data-calendar-date="${calendarFocusDate}"]`,
      );
      if (!targetDayCard) {
        if (shouldScrollToFocus) {
          pendingFocusScrollRef.current = true;
          focusReadyRef.current = false;
          windowShiftEnabledRef.current = false;
          cancelPendingWindowShift();
          resetViewportForFocus();
          setVisibleRange(buildCalendarWindow(calendarFocusDate, true));
        }
        return;
      }
      if (shouldScrollToFocus) {
        pendingFocusScrollRef.current = false;
        targetDayCard.scrollIntoView({
          block: "center",
          behavior: "smooth",
        });
      }
      focusReadyRef.current = true;
      windowShiftEnabledRef.current = false;
      if (scrollShiftUnlockTimeoutRef.current !== null) {
        window.clearTimeout(scrollShiftUnlockTimeoutRef.current);
      }
      scrollShiftUnlockTimeoutRef.current = window.setTimeout(() => {
        scrollShiftUnlockTimeoutRef.current = null;
        windowShiftEnabledRef.current = true;
      }, 350);
      return;
    }

    if (!desktopWeeksViewportRef.current) {
      focusReadyRef.current = false;
      return;
    }

    const focusWeekIndex = weeks.findIndex((week) =>
      week.some((cell) => cell.date === calendarFocusDate),
    );
    if (focusWeekIndex === -1) {
      if (shouldScrollToFocus) {
        pendingFocusScrollRef.current = true;
        focusReadyRef.current = false;
        windowShiftEnabledRef.current = false;
        cancelPendingWindowShift();
        resetViewportForFocus();
        setVisibleRange(buildCalendarWindow(calendarFocusDate, false));
      }
      return;
    }

    if (shouldScrollToFocus) {
      pendingFocusScrollRef.current = false;
      const nextWeekStart = clampNumber(focusWeekIndex - 1, 0, maxWeekStart);
      desktopWeeksViewportRef.current.scrollTo({
        top: nextWeekStart * DESKTOP_CALENDAR_ROW_HEIGHT,
        behavior: "smooth",
      });
    }
    focusReadyRef.current = true;
    windowShiftEnabledRef.current = false;
    if (scrollShiftUnlockTimeoutRef.current !== null) {
      window.clearTimeout(scrollShiftUnlockTimeoutRef.current);
    }
    scrollShiftUnlockTimeoutRef.current = window.setTimeout(() => {
      scrollShiftUnlockTimeoutRef.current = null;
      windowShiftEnabledRef.current = true;
    }, 350);
  }, [
    calendarFocusDate,
    cancelPendingWindowShift,
    focusViewportRequest,
    isMobileViewport,
    maxWeekStart,
    resetViewportForFocus,
    weeks,
  ]);

  useEffect(() => {
    const viewport = isMobileViewport ? scrollViewportRef.current : desktopWeeksViewportRef.current;
    if (!viewport) {
      return;
    }

    const handleScroll = () => {
      if (previousViewportScrollTopRef.current === null) {
        previousViewportScrollTopRef.current = viewport.scrollTop;
        return;
      }

      const previousViewportScrollTop = previousViewportScrollTopRef.current;
      previousViewportScrollTopRef.current = viewport.scrollTop;
      if (viewport.scrollTop === previousViewportScrollTop) {
        return;
      }

      if (!focusReadyRef.current) {
        return;
      }
      if (!windowShiftEnabledRef.current) {
        return;
      }

      if (windowShiftDirection) {
        return;
      }

      const threshold = isMobileViewport ? MOBILE_CALENDAR_CARD_HEIGHT : DESKTOP_CALENDAR_ROW_HEIGHT;
      const remainingScroll = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;

      if (edgeLockRef.current === "backward" && shouldReleaseCalendarEdgeLock(viewport, "backward", isMobileViewport)) {
        edgeLockRef.current = null;
      }

      if (edgeLockRef.current === "forward" && shouldReleaseCalendarEdgeLock(viewport, "forward", isMobileViewport)) {
        edgeLockRef.current = null;
      }

      if (viewport.scrollTop <= threshold && edgeLockRef.current === null) {
        scheduleCalendarWindowShift("backward");
        return;
      }

      if (remainingScroll <= threshold && edgeLockRef.current === null) {
        scheduleCalendarWindowShift("forward");
      }
    };

    viewport.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", handleScroll);
    };
  }, [isMobileViewport, scheduleCalendarWindowShift, scrollViewportRef, windowShiftDirection]);

  useEffect(() => {
    if (isMobileViewport) {
      return;
    }

    const viewport = desktopWeeksViewportRef.current;
    if (!viewport) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (!focusReadyRef.current || !windowShiftEnabledRef.current) {
        return;
      }

      const direction = event.deltaY < 0 ? "backward" : event.deltaY > 0 ? "forward" : null;
      if (!direction) {
        return;
      }

      const threshold = DESKTOP_CALENDAR_ROW_HEIGHT;
      const remainingScroll = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      const isAtMatchingEdge =
        direction === "backward" ? viewport.scrollTop <= threshold : remainingScroll <= threshold;
      const isLockedForDirection =
        windowShiftDirection === direction || edgeLockRef.current === direction;

      if (!isAtMatchingEdge || !isLockedForDirection) {
        return;
      }

      if (queuedWindowShiftRef.current?.direction === direction) {
        queuedWindowShiftRef.current.count = Math.min(queuedWindowShiftRef.current.count + 1, 3);
        return;
      }

      queuedWindowShiftRef.current = {
        count: 1,
        direction,
      };
    };

    viewport.addEventListener("wheel", handleWheel, { passive: true });
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
    };
  }, [isMobileViewport, windowShiftDirection]);

  useEffect(() => {
    if (isMobileViewport || windowShiftDirection) {
      return;
    }

    const queuedWindowShift = queuedWindowShiftRef.current;
    if (!queuedWindowShift || queuedWindowShift.count < 1) {
      return;
    }

    if (!focusReadyRef.current || !windowShiftEnabledRef.current) {
      return;
    }

    queuedWindowShift.count -= 1;
    if (queuedWindowShift.count === 0) {
      queuedWindowShiftRef.current = null;
    }

    scheduleCalendarWindowShift(queuedWindowShift.direction);
  }, [isMobileViewport, scheduleCalendarWindowShift, windowShiftDirection]);

  return (
    <div className="relative mt-8">
      {shiftIndicatorDirection ? (
        <div
          className={cn(
            "pointer-events-none z-10 flex items-center justify-center",
            isMobileViewport ? "fixed inset-x-0 top-1/2 -translate-y-1/2" : "absolute inset-0",
          )}
        >
          <div className="w-full max-w-20 opacity-95">
            <BrandMark className="block h-auto w-full" />
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 lg:hidden" ref={mobileDaysRef}>
        {cells.map((day) => (
          <section
            className={cn(
              "flex flex-col rounded-[0.35rem] border px-3 py-3",
              day.isToday
                ? "border-primary/35 bg-surface-panel-alt/55"
                : "border-foreground/10 bg-background/70",
            )}
            data-calendar-date={day.date}
            key={day.date}
            style={{ height: `${MOBILE_CALENDAR_CARD_HEIGHT}px` }}
          >
            <div className="border-b border-foreground/10 pb-2">
              <div>
                <p className="text-base font-black">{formatDayLabel(day.date)}</p>
                <div className="flex items-center gap-2">
                  <p className="text-[11px] uppercase text-muted-foreground">
                    {formatDayWeekday(day.date)}
                  </p>
                  {day.isToday ? (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-primary-foreground">
                      Today
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {day.workouts.length > 0 ? (
              <div className="mt-3 flex min-h-0 flex-1 gap-2 overflow-x-auto pb-1">
                {day.workouts.map((workout) => {
                  const selected = workout.slug === selectedWorkoutSlug;
                  const statusTone = getWorkoutStatusTone(workout);

                  return (
                    <Button
                      className={cn(
                        "relative h-full min-w-[10rem] flex-1 items-start justify-start overflow-hidden rounded-[0.35rem] px-3 py-2 text-left whitespace-normal",
                        getWorkoutCardToneClasses(statusTone, selected),
                      )}
                      key={workout.slug}
                      type="button"
                      variant="secondary"
                      onClick={() => onSelectWorkout(workout.slug)}
                    >
                      <WorkoutCardBackground selected={selected} workout={workout} />
                      <WorkoutCardContent selected={selected} workout={workout} />
                    </Button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 flex flex-1 items-center">
                <p className="text-sm text-muted-foreground">Rest day.</p>
              </div>
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

        <div
          className="app-scroll-pane calendar-scroll-pane relative overflow-y-auto border-l border-foreground/10"
          ref={desktopWeeksViewportRef}
          style={{ height: `${DESKTOP_CALENDAR_ROW_HEIGHT * 3}px` }}
        >
          <CalendarWeeksDesktop
            selectedWorkoutSlug={selectedWorkoutSlug}
            weeks={weeks}
            onSelectWorkout={onSelectWorkout}
          />
        </div>
      </div>
    </div>
  );
}

function CalendarWeeksDesktop({
  className,
  selectedWorkoutSlug,
  style,
  weeks,
  onSelectWorkout,
}: {
  className?: string;
  selectedWorkoutSlug: string | null;
  style?: CSSProperties;
  weeks: CalendarCell[][];
  onSelectWorkout: (slug: string) => void;
}) {
  return (
    <div className={cn("grid", className)} style={style}>
      {weeks.map((week, weekIndex) => (
        <div
          className="grid grid-cols-7"
          key={week[0]?.key ?? `week-${weekIndex}`}
          style={{ height: `${DESKTOP_CALENDAR_ROW_HEIGHT}px` }}
        >
          {week.map((cell) => (
            <div
              className={cn(
                "h-full overflow-hidden border-r border-b border-foreground/10 px-2 py-2 transition-colors",
                cell.isOutsideRange ? "bg-background/40" : "bg-transparent",
                cell.isToday && "bg-surface-panel-alt/45",
              )}
              key={cell.key}
            >
              <div className="flex h-full min-h-0 flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={cn(
                      "text-sm font-black",
                      cell.isOutsideRange ? "text-muted-foreground/70" : "text-foreground",
                    )}
                  >
                    {Number(cell.date.slice(-2))}
                  </p>
                  {cell.isToday ? (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-primary-foreground">
                      Today
                    </span>
                  ) : null}
                </div>

                {cell.workouts.length > 0 ? (
                  <div
                    className="grid min-h-0 flex-1 gap-1"
                    style={{ gridTemplateRows: `repeat(${cell.workouts.length}, minmax(0, 1fr))` }}
                  >
                    {cell.workouts.map((workout) => {
                      const selected = workout.slug === selectedWorkoutSlug;
                      const compactCards = cell.workouts.length >= 3;
                      const statusTone = getWorkoutStatusTone(workout);

                      return (
                        <Button
                          className={cn(
                            "relative h-full min-h-0 w-full items-start justify-start overflow-hidden rounded-[0.35rem] px-2 py-1.5 text-left whitespace-normal",
                            cell.isOutsideRange && "opacity-80",
                            compactCards && "px-2 py-1",
                            getWorkoutCardToneClasses(statusTone, selected),
                          )}
                          key={workout.slug}
                          type="button"
                          variant="secondary"
                          onClick={() => onSelectWorkout(workout.slug)}
                        >
                          <WorkoutCardBackground selected={selected} workout={workout} />
                          <WorkoutCardContent compact={compactCards} selected={selected} workout={workout} />
                        </Button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function WorkoutCardContent({
  compact = false,
  selected,
  workout,
}: {
  compact?: boolean;
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
  const hasBackgroundImage = workout.primaryImageUrl !== null;
  const weatherIconMeta = getWorkoutWeatherIconMeta(workout);
  const WeatherIcon = weatherIconMeta?.icon ?? null;
  const weatherIconClassName = weatherIconMeta?.className ?? null;

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
          hasBackgroundImage={hasBackgroundImage}
          path={routeOutlinePath}
          selected={selected}
        />
      ) : null}
      <span className="absolute left-0 top-0 flex items-start justify-start">
        <EventTypeIcon
          aria-hidden="true"
          className={cn(
            iconSizeClass,
            selected || hasBackgroundImage ? "text-primary-foreground" : "text-foreground",
          )}
        />
      </span>
      <span className="absolute right-0 top-0 flex items-start justify-end">
        <StatusIcon
          aria-hidden="true"
          className={cn(
            compact ? "size-3.5" : "size-4",
            selected
              ? "text-primary-foreground"
              : hasBackgroundImage
                ? "text-white"
                : statusMeta.className,
          )}
        />
      </span>
      {WeatherIcon ? (
        <span className="absolute bottom-0 right-0 flex items-end justify-end">
          <WeatherIcon
            aria-hidden="true"
            className={cn(
              compact ? "size-3.5" : "size-4",
              selected
                ? "text-primary-foreground/90"
                : hasBackgroundImage
                  ? "text-white/90"
                  : weatherIconClassName,
            )}
          />
        </span>
      ) : null}
      {displayDistance ? (
        <span
          className={cn(
            "flex h-full w-full items-center justify-center font-extrabold tabular-nums",
            getWorkoutCardDistanceSizeClass(displayDistanceKm, compact),
            selected || hasBackgroundImage ? "text-primary-foreground" : "text-foreground",
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
  if (!workout.primaryImageUrl) {
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
        style={{ backgroundImage: `url("${workout.primaryImageUrl}")` }}
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

function WorkoutNotePaneSkeleton() {
  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      <div className="mb-4 border-b border-foreground/10 pb-4">
        <Skeleton className="size-9 rounded-[0.35rem]" />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="w-full max-w-24 opacity-95">
            <BrandMark className="block h-auto w-full" />
          </div>
        </div>

        <div className="flex h-full min-h-0 flex-col gap-5 lg:hidden">
          <section className="space-y-3 border-b border-foreground/10 pb-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-3/5" />
            <Skeleton className="h-4 w-32" />
          </section>
          <Skeleton className="h-10 w-full rounded-[0.75rem]" />
          <Skeleton className="h-48 w-full rounded-[1rem]" />
          <div className="space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[92%]" />
            <Skeleton className="h-4 w-[88%]" />
            <Skeleton className="h-4 w-[84%]" />
            <Skeleton className="h-4 w-[90%]" />
            <Skeleton className="h-4 w-[72%]" />
          </div>
        </div>

        <div className="hidden h-full min-h-0 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
          <div className="space-y-4">
            <section className="space-y-3 border-b border-foreground/10 pb-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-9 w-3/5" />
              <Skeleton className="h-4 w-32" />
            </section>

            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-[94%]" />
              <Skeleton className="h-4 w-[91%]" />
              <Skeleton className="h-4 w-[88%]" />
              <Skeleton className="h-4 w-[93%]" />
              <Skeleton className="h-4 w-[86%]" />
              <Skeleton className="h-4 w-[82%]" />
              <Skeleton className="h-4 w-[74%]" />
            </div>
          </div>

          <aside className="space-y-5 pt-6">
            <Skeleton className="h-56 w-full rounded-[1rem]" />
            <div className="space-y-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          </aside>
        </div>
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

function SidebarExternalLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: ReactNode;
  label: string;
}) {
  return (
    <a
      className="inline-flex h-10 w-full items-center justify-start gap-2 rounded-[0.35rem] bg-transparent px-3 py-2 text-sm font-semibold text-foreground transition-colors duration-300 hover:bg-surface-panel-alt/55 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      {icon}
      <span>{label}</span>
    </a>
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
  return <img alt="" aria-hidden="true" className={className} src="/brand-mark.svg" />;
}

function useAppRoute(): [AppRoute, (route: AppRoute, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<AppRoute>(() =>
    typeof window === "undefined" ? { view: "welcome", noteSlug: null } : getRouteFromPath(window.location.pathname),
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
      setRoute(getRouteFromPath(window.location.pathname));
    };

    handlePopState();
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const navigate = (nextRoute: AppRoute, options?: { replace?: boolean }) => {
    const nextPath = getPathFromRoute(nextRoute);

    if (window.location.pathname === nextPath) {
      setRoute(nextRoute);
      return;
    }

    if (options?.replace) {
      window.history.replaceState(null, "", nextPath);
    } else {
      window.history.pushState(null, "", nextPath);
    }
    setRoute(nextRoute);
  };

  return [route, navigate];
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

function getRouteFromPath(pathname: string): AppRoute {
  const normalizedPath = normalizePathname(pathname);

  if (normalizedPath.startsWith("/notes/")) {
    const noteSlug = decodeURIComponent(normalizedPath.slice("/notes/".length)).trim();
    return {
      view: "calendar",
      noteSlug: noteSlug.length > 0 ? noteSlug : null,
    };
  }

  if (normalizedPath === "/calendar") {
    return { view: "calendar", noteSlug: null };
  }

  if (normalizedPath === "/goals") {
    return { view: "goals", noteSlug: null };
  }

  if (normalizedPath === "/heart-rate") {
    return { view: "heart-rate", noteSlug: null };
  }

  if (normalizedPath === "/plan") {
    return { view: "plan", noteSlug: null };
  }

  return { view: "welcome", noteSlug: null };
}

function getPathFromRoute(route: AppRoute) {
  if (route.noteSlug) {
    return `/notes/${encodeURIComponent(route.noteSlug)}`;
  }

  if (route.view === "calendar") {
    return "/calendar";
  }

  if (route.view === "goals") {
    return "/goals";
  }

  if (route.view === "heart-rate") {
    return "/heart-rate";
  }

  if (route.view === "plan") {
    return "/plan";
  }

  return "/";
}

function normalizePathname(pathname: string) {
  if (!pathname || pathname === "/index.html") {
    return "/";
  }

  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }

  return pathname;
}

function formatViewLabel(view: View) {
  if (view === "goals") {
    return "Goals";
  }

  if (view === "plan") {
    return "Plan";
  }

  if (view === "heart-rate") {
    return "Heart Rate";
  }

  if (view === "calendar") {
    return "Calendar";
  }

  return "Welcome";
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getWorkoutEventTypeMeta(eventType: WorkoutEventType) {
  return EVENT_TYPE_META[eventType];
}

function hasDefaultEventTypes(eventTypes: WorkoutFilters["eventType"]) {
  return (
    eventTypes.length === DEFAULT_EVENT_TYPES.length &&
    DEFAULT_EVENT_TYPES.every((item) => eventTypes.includes(item))
  );
}

function toggleWorkoutEventType(
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

function getWorkoutStatusTone(workout: WorkoutNote) {
  if (workout.completed) {
    return "completed";
  }

  if (workout.date < getTodayDateKey()) {
    return "overdue";
  }

  return "default";
}

function getWorkoutCardToneClasses(
  _tone: "completed" | "default" | "overdue",
  selected: boolean,
) {
  if (selected) {
    return "bg-primary text-primary-foreground hover:bg-primary/90";
  }

  return "bg-surface-panel-alt text-foreground hover:bg-surface-hero/65";
}

function getWorkoutStatusIconMeta(tone: "completed" | "default" | "overdue") {
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

function WorkoutCardRouteOutline({
  compact,
  hasBackgroundImage,
  path,
  selected,
}: {
  compact: boolean;
  hasBackgroundImage: boolean;
  path: string;
  selected: boolean;
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
          stroke={hasBackgroundImage ? "#ffffff" : "currentColor"}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity={hasBackgroundImage ? (selected ? 0.72 : 0.62) : selected ? 0.24 : 0.16}
          strokeWidth={compact ? 1.8 : 1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
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

function formatGoalCountdown(value: string) {
  const today = parseDateKey(getTodayDateKey());
  const goalDate = parseDateKey(value);
  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const diffDays = Math.round((goalDate.getTime() - today.getTime()) / millisecondsPerDay);

  if (diffDays === 0) {
    return "Today";
  }

  if (diffDays === 1) {
    return "1 day left";
  }

  if (diffDays > 1) {
    return `${diffDays} days left`;
  }

  if (diffDays === -1) {
    return "1 day ago";
  }

  return `${Math.abs(diffDays)} days ago`;
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

  if (sourcePath === "PLAN.md") {
    return "PLAN.md";
  }

  if (sourcePath === "WELCOME.md") {
    return "WELCOME.md";
  }

  if (sourcePath === "GOALS.md") {
    return "GOALS.md";
  }

  if (sourcePath === "HEART_RATE.md") {
    return "HEART_RATE.md";
  }

  if (sourcePath.startsWith("goals/")) {
    return sourcePath.slice("goals/".length).replace(/\.md$/u, "");
  }

  if (sourcePath.startsWith("notes/")) {
    return sourcePath.slice("notes/".length).replace(/\.md$/u, "");
  }

  if (sourcePath.startsWith("changelog/")) {
    return sourcePath.slice("changelog/".length).replace(/\.md$/u, "");
  }

  return sourcePath.replace(/\.md$/u, "");
}

function workoutHrefToSlug(href: string) {
  const normalizedHref = href.split("#")[0]?.split("?")[0] ?? "";
  if (normalizedHref.startsWith("/notes/")) {
    const slug = decodeURIComponent(normalizedHref.slice("/notes/".length)).trim();
    return slug.length > 0 ? slug : null;
  }

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
