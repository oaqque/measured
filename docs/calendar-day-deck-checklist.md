# Calendar Day Deck Checklist

Source spec: [docs/calendar-day-deck-spec.md](/home/willye/Workspace/measured/docs/calendar-day-deck-spec.md)

## Decisions Locked

- [x] Use a one-day-at-a-time stack on desktop and mobile.
- [x] Make the month picker snap directly to the selected day.
- [x] Require wheel, swipe, and drag input.
- [x] Prefer bounded rendering over unbounded calendar rendering.
- [x] Treat lazy loading as bounded DOM and bounded date-buffer computation, not
  network fetching.
- [x] Clamp navigation to a bounded date range instead of looping infinitely.
- [x] Show 3 visible stack layers in v1.
- [x] Drag only the active card in v1.
- [x] Use a short entry animation for direct jumps unless reduced motion is
  enabled.
- [x] Skip inertia and momentum throw behavior in v1.

## Delivery Checklist

### Repo Setup

- [x] Add `gsap` to `package.json`.
- [x] Add `@gsap/react` to `package.json`.
- [x] Install dependencies and update the lockfile.
- [x] Verify the app still typechecks before refactoring.

### Phase 1: Extract Calendar Feature Structure

- [x] Create `src/features/calendar/`.
- [x] Add `src/features/calendar/CalendarView.tsx`.
- [x] Add `src/features/calendar/CalendarControls.tsx`.
- [x] Move `CalendarView` out of `src/App.tsx`.
- [x] Move `CalendarControls` out of `src/App.tsx`.
- [x] Move `DesktopEventTypeFilters` out of `src/App.tsx`.
- [x] Move `MonthPicker` out of `src/App.tsx`.
- [x] Move `CalendarFilterMenu` out of `src/App.tsx`.
- [x] Keep the extracted controls behavior unchanged.
- [x] Keep existing filter props and callbacks unchanged.
- [x] Keep existing month picker behavior unchanged.
- [x] Replace inline calendar imports/usages in `src/App.tsx`.
- [x] Verify `src/App.tsx` still owns route state and workout pane logic.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.

### Phase 2: Replace Scroll-Window Helpers With Day-Buffer Helpers

- [x] Add `buildWorkoutsByDate()` in `src/lib/calendar.ts`.
- [x] Add `getWorkoutDateRange()` in `src/lib/calendar.ts`.
- [x] Add `clampDateToRange()` in `src/lib/calendar.ts`.
- [x] Add `getAdjacentDate()` in `src/lib/calendar.ts`.
- [x] Add `buildCalendarDay()` in `src/lib/calendar.ts`.
- [x] Add `buildCalendarDayBuffer()` in `src/lib/calendar.ts`.
- [x] Preserve existing date formatting helpers still needed by the UI.
- [x] Preserve `addDaysToDate()` if still used by the new model.
- [x] Stop using `chunkCalendarWeeks()`.
- [x] Stop using `buildCalendarWindow()`.
- [x] Stop using `shiftCalendarWindow()`.
- [x] Stop using `getCalendarWindowShiftScrollOffset()`.
- [x] Stop using `shouldReleaseCalendarEdgeLock()`.
- [x] Stop using `freezeViewportScroll()`.
- [x] Remove obsolete scroll-window constants when no longer referenced.
- [x] Replace helper tests in `src/App.calendar.test.ts`.
- [x] Add tests for workout grouping by date.
- [x] Add tests for date range derivation.
- [x] Add tests for clamping active dates to range.
- [x] Add tests for previous and next date derivation.
- [x] Add tests for bounded day-buffer construction.
- [x] Add tests for buffer rebuild on direct date jump.
- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.

### Phase 3: Build the Static Day Deck

- [x] Add `src/features/calendar/CalendarDayDeck.tsx`.
- [x] Add `src/features/calendar/CalendarDayCard.tsx`.
- [x] Add `src/features/calendar/useCalendarDayDeck.ts`.
- [x] Define `CalendarDayStackItem` or equivalent local type.
- [x] Build grouped date data once per filter change.
- [x] Derive a bounded active-date range from filtered workouts.
- [x] Apply the agreed rest-day margin around the filtered date range.
- [x] Keep the empty state when no workouts match filters.
- [x] Render a bounded day buffer around the active date.
- [x] Mark exactly one day as active.
- [x] Render rest days explicitly when no workouts exist for a date.
- [x] Preserve existing date label formatting.
- [x] Preserve the Today badge behavior.
- [x] Preserve workout card tone and selected styling.
- [x] Preserve `onSelectWorkout()` behavior.
- [x] Keep month picker and Today button wired to `calendarFocusDate`.
- [x] Render the one-day deck on desktop.
- [x] Render the one-day deck on mobile.
- [x] Remove the old desktop week-grid rendering path from active use.
- [x] Remove the old mobile day-list rendering path from active use.
- [x] Verify picker jumps directly to the chosen day without step playback.
- [x] Verify direct jumps rebuild the buffer around the target date.

### Phase 4: Add GSAP Integration and FLIP Transitions

- [x] Add `src/features/calendar/gsap.ts`.
- [x] Register `Flip` in `src/features/calendar/gsap.ts`.
- [x] Register `Observer` in `src/features/calendar/gsap.ts`.
- [x] Register `Draggable` in `src/features/calendar/gsap.ts`.
- [x] Register `useGSAP` in `src/features/calendar/gsap.ts`.
- [x] Add stable `data-flip-id` values to day cards.
- [x] Capture FLIP state before forward transitions.
- [x] Capture FLIP state before backward transitions.
- [x] Refill the buffer by one day on forward transitions.
- [x] Refill the buffer by one day on backward transitions.
- [x] Animate reordered cards with `Flip.from()`.
- [x] Use deterministic duration/easing for v1 transitions.
- [x] Add a direct-jump rebuild transition for month-picker jumps.
- [x] Add a transition lock so overlapping transitions cannot run.
- [x] Reset the transition lock reliably on completion and cleanup.
- [x] Prevent stale transitions from mutating state after unmount.
- [x] Verify the stack remains synchronized with `calendarFocusDate`.

### Phase 5: Add Interaction State Machine

- [x] Define an explicit deck transition state type.
- [x] Add `idle` state.
- [x] Add `animating-forward` state.
- [x] Add `animating-backward` state.
- [x] Add `rebuilding` state.
- [x] Add `dragging` state.
- [x] Add `snap-back` state.
- [x] Prevent navigation while not in `idle`, except where explicitly allowed.
- [x] Ensure drag suppresses wheel and swipe handling.
- [x] Ensure FLIP transitions suppress all new mutations.
- [x] Ensure snap-back suppresses new mutations until complete.
- [x] Add bounded queueing only if needed after first-pass testing.

### Phase 6: Add Wheel Navigation

- [x] Attach `Observer` to the day-deck container.
- [x] Resolve wheel down to next day.
- [x] Resolve wheel up to previous day.
- [x] Ignore wheel input during transitions.
- [x] Accumulate delta for trackpads instead of relying on single events.
- [x] Apply a wheel threshold to avoid accidental moves.
- [x] Clear wheel accumulation on transition start.
- [x] Clear wheel accumulation on transition end.
- [x] Verify one wheel intent resolves to one day transition.
- [x] Tune wheel threshold on mouse wheel hardware.
- [x] Tune wheel threshold on trackpad hardware.

### Phase 7: Add Swipe Navigation

- [x] Use `Observer` touch handling on the day-deck container.
- [x] Detect vertical swipe intent.
- [x] Ignore diagonal gestures unless vertical intent dominates.
- [x] Resolve swipe up to next day.
- [x] Resolve swipe down to previous day.
- [x] Ignore short accidental touches below threshold.
- [x] Resolve swipe at release rather than continuous scrub.
- [x] Verify swipe works on mobile layout.

### Phase 8: Add Drag Interaction

- [x] Bind `Draggable` only to the active card.
- [x] Restrict dragging to the vertical axis.
- [x] Move the active card with transforms rather than layout properties.
- [x] Clamp drag offset to a bounded range.
- [x] Resolve releases past threshold to previous or next day.
- [x] Resolve releases inside threshold to snap-back.
- [x] Add snap-back animation for failed transitions.
- [x] Prevent drag while a FLIP transition is active.
- [x] Keep nested workout buttons clickable.
- [x] Ensure dragging a card does not immediately activate a workout button.
- [x] Verify drag works with mouse.
- [x] Verify drag works with touch.
- [x] Tune drag threshold.
- [x] Tune snap-back duration.

### Phase 9: Add Keyboard and Reduced Motion Support

- [x] Add `src/features/calendar/useReducedMotion.ts`.
- [x] Detect `prefers-reduced-motion`.
- [x] Disable FLIP transitions when reduced motion is enabled.
- [x] Disable drag-follow visuals when reduced motion is enabled.
- [x] Keep direct state changes functional under reduced motion.
- [x] Add `ArrowUp` previous-day behavior.
- [x] Add `ArrowDown` next-day behavior.
- [x] Add `PageUp` previous-day behavior.
- [x] Add `PageDown` next-day behavior.
- [x] Add `Home` jump-to-today behavior.
- [x] Verify keyboard input respects transition locks.
- [x] Verify reduced-motion mode still supports wheel, swipe, buttons, and keyboard.

### Phase 10: Styling and Layout Cleanup

- [x] Add deck container styles to `src/index.css`.
- [x] Add stack-depth styles to `src/index.css`.
- [x] Add active-card styles to `src/index.css`.
- [x] Add pointer/touch affordance styles to `src/index.css`.
- [x] Add desktop sizing rules for the deck.
- [x] Add mobile sizing rules for the deck.
- [x] Ensure only the active card is interactive by default.
- [x] Ensure deeper cards use `pointer-events: none`.
- [x] Remove obsolete calendar grid styles once unused.
- [x] Remove obsolete calendar scroll-pane styles once unused.
- [x] Verify the stacked layout loads cleanly on desktop and mobile.

### Phase 11: App Integration Cleanup

- [x] Delete `CalendarMonthGrid` from `src/App.tsx`.
- [x] Delete `CalendarWeeksDesktop` from `src/App.tsx`.
- [x] Delete old scroll-viewport refs if no longer needed by calendar.
- [x] Delete old window-shift refs and timers if no longer needed.
- [x] Delete old wheel/scroll edge-lock logic.
- [x] Remove unused calendar helper imports from `src/App.tsx`.
- [x] Remove unused calendar helper exports from `src/lib/calendar.ts`.
- [x] Verify no dead calendar imports remain.
- [x] Verify no dead CSS selectors remain.

## Verification Checklist

### Automated

- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Update tests until they pass under the new model.

### Manual: Shared Behavior

- [x] Verify the calendar renders on desktop.
- [x] Verify the calendar renders on mobile.
- [x] Verify only one day is active at a time.
- [x] Verify the top card matches `calendarFocusDate`.
- [x] Verify the Today button jumps to today.
- [x] Verify the month picker jumps to the chosen day.
- [x] Verify month-picker jumps work for a rest day.
- [x] Verify month-picker jumps work for a day with workouts.
- [x] Verify the selected workout remains highlighted on the active day.
- [x] Verify selecting a workout opens the detail pane.
- [x] Verify selecting a workout does not change the active day unexpectedly.
- [x] Verify opening a workout on another day recenters the deck.
- [x] Verify the empty state appears when filters remove all workouts.

### Manual: Desktop

- [x] Verify mouse wheel next-day navigation.
- [x] Verify mouse wheel previous-day navigation.
- [x] Verify trackpad next-day navigation without multi-step skipping.
- [x] Verify trackpad previous-day navigation without multi-step skipping.
- [x] Verify mouse drag next-day transition.
- [x] Verify mouse drag previous-day transition.
- [x] Verify keyboard next-day navigation.
- [x] Verify keyboard previous-day navigation.

### Manual: Mobile

- [x] Verify swipe next-day navigation.
- [x] Verify swipe previous-day navigation.
- [x] Verify touch drag next-day transition.
- [x] Verify touch drag previous-day transition.
- [x] Verify tapping a workout card still works inside the active day card.

### Manual: Filters and Bounds

- [x] Verify filter changes rebuild the buffer.
- [x] Verify filter changes preserve the active date when still in range.
- [x] Verify filter changes clamp the active date when it falls out of range.
- [x] Verify earliest-date bound prevents moving backward past the range.
- [x] Verify latest-date bound prevents moving forward past the range.

### Manual: Reduced Motion

- [x] Verify reduced-motion mode disables animated transitions.
- [x] Verify reduced-motion mode disables drag-follow visuals.
- [x] Verify reduced-motion mode still allows direct navigation actions.

## Completion Criteria

- [x] No runtime calendar code depends on scroll-window shifting.
- [x] No runtime calendar rendering path depends on the desktop week grid.
- [x] Desktop and mobile both use the same day-deck interaction model.
- [x] Month-picker jumps rebuild directly around a target day.
- [x] Wheel, swipe, drag, buttons, and keyboard all operate on the same
  active-date state machine.
- [x] Reduced-motion mode avoids animated transitions.
- [x] Tests pass.
- [x] Typecheck passes.
