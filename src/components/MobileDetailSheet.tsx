import { useEffect, useRef, type ReactNode } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const CLOSE_THRESHOLD_PX = 120;
const SNAP_DURATION_MS = 180;

export function MobileDetailSheet({
  children,
  open,
  onOpenChange,
}: {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const dragStateRef = useRef<{
    currentOffset: number;
    pointerId: number;
    rafId: number | null;
    releaseTimer: number | null;
    startY: number;
  } | null>(null);

  useEffect(() => {
    if (open) {
      resetSheetStyles(contentRef.current);
      return;
    }

    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
    cleanupDragState(dragStateRef.current);
    dragStateRef.current = null;
    resetSheetStyles(contentRef.current);
  }, [open]);

  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
      cleanupDragState(dragStateRef.current);
      dragStateRef.current = null;
      resetSheetStyles(contentRef.current);
    };
  }, []);

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        dragCleanupRef.current?.();
        dragCleanupRef.current = null;
        cleanupDragState(dragStateRef.current);
        dragStateRef.current = null;
        resetSheetStyles(contentRef.current);
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent
        className="h-[min(82vh,52rem)] rounded-t-[0.75rem] border-foreground/10 p-0 lg:hidden"
        overlayClassName="bg-foreground/10 backdrop-blur-0"
        ref={contentRef}
        side="bottom"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div
            aria-hidden="true"
            className="flex items-center justify-center px-4 pb-2 pt-3 select-none touch-none outline-none [webkit-tap-highlight-color:transparent]"
            onPointerDown={(event) => {
              if (!contentRef.current) {
                return;
              }

              event.currentTarget.setPointerCapture(event.pointerId);
              const element = contentRef.current;
              const dragState = {
                currentOffset: 0,
                pointerId: event.pointerId,
                rafId: null as number | null,
                releaseTimer: null as number | null,
                startY: event.clientY,
              };

              dragStateRef.current = dragState;
              element.style.transition = "none";
              element.style.willChange = "transform";

              const applyOffset = () => {
                dragState.rafId = null;
                if (!contentRef.current) {
                  return;
                }
                contentRef.current.style.transform = `translateY(${dragState.currentOffset}px)`;
              };

              const handlePointerMove = (moveEvent: PointerEvent) => {
                if (moveEvent.pointerId !== dragState.pointerId) {
                  return;
                }

                dragState.currentOffset = Math.max(0, moveEvent.clientY - dragState.startY);

                if (dragState.rafId !== null) {
                  return;
                }

                dragState.rafId = window.requestAnimationFrame(applyOffset);
              };

              const finishInteraction = (shouldClose: boolean) => {
                dragCleanupRef.current?.();
                dragCleanupRef.current = null;

                if (dragState.rafId !== null) {
                  window.cancelAnimationFrame(dragState.rafId);
                  dragState.rafId = null;
                }

                if (!contentRef.current) {
                  dragStateRef.current = null;
                  onOpenChange(!shouldClose ? open : false);
                  return;
                }

                const elementToAnimate = contentRef.current;
                elementToAnimate.style.transition = `transform ${SNAP_DURATION_MS}ms ease-out`;
                elementToAnimate.style.willChange = "transform";

                if (shouldClose) {
                  elementToAnimate.style.transform = `translateY(${window.innerHeight}px)`;
                  dragState.releaseTimer = window.setTimeout(() => {
                    resetSheetStyles(contentRef.current);
                    dragStateRef.current = null;
                    onOpenChange(false);
                  }, SNAP_DURATION_MS);
                  return;
                }

                elementToAnimate.style.transform = "translateY(0px)";
                dragState.releaseTimer = window.setTimeout(() => {
                  resetSheetStyles(contentRef.current);
                  dragStateRef.current = null;
                }, SNAP_DURATION_MS);
              };

              const handlePointerUp = (upEvent: PointerEvent) => {
                if (upEvent.pointerId !== dragState.pointerId) {
                  return;
                }

                finishInteraction(dragState.currentOffset > CLOSE_THRESHOLD_PX);
              };

              window.addEventListener("pointermove", handlePointerMove, { passive: true });
              window.addEventListener("pointerup", handlePointerUp);
              window.addEventListener("pointercancel", handlePointerUp);
              dragCleanupRef.current = () => {
                window.removeEventListener("pointermove", handlePointerMove);
                window.removeEventListener("pointerup", handlePointerUp);
                window.removeEventListener("pointercancel", handlePointerUp);
              };
            }}
          >
            <span className="h-1.5 w-12 rounded-full bg-foreground/12" />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2">
            {children}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function cleanupDragState(
  dragState: {
    rafId: number | null;
    releaseTimer: number | null;
  } | null,
) {
  if (!dragState) {
    return;
  }

  if (dragState.rafId !== null) {
    window.cancelAnimationFrame(dragState.rafId);
  }

  if (dragState.releaseTimer !== null) {
    window.clearTimeout(dragState.releaseTimer);
  }
}

function resetSheetStyles(element: HTMLDivElement | null) {
  if (!element) {
    return;
  }

  element.style.removeProperty("transform");
  element.style.removeProperty("transition");
  element.style.removeProperty("will-change");
}
