import {
  useEffect,
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
  Dribbble,
  Dumbbell,
  FileText,
  Github,
  GripVertical,
  History,
  ListFilter,
  Menu,
  NotebookText,
  PanelRightClose,
  PanelRightOpen,
  Trophy,
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
  trainingPlan,
  welcomeDocument,
} from "@/lib/workouts/load";
import type { ChangelogEntry, WorkoutEventType, WorkoutFilters, WorkoutNote } from "@/lib/workouts/schema";
import { cn } from "@/lib/utils";

type View = "welcome" | "plan" | "calendar";
type WorkoutStatus = WorkoutFilters["status"];
type ActiveResizePanel = "left" | "right";
type AppRoute = {
  view: View;
  noteSlug: string | null;
};
type CalendarCell = {
  date: string;
  isToday: boolean;
  isOutsideRange: boolean;
  key: string;
  workouts: WorkoutNote[];
};

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
const DESKTOP_CALENDAR_ROW_HEIGHT = 176;
const MOBILE_CALENDAR_CARD_HEIGHT = 176;
type WorkoutEventTypeIcon = ComponentType<{ className?: string }>;

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

export default function App() {
  const [{ view, noteSlug: selectedWorkoutSlug }, navigateRoute] = useAppRoute();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [calendarFocusDate, setCalendarFocusDate] = useState("");
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(296);
  const [rightSidebarWidth, setRightSidebarWidth] = useState(RIGHT_SIDEBAR_DEFAULT_WIDTH);
  const [eventType, setEventType] = useState<WorkoutFilters["eventType"]>("all");
  const [status, setStatus] = useState<WorkoutStatus>("all");
  const [activeResizePanel, setActiveResizePanel] = useState<ActiveResizePanel | null>(null);
  const previousSelectedWorkoutSlugRef = useRef<string | null>(selectedWorkoutSlug);
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
  const planChanges = useMemo(
    () => getChangelogEntriesForFile(trainingPlan.sourcePath),
    [],
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

  useEffect(() => {
    if (selectedWorkoutSlug && !selectedWorkout) {
      navigateRoute({ view: "calendar", noteSlug: null }, { replace: true });
    }
  }, [navigateRoute, selectedWorkout, selectedWorkoutSlug]);

  useEffect(() => {
    if (filteredWorkouts.length === 0) {
      setCalendarFocusDate("");
      return;
    }

    if (!calendarFocusDate) {
      setCalendarFocusDate(resolveDefaultFocusDate(filteredWorkouts));
    }
  }, [calendarFocusDate, filteredWorkouts]);

  useEffect(() => {
    if (!selectedWorkout) {
      return;
    }

    setEventType("all");
    setStatus("all");
    setCalendarFocusDate((current) => (current === selectedWorkout.date ? current : selectedWorkout.date));
    setRightSidebarOpen(true);
  }, [selectedWorkout]);

  useEffect(() => {
    if (previousSelectedWorkoutSlugRef.current && !selectedWorkoutSlug) {
      setRightSidebarOpen(false);
    }

    previousSelectedWorkoutSlugRef.current = selectedWorkoutSlug;
  }, [selectedWorkoutSlug]);

  useEffect(() => {
    if (view !== "calendar") {
      setRightSidebarOpen(false);
    }
  }, [view]);

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

    setEventType("all");
    setStatus("all");
    if (syncCalendarDate) {
      focusCalendarDate(workout.date);
    }

    if (selectedWorkoutSlug === slug && rightSidebarOpen) {
      setRightSidebarOpen(false);
      navigateRoute({ view: "calendar", noteSlug: null });
      return;
    }

    setRightSidebarOpen(true);
    navigateRoute({ view: "calendar", noteSlug: slug });
  };

  const openWorkoutFromCalendar = (slug: string) => {
    openWorkout(slug, false);
  };

  const handleDetailPanelOpenChange = (open: boolean) => {
    setRightSidebarOpen(open);

    if (!open && selectedWorkoutSlug) {
      navigateRoute({ view: "calendar", noteSlug: null });
    }
  };

  const toggleDesktopDetailPanel = () => {
    if (rightSidebarOpen) {
      handleDetailPanelOpenChange(false);
      return;
    }

    setRightSidebarOpen(true);
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

      <MobileDetailSheet open={!isDesktop && rightSidebarOpen} onOpenChange={handleDetailPanelOpenChange}>
        {selectedWorkout ? (
          <WorkoutDetailPanel
            workout={selectedWorkout}
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
                  onClick={toggleDesktopDetailPanel}
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
                        workout={selectedWorkout}
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
  calendarFocusDate,
  eventType,
  filteredWorkouts,
  status,
  selectedWorkoutSlug,
  onFocusDateChange,
  onEventTypeChange,
  onStatusChange,
  onSelectWorkout,
}: {
  calendarFocusDate: string;
  eventType: WorkoutFilters["eventType"];
  filteredWorkouts: WorkoutNote[];
  status: WorkoutStatus;
  selectedWorkoutSlug: string | null;
  onFocusDateChange: (value: string) => void;
  onEventTypeChange: (value: WorkoutFilters["eventType"]) => void;
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
            onStatusChange={onStatusChange}
          />
        </div>

        {filteredWorkouts.length > 0 && calendarFocusDate ? (
          <CalendarMonthGrid
            calendarFocusDate={calendarFocusDate}
            filteredWorkouts={filteredWorkouts}
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
  return (
    <div className="flex items-stretch gap-2 lg:inline-flex lg:gap-0">
      <Button
        aria-label="Jump to today"
        className="size-11 shrink-0 rounded-[0.5rem] p-0 lg:size-10 lg:rounded-none lg:rounded-l-[0.35rem] lg:border-r lg:border-foreground/10"
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

      <CalendarFilterMenu
        eventType={eventType}
        status={status}
        triggerClassName="size-11 shrink-0 rounded-[0.5rem] p-0 lg:size-10 lg:rounded-none lg:rounded-r-[0.35rem]"
        onEventTypeChange={onEventTypeChange}
        onStatusChange={onStatusChange}
      />
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
  const [pickerMonth, setPickerMonth] = useState<Date>(() => selectedDate ?? new Date());

  useEffect(() => {
    if (selectedDateKey) {
      setPickerMonth(parseDateKey(selectedDateKey));
    }
  }, [selectedDateKey]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          className={cn("h-10 min-w-44 justify-between rounded-[0.35rem] px-3 py-0", triggerClassName)}
          disabled={!selectedDateKey}
          type="button"
          variant="secondary"
        >
          <span>{selectedDate ? formatMonthLabel(selectedDateKey) : "Pick month"}</span>
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
          mode="single"
          month={pickerMonth}
          selected={selectedDate}
          onMonthChange={setPickerMonth}
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
  status,
  triggerClassName,
  onEventTypeChange,
  onStatusChange,
}: {
  eventType: WorkoutFilters["eventType"];
  status: WorkoutStatus;
  triggerClassName?: string;
  onEventTypeChange: (value: WorkoutFilters["eventType"]) => void;
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
  calendarFocusDate,
  filteredWorkouts,
  selectedWorkoutSlug,
  onSelectWorkout,
}: {
  calendarFocusDate: string;
  filteredWorkouts: WorkoutNote[];
  selectedWorkoutSlug: string | null;
  onSelectWorkout: (slug: string) => void;
}) {
  const calendarRange = useMemo(
    () => buildContinuousCalendarRange(filteredWorkouts, calendarFocusDate),
    [calendarFocusDate, filteredWorkouts],
  );
  const isMobileViewport = useMediaQuery("(max-width: 1023px)");
  const mobileDaysRef = useRef<HTMLDivElement | null>(null);
  const desktopWeeksViewportRef = useRef<HTMLDivElement | null>(null);
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

    return buildCalendarCells(calendarRange.startDate, calendarRange.endDate, workoutsByDate);
  }, [calendarFocusDate, calendarRange.endDate, calendarRange.startDate, filteredWorkouts]);
  const weeks = useMemo(() => chunkCalendarWeeks(cells), [cells]);
  const maxWeekStart = Math.max(weeks.length - 3, 0);

  useEffect(() => {
    if (!calendarFocusDate) {
      return;
    }

    if (isMobileViewport) {
      const targetDayCard = mobileDaysRef.current?.querySelector<HTMLElement>(
        `[data-calendar-date="${calendarFocusDate}"]`,
      );
      targetDayCard?.scrollIntoView({
        block: "center",
        behavior: "auto",
      });
      return;
    }

    if (!desktopWeeksViewportRef.current) {
      return;
    }

    const focusWeekIndex = weeks.findIndex((week) =>
      week.some((cell) => cell.date === calendarFocusDate),
    );
    if (focusWeekIndex === -1) {
      return;
    }

    const nextWeekStart = clampNumber(focusWeekIndex - 1, 0, maxWeekStart);
    desktopWeeksViewportRef.current.scrollTo({
      top: nextWeekStart * DESKTOP_CALENDAR_ROW_HEIGHT,
      behavior: "auto",
    });
  }, [calendarFocusDate, isMobileViewport, maxWeekStart, weeks]);

  return (
    <div className="mt-8">
      <div className="grid gap-3 lg:hidden" ref={mobileDaysRef}>
        {cells.map((day) => (
          <section
            className={cn(
              "flex scroll-mt-28 flex-col rounded-[0.35rem] border px-3 py-3",
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
              <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
                {day.workouts.map((workout) => {
                  const selected = workout.slug === selectedWorkoutSlug;
                  const statusTone = getWorkoutStatusTone(workout);

                  return (
                    <Button
                      className={cn(
                        "h-full w-full flex-1 items-start justify-start rounded-[0.35rem] px-3 py-2 text-left whitespace-normal",
                        getWorkoutCardToneClasses(statusTone, selected),
                      )}
                      key={workout.slug}
                      type="button"
                      variant="secondary"
                      onClick={() => onSelectWorkout(workout.slug)}
                    >
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
          className="relative overflow-y-auto border-l border-foreground/10"
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
                            "h-full min-h-0 w-full items-start justify-start overflow-hidden rounded-[0.35rem] px-2 py-1.5 text-left whitespace-normal",
                            cell.isOutsideRange && "opacity-80",
                            compactCards && "px-2 py-1",
                            getWorkoutCardToneClasses(statusTone, selected),
                          )}
                          key={workout.slug}
                          type="button"
                          variant="secondary"
                          onClick={() => onSelectWorkout(workout.slug)}
                        >
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
  const EventTypeIcon = eventTypeMeta.icon;
  const iconSizeClass = compact ? "size-3.5" : "size-4";

  return (
    <span
      aria-label={
        displayDistance
          ? `${eventTypeMeta.label}, ${displayDistance} kilometres`
          : eventTypeMeta.label
      }
      className="relative flex h-full w-full"
    >
      <span className="absolute left-0 top-0 flex items-start justify-start">
        <EventTypeIcon
          aria-hidden="true"
          className={cn(iconSizeClass, selected ? "text-primary-foreground" : "text-foreground")}
        />
      </span>
      {displayDistance ? (
        <span
          className={cn(
            "flex h-full w-full items-center justify-center font-extrabold tabular-nums",
            getWorkoutCardDistanceSizeClass(displayDistanceKm, compact),
            selected ? "text-primary-foreground" : "text-foreground",
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

function WorkoutDetailPanel({
  workout,
  onLinkClick,
}: {
  workout: WorkoutNote;
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
              <MetadataRow label="Event type" value={getWorkoutEventTypeMeta(workout.eventType).label} />
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

function getWorkoutEventTypeMeta(eventType: WorkoutEventType) {
  return EVENT_TYPE_META[eventType];
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
  tone: "completed" | "default" | "overdue",
  selected: boolean,
) {
  if (selected) {
    return "bg-primary text-primary-foreground hover:bg-primary/90";
  }

  if (tone === "completed") {
    return "bg-emerald-100 text-emerald-950 hover:bg-emerald-200";
  }

  if (tone === "overdue") {
    return "bg-rose-100 text-rose-950 hover:bg-rose-200";
  }

  return "bg-surface-panel-alt text-foreground hover:bg-surface-hero/65";
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

function getTodayDateKey() {
  return formatDateKey(new Date());
}

function resolveDefaultFocusDate(workouts: WorkoutNote[]) {
  const today = getTodayDateKey();
  return workouts.find((workout) => workout.date >= today)?.date ?? workouts[workouts.length - 1]?.date ?? today;
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

function chunkCalendarWeeks(cells: CalendarCell[]) {
  const weeks: CalendarCell[][] = [];

  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return weeks;
}

function buildContinuousCalendarRange(workouts: WorkoutNote[], focusDate: string) {
  const workoutDates = workouts.map((workout) => workout.date);
  const earliestDate = workoutDates[0] ?? focusDate;
  const latestDate = workoutDates[workoutDates.length - 1] ?? focusDate;
  const rangeStartDate = startOfWeek(addDaysToDate(parseDateKey(minDateKey(earliestDate, focusDate)), -182));
  const rangeEndDate = endOfWeek(addDaysToDate(parseDateKey(maxDateKey(latestDate, focusDate)), 182));

  return {
    startDate: formatDateKey(rangeStartDate),
    endDate: formatDateKey(rangeEndDate),
  };
}

function buildCalendarCells(
  startDateKey: string,
  endDateKey: string,
  workoutsByDate: Map<string, WorkoutNote[]>,
) {
  const startDate = parseDateKey(startDateKey);
  const endDate = parseDateKey(endDateKey);
  const todayDateKey = getTodayDateKey();
  const cells: Array<{
    date: string;
    isToday: boolean;
    isOutsideRange: boolean;
    key: string;
    workouts: WorkoutNote[];
  }> = [];

  for (let currentDate = startDate; currentDate <= endDate; currentDate = addDaysToDate(currentDate, 1)) {
    const date = formatDateKey(currentDate);
    cells.push({
      key: date,
      date,
      isToday: date === todayDateKey,
      isOutsideRange: false,
      workouts: workoutsByDate.get(date) ?? [],
    });
  }

  return cells;
}

function parseDateKey(value: string) {
  return new Date(`${value}T00:00:00`);
}

function formatDateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatMonthLabel(value: string) {
  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
  }).format(parseDateKey(value));
}

function addDaysToDate(value: Date, days: number) {
  const nextValue = new Date(value);
  nextValue.setDate(nextValue.getDate() + days);
  return nextValue;
}

function startOfWeek(value: Date) {
  return addDaysToDate(value, -((value.getDay() + 6) % 7));
}

function endOfWeek(value: Date) {
  return addDaysToDate(startOfWeek(value), 6);
}

function minDateKey(left: string, right: string) {
  return left <= right ? left : right;
}

function maxDateKey(left: string, right: string) {
  return left >= right ? left : right;
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
