import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  Github,
  GripVertical,
  History,
  Menu,
  NotebookText,
  Orbit,
  Trophy,
} from "lucide-react";
import { MarkdownContent } from "@/components/MarkdownContent";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarView } from "@/features/calendar/CalendarView";
import { DEFAULT_EVENT_TYPES } from "@/features/calendar/calendarMeta";
import { useMediaQuery } from "@/features/calendar/useMediaQuery";
import { GraphView } from "@/features/graph/GraphView";
import { createGraphDocumentNodeId } from "@/lib/graph/ids";
import { formatGraphSourcePathLabel } from "@/lib/graph/labels";
import { noteGraph } from "@/lib/graph/load";
import { getTodayDateKey, parseDateKey, resolveDefaultFocusDate } from "@/lib/calendar";
import {
  allChangelogEntries,
  allGoalNotes,
  allWorkouts,
  filterWorkouts,
  formatChangelogDate,
  formatDisplayDate,
  generatedAt,
  getChangelogEntriesForFile,
  goalsDocument,
  heartRateDocument,
  morningMobilityDocument,
  getWorkoutBySlug,
  trainingPlan,
  welcomeDocument,
} from "@/lib/workouts/load";
import type { ChangelogEntry, GoalNote, WorkoutFilters } from "@/lib/workouts/schema";
import { cn } from "@/lib/utils";

type View = "welcome" | "goals" | "heart-rate" | "morning-mobility" | "plan" | "calendar" | "graph";
type WorkoutStatus = WorkoutFilters["status"];
type AppRoute = {
  view: View;
  noteSlug: string | null;
};

const LEFT_SIDEBAR_MIN_WIDTH = 240;
const LEFT_SIDEBAR_MAX_WIDTH = 420;
const LazyWorkoutNotePane = lazy(() => import("@/components/WorkoutNotePane"));

export default function App() {
  const [{ view, noteSlug: selectedWorkoutSlug }, navigateRoute] = useAppRoute();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [calendarFocusDateState, setCalendarFocusDate] = useState("");
  const [graphFocusedNodeId, setGraphFocusedNodeId] = useState<string | null>(null);
  const [graphOpenedNodeId, setGraphOpenedNodeId] = useState<string | null>(null);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(Boolean(selectedWorkoutSlug));
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(296);
  const [eventType, setEventType] = useState<WorkoutFilters["eventType"]>(DEFAULT_EVENT_TYPES);
  const [status, setStatus] = useState<WorkoutStatus>("all");
  const previousSelectedWorkoutDateRef = useRef<string | null>(null);
  const resizeStateRef = useRef<{
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
  const graphDocumentsById = useMemo(() => {
    const documents = new Map<
      string,
      {
        body: string;
        date: string | null;
        eyebrow: string;
        sourcePath: string;
        title: string;
      }
    >();

    const addDocument = (
      sourcePath: string,
      title: string,
      body: string,
      eyebrow: string,
      date: string | null = null,
    ) => {
      documents.set(createGraphDocumentNodeId(sourcePath), {
        body,
        date,
        eyebrow,
        sourcePath,
        title,
      });
    };

    addDocument(welcomeDocument.sourcePath, welcomeDocument.title, welcomeDocument.body, "Welcome");
    addDocument(goalsDocument.sourcePath, goalsDocument.title, goalsDocument.body, "Goals");
    addDocument(heartRateDocument.sourcePath, heartRateDocument.title, heartRateDocument.body, "Metaanalysis");
    addDocument(morningMobilityDocument.sourcePath, morningMobilityDocument.title, morningMobilityDocument.body, "Metaanalysis");
    addDocument(trainingPlan.sourcePath, trainingPlan.title, trainingPlan.body, "Plan");

    for (const goal of allGoalNotes) {
      addDocument(goal.sourcePath, goal.title, goal.body, "Goal", goal.date);
    }

    for (const entry of allChangelogEntries) {
      addDocument(entry.sourcePath, entry.title, entry.body, "Changelog", entry.date);
    }

    return documents;
  }, []);
  const graphDocumentIdByPath = useMemo(() => {
    const ids = new Map<string, string>();
    for (const id of graphDocumentsById.keys()) {
      const sourcePath = id.slice("doc:".length);
      ids.set(sourcePath, id);
    }

    ids.set("HEART_RATE.md", createGraphDocumentNodeId(heartRateDocument.sourcePath));
    ids.set("MORNING_MOBILITY.md", createGraphDocumentNodeId(morningMobilityDocument.sourcePath));
    return ids;
  }, [graphDocumentsById]);
  const selectedGraphWorkout = graphOpenedNodeId ? getWorkoutBySlug(graphOpenedNodeId) : null;
  const selectedGraphDocument = graphOpenedNodeId ? graphDocumentsById.get(graphOpenedNodeId) ?? null : null;
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
  const morningMobilityChanges = useMemo(
    () => getChangelogEntriesForFile(morningMobilityDocument.sourcePath),
    [],
  );
  const changelogFocusedFile = useMemo(() => {
    if (selectedWorkout) {
      return selectedWorkout.sourcePath;
    }

    if (selectedGraphWorkout) {
      return selectedGraphWorkout.sourcePath;
    }

    if (selectedGraphDocument) {
      return selectedGraphDocument.sourcePath;
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

    if (view === "morning-mobility") {
      return morningMobilityDocument.sourcePath;
    }

    if (view === "plan") {
      return trainingPlan.sourcePath;
    }

    return null;
  }, [selectedGraphDocument, selectedGraphWorkout, selectedWorkout, view]);
  const completedWorkoutCount = useMemo(
    () => allWorkouts.filter((workout) => workout.completed !== null).length,
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
  const showSelectedWorkoutPane =
    selectedWorkout !== null && (selectedWorkoutSlug !== null || rightSidebarOpen);

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

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;

      if (!resizeState) {
        return;
      }

      const nextWidth = clampNumber(
        resizeState.startWidth + (event.clientX - resizeState.startX),
        LEFT_SIDEBAR_MIN_WIDTH,
        LEFT_SIDEBAR_MAX_WIDTH,
      );
      setLeftSidebarWidth(nextWidth);
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

  const focusNodeFromGraph = (nodeId: string | null) => {
    setGraphFocusedNodeId(nodeId);
    if (!nodeId) {
      setGraphOpenedNodeId(null);
    }
  };

  const openFocusedNodeFromGraph = () => {
    if (!graphFocusedNodeId) {
      return;
    }

    if (!graphDocumentsById.has(graphFocusedNodeId) && !getWorkoutBySlug(graphFocusedNodeId)) {
      return;
    }

    setGraphOpenedNodeId(graphFocusedNodeId);
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

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: leftSidebarWidth,
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const handleMarkdownLink = (href: string) => {
    const normalizedHref = normalizeInternalHref(href);

    if (normalizedHref === "README.md" || normalizedHref === "PLAN.md") {
      navigateToView("plan");
      return true;
    }

    if (normalizedHref === "GOALS.md") {
      navigateToView("goals");
      return true;
    }

    if (normalizedHref === "HEART_RATE.md" || normalizedHref === "metaanalysis/HEART_RATE.md") {
      navigateToView("heart-rate");
      return true;
    }

    if (
      normalizedHref === "MORNING_MOBILITY.md" ||
      normalizedHref === "metaanalysis/MORNING_MOBILITY.md"
    ) {
      navigateToView("morning-mobility");
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

    if (normalizedHref === "graph" || normalizedHref === "/graph") {
      navigateToView("graph");
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

  const handleGraphMarkdownLink = (href: string) => {
    const normalizedHref = normalizeInternalHref(href);
    const documentId = graphDocumentIdByPath.get(normalizedHref);
    if (documentId) {
      setGraphFocusedNodeId(documentId);
      setGraphOpenedNodeId(documentId);
      return true;
    }

    const slug = workoutHrefToSlug(normalizedHref);
    if (slug) {
      setGraphFocusedNodeId(slug);
      setGraphOpenedNodeId(slug);
      return true;
    }

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
              completedWorkoutsLoaded={completedWorkoutCount}
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
              completedWorkoutsLoaded={completedWorkoutCount}
              view={view}
              onNavigate={navigateToView}
            />
          </div>
        </aside>

        <ResizeHandle
          className="hidden lg:flex"
          onPointerDown={startResize}
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
                      showSelectedWorkoutPane
                        ? "hidden"
                        : "app-scroll-pane flex h-full flex-col overflow-y-hidden px-4 py-3 md:px-6 md:py-8 lg:block lg:overflow-y-auto lg:px-10 lg:py-10",
                    )}
                  >
                    <CalendarView
                      calendarFocusDate={calendarFocusDate}
                      eventType={eventType}
                      filteredWorkouts={filteredWorkouts}
                      selectedWorkoutSlug={selectedWorkoutSlug}
                      status={status}
                      onFocusDateChange={focusCalendarDate}
                      onEventTypeChange={setEventType}
                      onSelectWorkout={openWorkoutFromCalendar}
                      onStatusChange={setStatus}
                    />
                  </div>
                  {showSelectedWorkoutPane ? (
                    <div className="app-scroll-pane h-full overflow-y-auto px-4 py-6 md:px-6 md:py-8 lg:px-10 lg:py-10">
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
              ) : view === "graph" ? (
                <div className="h-full min-h-0 overflow-hidden">
                  <GraphView
                    initialGraphData={noteGraph}
                    noteOverlay={
                      selectedGraphWorkout ? (
                        <Suspense fallback={<WorkoutNotePaneSkeleton />}>
                          <LazyWorkoutNotePane
                            key={selectedGraphWorkout.slug}
                            backLabel="Close note"
                            workout={selectedGraphWorkout}
                            onBack={() => setGraphOpenedNodeId(null)}
                            onLinkClick={handleGraphMarkdownLink}
                          />
                        </Suspense>
                      ) : selectedGraphDocument ? (
                        <GraphDocumentOverlay
                          body={selectedGraphDocument.body}
                          date={selectedGraphDocument.date}
                          eyebrow={selectedGraphDocument.eyebrow}
                          sourcePath={selectedGraphDocument.sourcePath}
                          title={selectedGraphDocument.title}
                          onBack={() => setGraphOpenedNodeId(null)}
                          onLinkClick={handleGraphMarkdownLink}
                        />
                      ) : null
                    }
                    selectedNodeId={graphFocusedNodeId}
                    onCloseSelection={() => setGraphOpenedNodeId(null)}
                    onOpenSelectedNode={openFocusedNodeFromGraph}
                    onSelectNode={focusNodeFromGraph}
                  />
                </div>
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
              ) : view === "morning-mobility" ? (
                <div className="app-scroll-pane h-full overflow-y-auto px-4 py-6 md:px-6 md:py-8 lg:px-10 lg:py-10">
                  <MarkdownPage
                    content={morningMobilityDocument.body}
                    relatedChanges={morningMobilityChanges}
                    sourcePath={morningMobilityDocument.sourcePath}
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
  completedWorkoutsLoaded,
  view,
  onNavigate,
}: {
  generatedAtLabel: string;
  notesLoaded: number;
  completedWorkoutsLoaded: number;
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
          active={view === "calendar"}
          icon={<CalendarDays className="size-4" />}
          label="Calendar"
          onClick={() => onNavigate("calendar")}
        />
        <SidebarNavButton
          active={view === "graph"}
          icon={<Orbit className="size-4" />}
          label="Graph"
          onClick={() => onNavigate("graph")}
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
        <MetadataRow label="Completed workouts" value={String(completedWorkoutsLoaded)} />
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

function GraphDocumentOverlay({
  body,
  date,
  eyebrow,
  sourcePath,
  title,
  onBack,
  onLinkClick,
}: {
  body: string;
  date: string | null;
  eyebrow: string;
  sourcePath: string;
  title: string;
  onBack: () => void;
  onLinkClick?: (href: string) => boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-4 border-b border-foreground/10 pb-4">
        <Button
          aria-label="Close note"
          className="size-9 rounded-[0.35rem] p-0"
          type="button"
          variant="secondary"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
          <span className="sr-only">Close note</span>
        </Button>
      </div>

      <div className="app-scroll-pane min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[80rem]">
          <section className="border-b border-foreground/10 pb-4">
            <p className="eyebrow">{eyebrow}</p>
            <h2 className="mt-2 text-2xl font-black">{title}</h2>
            {date ? <p className="mt-1 text-sm text-muted-foreground">{formatDisplayDate(date)}</p> : null}
            <p className="mt-3 text-xs font-medium text-muted-foreground">{formatGraphSourcePathLabel(sourcePath)}</p>
          </section>

          <div className="markdown-prose mt-6">
            <MarkdownContent content={body} onLinkClick={onLinkClick} />
          </div>
        </div>
      </div>
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

  if (normalizedPath === "/graph") {
    return { view: "graph", noteSlug: null };
  }

  if (normalizedPath === "/goals") {
    return { view: "goals", noteSlug: null };
  }

  if (normalizedPath === "/heart-rate") {
    return { view: "heart-rate", noteSlug: null };
  }

  if (normalizedPath === "/morning-mobility") {
    return { view: "morning-mobility", noteSlug: null };
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

  if (route.view === "graph") {
    return "/graph";
  }

  if (route.view === "goals") {
    return "/goals";
  }

  if (route.view === "heart-rate") {
    return "/heart-rate";
  }

  if (route.view === "morning-mobility") {
    return "/morning-mobility";
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

  if (view === "morning-mobility") {
    return "Morning Mobility";
  }

  if (view === "calendar") {
    return "Calendar";
  }

  if (view === "graph") {
    return "Graph";
  }

  return "Welcome";
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeInternalHref(href: string) {
  let normalizedHref = href.split("#")[0]?.split("?")[0] ?? href;

  while (normalizedHref.startsWith("./")) {
    normalizedHref = normalizedHref.slice(2);
  }

  while (normalizedHref.startsWith("../")) {
    normalizedHref = normalizedHref.slice(3);
  }

  return normalizedHref;
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

  return formatGraphSourcePathLabel(sourcePath);
}

function workoutHrefToSlug(href: string) {
  const normalizedHref = normalizeInternalHref(href);
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
