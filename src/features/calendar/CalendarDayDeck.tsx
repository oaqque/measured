import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CalendarDayCard } from "@/features/calendar/CalendarDayCard";
import { gsap } from "@/features/calendar/gsap";
import { useReducedMotion } from "@/features/calendar/useReducedMotion";
import { useCalendarDayDeck } from "@/features/calendar/useCalendarDayDeck";
import { clampDateToRange, getTodayDateKey, type CalendarDayData } from "@/lib/calendar";
import type { WorkoutNote } from "@/lib/workouts/schema";

type TransitionDirection = "forward" | "backward";
type DeckTransitionState =
  | "idle"
  | "animating-forward"
  | "animating-backward"
  | "rebuilding";

type PendingTransition = {
  direction: TransitionDirection;
  outgoing: CalendarDayData;
  targetDate: string;
};

type ActiveTransition = {
  direction: TransitionDirection;
  incoming: CalendarDayData;
  outgoing: CalendarDayData;
};

type DragPreview = {
  direction: TransitionDirection;
  incoming: CalendarDayData;
  outgoing: CalendarDayData;
  targetDate: string;
};

type PointerGesture = {
  axis: "pending" | "horizontal" | "vertical" | "blocked";
  pointerId: number;
  pointerType: string;
  scrollTop: number;
  workoutList: HTMLElement | null;
  x: number;
  y: number;
};

export type CalendarDayDeckHandle = {
  jumpToDate: (date: string) => void;
};

function getWorkoutList(target: Element) {
  const workoutList = target.closest("[data-calendar-workout-list='true']");
  return workoutList instanceof HTMLElement ? workoutList : null;
}

export const CalendarDayDeck = forwardRef<
  CalendarDayDeckHandle,
  {
    activeDate: string;
    filteredWorkouts: WorkoutNote[];
    selectedWorkoutSlug: string | null;
    onActiveDateChange: (date: string) => void;
    onSelectWorkout: (slug: string) => void;
  }
>(function CalendarDayDeck(
  { activeDate, filteredWorkouts, selectedWorkoutSlug, onActiveDateChange, onSelectWorkout },
  ref,
) {
  const reducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const incomingCardRef = useRef<HTMLDivElement | null>(null);
  const outgoingCardRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<gsap.core.Timeline | null>(null);
  const pendingTransitionRef = useRef<PendingTransition | null>(null);
  const resetStateFrameRef = useRef<number | null>(null);
  const dragOffsetRef = useRef(0);
  const pointerGestureRef = useRef<PointerGesture | null>(null);
  const suppressClickRef = useRef(false);
  const [transitionState, setTransitionState] = useState<DeckTransitionState>("idle");
  const [activeTransition, setActiveTransition] = useState<ActiveTransition | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [displayedDay, setDisplayedDay] = useState<CalendarDayData | null>(null);
  const {
    activeDate: resolvedActiveDate,
    activeDay,
    canGoBackward,
    canGoForward,
    nextDay,
    nextDate,
    previousDay,
    previousDate,
    range,
  } = useCalendarDayDeck({
    activeDate,
    filteredWorkouts,
    onActiveDateChange,
  });

  const resetAnimatedCards = useCallback(() => {
    const targets = [incomingCardRef.current, outgoingCardRef.current].filter(
      (value): value is HTMLDivElement => value !== null,
    );
    if (targets.length === 0) {
      return;
    }

    gsap.killTweensOf(targets);
    gsap.set(targets, { clearProps: "all" });
    dragOffsetRef.current = 0;
  }, []);

  const finishTransition = useCallback(() => {
    if (activeTransition) {
      setDisplayedDay(activeTransition.incoming);
    }
    resetAnimatedCards();
    animationRef.current = null;
    pendingTransitionRef.current = null;
    setActiveTransition(null);
    setDragPreview(null);
    setTransitionState("idle");
  }, [activeTransition, resetAnimatedCards]);

  const queueResetToIdle = useCallback(() => {
    if (resetStateFrameRef.current !== null) {
      window.cancelAnimationFrame(resetStateFrameRef.current);
    }

    resetStateFrameRef.current = window.requestAnimationFrame(() => {
      resetStateFrameRef.current = null;
      finishTransition();
    });
  }, [finishTransition]);

  const requestDateTransition = useCallback(
    (targetDate: string) => {
      const resolvedTargetDate = range ? clampDateToRange(targetDate, range) : targetDate;
      if (
        !displayedDay ||
        transitionState !== "idle" ||
        !resolvedTargetDate ||
        resolvedTargetDate === resolvedActiveDate
      ) {
        return;
      }

      const direction: TransitionDirection =
        resolvedTargetDate > resolvedActiveDate ? "forward" : "backward";

      if (reducedMotion) {
        setTransitionState(direction === "forward" ? "animating-forward" : "animating-backward");
        onActiveDateChange(resolvedTargetDate);
        queueResetToIdle();
        return;
      }

      pendingTransitionRef.current = {
        direction,
        outgoing: displayedDay,
        targetDate: resolvedTargetDate,
      };
      setTransitionState(direction === "forward" ? "animating-forward" : "animating-backward");
      onActiveDateChange(resolvedTargetDate);
    },
    [displayedDay, onActiveDateChange, queueResetToIdle, range, reducedMotion, resolvedActiveDate, transitionState],
  );

  const navigateForward = useCallback(() => {
    if (!canGoForward || !nextDate) {
      return;
    }

    requestDateTransition(nextDate);
  }, [canGoForward, nextDate, requestDateTransition]);

  const navigateBackward = useCallback(() => {
    if (!canGoBackward || !previousDate) {
      return;
    }

    requestDateTransition(previousDate);
  }, [canGoBackward, previousDate, requestDateTransition]);

  const jumpToTargetDate = useCallback(
    (date: string) => {
      if (!date || date === resolvedActiveDate) {
        return;
      }

      requestDateTransition(date);
    },
    [requestDateTransition, resolvedActiveDate],
  );

  useImperativeHandle(
    ref,
    () => ({
      jumpToDate: jumpToTargetDate,
    }),
    [jumpToTargetDate],
  );

  useEffect(() => {
    if (pendingTransitionRef.current || transitionState !== "idle") {
      return;
    }

    const nextDisplayedDay = activeDay ?? null;
    const syncFrame = window.requestAnimationFrame(() => {
      setDisplayedDay(nextDisplayedDay);
    });

    return () => {
      window.cancelAnimationFrame(syncFrame);
    };
  }, [activeDay, transitionState]);

  useEffect(() => {
    if (!pendingTransitionRef.current || !activeDay) {
      return;
    }

    if (activeDay.date !== pendingTransitionRef.current.targetDate) {
      return;
    }

    setActiveTransition({
      direction: pendingTransitionRef.current.direction,
      incoming: activeDay,
      outgoing: pendingTransitionRef.current.outgoing,
    });
  }, [activeDay]);

  useLayoutEffect(() => {
    if (!activeTransition || reducedMotion) {
      return;
    }

    const incoming = incomingCardRef.current;
    const outgoing = outgoingCardRef.current;
    if (!incoming || !outgoing) {
      const finishFrame = window.requestAnimationFrame(() => {
        finishTransition();
      });
      return () => {
        window.cancelAnimationFrame(finishFrame);
      };
    }

    const incomingFrom = activeTransition.direction === "forward" ? 112 : -112;
    const outgoingTo = activeTransition.direction === "forward" ? -112 : 112;

    animationRef.current?.kill();
    resetAnimatedCards();
    gsap.set(incoming, {
      xPercent: incomingFrom,
      zIndex: 2,
    });
    gsap.set(outgoing, {
      xPercent: 0,
      zIndex: 1,
    });

    animationRef.current = gsap
      .timeline({
        defaults: {
          duration: 0.34,
          ease: "power3.out",
        },
        onComplete: finishTransition,
      })
      .to(
        outgoing,
        {
          duration: 0.3,
          ease: "power2.inOut",
          xPercent: outgoingTo,
        },
        0,
      )
      .to(
        incoming,
        {
          xPercent: 0,
        },
        0,
      );
  }, [activeTransition, finishTransition, reducedMotion, resetAnimatedCards]);

  useLayoutEffect(() => {
    if (!dragPreview || activeTransition || reducedMotion) {
      return;
    }

    const incoming = incomingCardRef.current;
    const outgoing = outgoingCardRef.current;
    const container = containerRef.current;
    if (!incoming || !outgoing || !container) {
      return;
    }

    const width = container.offsetWidth;
    const incomingStart = dragPreview.direction === "forward" ? width : -width;
    const dragOffset = dragOffsetRef.current;

    animationRef.current?.kill();
    resetAnimatedCards();
    gsap.set(outgoing, { x: dragOffset, zIndex: 2 });
    gsap.set(incoming, { x: incomingStart + dragOffset, zIndex: 1 });
  }, [activeTransition, dragPreview, reducedMotion, resetAnimatedCards]);

  useEffect(() => {
    return () => {
      animationRef.current?.kill();
      if (resetStateFrameRef.current !== null) {
        window.cancelAnimationFrame(resetStateFrameRef.current);
      }
    };
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (transitionState !== "idle") {
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        navigateForward();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigateBackward();
        return;
      }

      if (event.key === "Home") {
        event.preventDefault();
        jumpToTargetDate(getTodayDateKey());
      }
    },
    [jumpToTargetDate, navigateBackward, navigateForward, transitionState],
  );

  const handlePointerDown = useCallback(() => {
    containerRef.current?.focus();
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateDragTransforms = () => {
      const incoming = incomingCardRef.current;
      const outgoing = outgoingCardRef.current;
      const preview = dragPreview;
      const width = container.offsetWidth;
      if (!incoming || !outgoing || !preview || width === 0) {
        return;
      }

      const incomingStart = preview.direction === "forward" ? width : -width;
      const dragOffset = dragOffsetRef.current;
      gsap.set(outgoing, { x: dragOffset });
      gsap.set(incoming, { x: incomingStart + dragOffset });
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (transitionState !== "idle") {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (!target.closest("[data-calendar-card-slot]")) {
        return;
      }

      if (event.pointerType === "mouse") {
        return;
      }

      suppressClickRef.current = false;
      pointerGestureRef.current = {
        axis: "pending",
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        scrollTop: getWorkoutList(target)?.scrollTop ?? 0,
        workoutList: getWorkoutList(target),
        x: event.clientX,
        y: event.clientY,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId || transitionState !== "idle") {
        return;
      }

      const deltaX = event.clientX - gesture.x;
      const deltaY = event.clientY - gesture.y;
      const absoluteDeltaX = Math.abs(deltaX);
      const absoluteDeltaY = Math.abs(deltaY);

      if (
        gesture.workoutList &&
        gesture.axis === "pending" &&
        Math.abs(gesture.workoutList.scrollTop - gesture.scrollTop) > 2
      ) {
        gesture.axis = "vertical";
        return;
      }

      if (gesture.axis === "pending") {
        const dragStartThreshold = gesture.pointerType === "pen" ? 12 : 10;

        if (absoluteDeltaX < dragStartThreshold && absoluteDeltaY < dragStartThreshold) {
          return;
        }

        if (absoluteDeltaY > absoluteDeltaX * 1.1) {
          gesture.axis = "vertical";
          return;
        }

        const direction: TransitionDirection = deltaX < 0 ? "forward" : "backward";
        const incoming = direction === "forward" ? nextDay : previousDay;
        const targetDate = direction === "forward" ? nextDate : previousDate;
        if (!incoming || !targetDate || !displayedDay) {
          gesture.axis = "blocked";
          return;
        }

        gesture.axis = "horizontal";
        suppressClickRef.current = true;
        dragOffsetRef.current = deltaX;
        setDragPreview({
          direction,
          incoming,
          outgoing: displayedDay,
          targetDate,
        });
        container.setPointerCapture(event.pointerId);
        event.preventDefault();
        return;
      }

      if (gesture.axis !== "horizontal") {
        return;
      }

      const width = container.offsetWidth;
      if (width === 0) {
        return;
      }

      event.preventDefault();
      dragOffsetRef.current = Math.max(-width * 0.82, Math.min(width * 0.82, deltaX));
      updateDragTransforms();
    };

    const finalizeDrag = () => {
      const preview = dragPreview;
      pointerGestureRef.current = null;
      if (!preview) {
        return;
      }

      const width = container.offsetWidth;
      const currentOffset = dragOffsetRef.current;
      const threshold = width * 0.22;
      const commit =
        (preview.direction === "forward" && currentOffset <= -threshold) ||
        (preview.direction === "backward" && currentOffset >= threshold);

      const incoming = incomingCardRef.current;
      const outgoing = outgoingCardRef.current;
      if (!incoming || !outgoing) {
        setDragPreview(null);
        return;
      }

      const incomingStart = preview.direction === "forward" ? width : -width;
      animationRef.current?.kill();

      if (commit) {
        setTransitionState(preview.direction === "forward" ? "animating-forward" : "animating-backward");
        animationRef.current = gsap
          .timeline({
            defaults: {
              duration: 0.28,
              ease: "power3.out",
            },
            onComplete: () => {
              setDisplayedDay(preview.incoming);
              onActiveDateChange(preview.targetDate);
              finishTransition();
            },
          })
          .to(
            outgoing,
            {
              x: preview.direction === "forward" ? -width : width,
            },
            0,
          )
          .to(
            incoming,
            {
              x: 0,
            },
            0,
          );
        return;
      }

      animationRef.current = gsap
        .timeline({
          defaults: {
            duration: 0.22,
            ease: "power2.out",
          },
          onComplete: () => {
            setDragPreview(null);
            resetAnimatedCards();
          },
        })
        .to(
          outgoing,
          {
            x: 0,
          },
          0,
        )
        .to(
          incoming,
          {
            x: incomingStart,
          },
          0,
        );
    };

    const handlePointerUp = (event: PointerEvent) => {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }

      if (gesture.axis === "horizontal" && container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }

      finalizeDrag();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const gesture = pointerGestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) {
        return;
      }

      if (gesture.axis === "horizontal" && container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }

      finalizeDrag();
    };

    const handleClickCapture = (event: MouseEvent) => {
      if (!suppressClickRef.current) {
        return;
      }

      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };

    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointermove", handlePointerMove, { passive: false });
    container.addEventListener("pointerup", handlePointerUp);
    container.addEventListener("pointercancel", handlePointerCancel);
    container.addEventListener("click", handleClickCapture, true);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("pointercancel", handlePointerCancel);
      container.removeEventListener("click", handleClickCapture, true);
    };
  }, [
    displayedDay,
    dragPreview,
    finishTransition,
    nextDate,
    nextDay,
    onActiveDateChange,
    previousDate,
    previousDay,
    resetAnimatedCards,
    transitionState,
  ]);

  const currentDay = displayedDay ?? activeDay;

  if (!currentDay) {
    return null;
  }

  const disableNavigation = transitionState !== "idle" || dragPreview !== null;

  return (
    <div
      className="calendar-day-deck relative mx-auto mt-4 w-full max-w-4xl outline-none lg:mt-8"
      data-transition-state={transitionState}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      ref={containerRef}
      tabIndex={0}
    >
      <div className="calendar-day-carousel relative overflow-hidden p-3 sm:p-4">
        <div className="calendar-day-frame relative h-[min(60dvh,38rem)] sm:h-[min(64dvh,40rem)] lg:h-[min(72dvh,46rem)]">
          {dragPreview ? (
            <>
              <div
                className="absolute inset-0"
                data-calendar-card-slot="outgoing"
                ref={outgoingCardRef}
              >
                <CalendarDayCard
                  day={dragPreview.outgoing}
                  selectedWorkoutSlug={selectedWorkoutSlug}
                  onSelectWorkout={onSelectWorkout}
                />
              </div>
              <div
                className="absolute inset-0 pointer-events-none"
                data-calendar-card-slot="incoming"
                ref={incomingCardRef}
              >
                <CalendarDayCard
                  day={dragPreview.incoming}
                  selectedWorkoutSlug={selectedWorkoutSlug}
                  onSelectWorkout={onSelectWorkout}
                />
              </div>
            </>
          ) : activeTransition ? (
            <>
              <div
                className="absolute inset-0 pointer-events-none"
                data-calendar-card-slot="outgoing"
                ref={outgoingCardRef}
              >
                <CalendarDayCard
                  day={activeTransition.outgoing}
                  selectedWorkoutSlug={selectedWorkoutSlug}
                  onSelectWorkout={onSelectWorkout}
                />
              </div>
              <div
                className="absolute inset-0 pointer-events-none"
                data-calendar-card-slot="incoming"
                ref={incomingCardRef}
              >
                <CalendarDayCard
                  day={activeTransition.incoming}
                  selectedWorkoutSlug={selectedWorkoutSlug}
                  onSelectWorkout={onSelectWorkout}
                />
              </div>
            </>
          ) : (
            <div className="absolute inset-0" data-calendar-card-slot="active">
              <CalendarDayCard
                day={currentDay}
                selectedWorkoutSlug={selectedWorkoutSlug}
                onSelectWorkout={onSelectWorkout}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 hidden items-center justify-center gap-3 lg:flex">
        <Button
          aria-label="Previous day"
          className="size-11 rounded-full border border-foreground/10 bg-background/95 p-0 shadow-lg shadow-black/10"
          data-clickable="true"
          disabled={!canGoBackward || disableNavigation}
          type="button"
          variant="secondary"
          onClick={navigateBackward}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          aria-label="Next day"
          className="size-11 rounded-full border border-foreground/10 bg-background/95 p-0 shadow-lg shadow-black/10"
          data-clickable="true"
          disabled={!canGoForward || disableNavigation}
          type="button"
          variant="secondary"
          onClick={navigateForward}
        >
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
});
