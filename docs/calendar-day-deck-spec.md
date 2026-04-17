# Calendar Day Deck Spec

## Goal

Replace the current scroll-based calendar grid with a single GSAP-animated,
one-day-at-a-time card stack that works on desktop and mobile.

Each card represents one calendar day. The stack must support:

- wheel navigation
- swipe navigation
- direct drag interaction on the active card
- direct date jumps from the month picker
- bounded rendering around the active day instead of rendering an unbounded list

The new calendar should preserve the existing filtering, workout selection, route
syncing, and calendar-focused navigation model already used by the app.

## Product Decisions

- Desktop and mobile use the same one-day-at-a-time stack interaction.
- The month picker snaps directly to the selected day.
- We do not animate through intermediate dates when jumping via the picker.
- Wheel, swipe, and drag are all required.
- Lazy loading means bounded DOM and bounded date-window computation, not
  network fetching.

## Current State

The current calendar implementation is optimized for a scroll-based model:

- `CalendarView` and `CalendarMonthGrid` live inside `src/App.tsx`
- mobile renders a vertical list of day cards
- desktop renders a week grid
- date-window continuity is maintained by scroll edge detection and window
  shifting
- tests in `src/App.calendar.test.ts` focus on scroll-window math

That model is centered on scroll position. The new design must instead be
centered on an active date and a bounded stack buffer.

## Hard Invariants

### Interaction

- At most one day is active at a time.
- The top card is the active date and is the only card that accepts direct drag
  interaction.
- A gesture or control action must resolve to exactly one of:
  - previous day
  - next day
  - snap back to current day
  - direct jump to a picked day
- While a transition is running, additional transitions must be ignored or
  queued in a bounded way. We must not allow overlapping state mutations that
  desynchronize the stack from `calendarFocusDate`.

### State

- `calendarFocusDate` remains the source of truth for the active day.
- The visible stack buffer must always contain the active day.
- A selected workout must still open the existing workout detail pane without
  changing the active day unexpectedly.
- Changing filters may change the contents of a day card, but must not break day
  navigation.

### Performance

- The DOM for the calendar stack must remain bounded regardless of the total
  number of days in the dataset.
- Day-card rendering must be limited to a small buffer around the active date.
- Workout grouping by date must be precomputed once per filter change, not once
  per gesture.
- Animations must operate on a small number of mounted cards.

### Accessibility and Motion

- The stack must be usable with keyboard controls even if gesture input is not
  available.
- `prefers-reduced-motion` must disable animated transitions and use direct state
  swaps instead.
- The month picker, Today button, and workout buttons must remain fully
  clickable.

## Recommended Architecture

Create a dedicated calendar module and remove the stack implementation from the
large inline `src/App.tsx` calendar block.

Recommended file split:

- `src/features/calendar/CalendarView.tsx`
- `src/features/calendar/CalendarControls.tsx`
- `src/features/calendar/CalendarDayDeck.tsx`
- `src/features/calendar/CalendarDayCard.tsx`
- `src/features/calendar/useCalendarDayDeck.ts`
- `src/features/calendar/useReducedMotion.ts`
- `src/features/calendar/gsap.ts`
- `src/lib/calendar.ts`
- `src/App.calendar.test.ts`

This split keeps:

- top-level app routing in `src/App.tsx`
- date utilities in `src/lib/calendar.ts`
- gesture and animation orchestration inside the calendar feature module

## Dependencies

Add:

- `gsap`
- `@gsap/react`

Use these GSAP capabilities:

- `Flip` for stack reordering animation
- `Observer` for normalized wheel and touch intent
- `Draggable` for active-card drag interaction

Do not depend on inertia or momentum-based throws for the first iteration. The
interaction only requires threshold-based next, previous, or snap-back behavior.

## Data and Rendering Model

The app already loads all workouts from generated JSON during startup. We do not
need incremental server fetches for the calendar.

We do need a bounded render model.

### Derived Data

Compute once per filter change:

- `workoutsByDate: Map<string, WorkoutNote[]>`
- `knownWorkoutDates: string[]`
- `dateRange: { startDate: string; endDate: string }`

The stack itself must render days continuously, including rest days, so the deck
cannot be built from workout dates only.

### Day Buffer

Maintain a bounded day buffer centered on the active date.

Recommended initial buffer:

- `VISIBLE_STACK_COUNT = 5`
- `DAY_BUFFER_BEFORE = 3`
- `DAY_BUFFER_AFTER = 3`

That means:

- up to 7 mounted day cards in steady state
- only the first 3 to 5 cards need visible stacked styling
- the rest exist only to support immediate next and previous transitions

Each buffered item should contain:

```ts
type CalendarDayStackItem = {
  date: string;
  workouts: WorkoutNote[];
  isToday: boolean;
  isActive: boolean;
  position: number;
};
```

`position` is the buffer-relative slot used to derive stack depth and FLIP ids.

### Buffer Refill Strategy

On `next day`:

1. capture current FLIP state
2. promote the next buffered day to active
3. shift the buffer window forward by one day
4. append one new trailing day
5. animate the reordered stack

On `previous day`:

1. capture current FLIP state
2. promote the previous buffered day to active
3. shift the buffer window backward by one day
4. prepend one new leading day
5. animate the reordered stack

On `picker jump` or `Today`:

1. rebuild the buffer centered on the target day
2. set the active day directly
3. skip transitional day-by-day playback
4. optionally use a short entry animation for the new stack unless reduced
   motion is enabled

## State Model

`src/App.tsx` should continue to own:

- `calendarFocusDate`
- `selectedWorkoutSlug`
- filter state

`CalendarDayDeck` should own only transient deck mechanics:

- current transition lock
- buffered day items
- pending gesture direction if one is queued
- refs for deck container and card nodes

Recommended hook surface:

```ts
type CalendarDayDeckController = {
  items: CalendarDayStackItem[];
  activeDate: string;
  canGoBackward: boolean;
  canGoForward: boolean;
  goToNextDay: () => void;
  goToPreviousDay: () => void;
  jumpToDate: (date: string) => void;
  selectWorkout: (slug: string) => void;
};
```

Recommended hook inputs:

```ts
type UseCalendarDayDeckOptions = {
  activeDate: string;
  filteredWorkouts: WorkoutNote[];
  selectedWorkoutSlug: string | null;
  onActiveDateChange: (date: string) => void;
  onSelectWorkout: (slug: string) => void;
};
```

## GSAP Integration

### Registration

Create a single feature-local registration module such as
`src/features/calendar/gsap.ts`:

- register `Flip`
- register `Observer`
- register `Draggable`
- register `useGSAP`

This prevents repeated plugin registration inside render paths.

### FLIP Identity

Each rendered day card must have a stable `data-flip-id` tied to its `date`.

Example:

```tsx
data-flip-id={`calendar-day-${date}`}
```

This is required so React re-renders and buffer shifts still map correctly to
GSAP FLIP state.

### Transition Rules

For next and previous transitions:

- capture state with `Flip.getState`
- update React state
- run `Flip.from` after the DOM reflects the new buffer
- animate only the mounted stack items
- prefer `absolute: true`
- use short durations and deterministic easing

For the first implementation:

- target `220ms` to `320ms`
- use the same duration across wheel, swipe, and drag resolution
- do not allow transition interruption until behavior is correct

### Reduced Motion

If reduced motion is enabled:

- do not run FLIP transitions
- do not apply drag-follow visuals
- resolve gestures as immediate day changes

## Gesture Model

### Wheel

Use `Observer` on the deck container.

Rules:

- vertical wheel down advances to the next day
- vertical wheel up goes to the previous day
- ignore wheel input while a transition lock is active
- apply a minimum delta threshold so trackpads do not trigger accidental
  transitions from tiny movements
- debounce to one resolved navigation per transition

### Swipe

Use `Observer` on touch devices for touch intent detection.

Rules:

- upward swipe advances to the next day
- downward swipe goes to the previous day
- diagonal swipes should resolve only if vertical intent clearly dominates

### Drag

Use `Draggable` only on the active card.

Rules:

- drag axis is vertical only
- the active card follows the pointer within a bounded range
- releasing past the threshold resolves to previous or next day
- releasing inside the threshold snaps the card back to the active position
- nested workout buttons must remain clickable

Recommended first-pass thresholds:

- drag threshold: `22%` of card height
- wheel threshold: tuned experimentally for trackpads and mouse wheels
- no inertia in v1

### Keyboard

Required for parity and accessibility:

- `ArrowUp`: previous day
- `ArrowDown`: next day
- `PageUp`: previous day
- `PageDown`: next day
- `Home`: jump to today

## Card Layout

Each day card should preserve the current information architecture:

- formatted date
- weekday
- Today badge
- workouts for that day
- explicit rest-day state when no workouts exist

Recommended visual stack behavior:

- top card is fully interactive
- second and third cards are partially visible beneath it
- deeper cards are visible as compressed layers or hidden entirely
- only the active card scrolls internally if workout content exceeds available
  space

Desktop and mobile should share the same layout structure and stack behavior.
Only sizing and spacing should differ by breakpoint.

## Migration Plan

### Phase 1: Extract Calendar Structure

1. Move `CalendarView`, `CalendarControls`, and month picker related code out of
   `src/App.tsx` into `src/features/calendar/`.
2. Keep behavior unchanged during extraction.
3. Preserve current props so the app route logic stays stable.

Exit criteria:

- no visual behavior change yet
- tests still pass

### Phase 2: Replace Scroll-Window Logic With Day Buffer Logic

1. Add new date helpers to `src/lib/calendar.ts`:
   - build bounded day buffer around an active date
   - add and subtract one day
   - derive day-card metadata from `workoutsByDate`
2. Remove or stop using scroll-window helpers:
   - `chunkCalendarWeeks`
   - `buildCalendarWindow`
   - `shiftCalendarWindow`
   - `getCalendarWindowShiftScrollOffset`
   - `shouldReleaseCalendarEdgeLock`
   - `freezeViewportScroll`
3. Add tests for the new day-buffer helpers.

Exit criteria:

- a non-animated one-day deck can render and navigate by button commands

### Phase 3: Build the Stack UI

1. Implement `CalendarDayCard`.
2. Implement `CalendarDayDeck` with bounded rendered items.
3. Preserve workout selection behavior and current tone styling.
4. Keep the Today button and month picker wired to `calendarFocusDate`.

Exit criteria:

- desktop and mobile both show a one-day deck
- picker jumps directly to the chosen day

### Phase 4: Add GSAP Transitions

1. Register GSAP plugins in a dedicated module.
2. Add FLIP-based reorder animation for previous and next transitions.
3. Add a short stack rebuild animation for direct jumps.
4. Add transition locking to prevent overlapping mutations.

Exit criteria:

- wheel-independent next and previous controls animate reliably
- the stack remains in sync with `calendarFocusDate`

### Phase 5: Add Wheel, Swipe, and Drag

1. Add `Observer` for wheel.
2. Add `Observer` touch handling for swipe.
3. Add `Draggable` for the active card.
4. Keep workout buttons clickable while dragging is enabled.
5. Tune thresholds on desktop trackpads and touch devices.

Exit criteria:

- wheel, swipe, and drag all resolve correctly to previous, next, or snap-back

### Phase 6: Accessibility, Reduced Motion, and Cleanup

1. Add keyboard navigation.
2. Add `prefers-reduced-motion` handling.
3. Remove obsolete calendar grid and scroll CSS.
4. Delete no-longer-used desktop and mobile calendar renderers.

Exit criteria:

- reduced-motion path works
- no dead calendar window-shift code remains

## File-Level Change Plan

### `src/App.tsx`

- keep route state, filters, and workout detail pane logic
- replace inline calendar implementation with imported feature components
- preserve:
  - `calendarFocusDate`
  - `selectedWorkoutSlug`
  - `openWorkoutFromCalendar`

### `src/lib/calendar.ts`

Remove or deprecate scroll-window constants and helpers.

Add:

- `addDaysToDate`
- `buildCalendarDayStack`
- `buildWorkoutsByDate`
- `getAdjacentDate`
- `isDateWithinBuffer`
- formatting helpers already in use

Keep date formatting and parsing helpers where possible.

### `src/App.calendar.test.ts`

Replace scroll-window-focused tests with:

- buffer construction
- next and previous date derivation
- direct jump centering
- workout grouping by date
- reduced-motion-safe state transitions where practical

### `src/index.css`

Add stack-specific styling:

- deck container
- stacked depth transforms or CSS fallbacks
- active card sizing
- pointer and touch affordances

Remove obsolete week-grid-specific calendar styles once the migration is
complete.

## Open Implementation Decisions

These should be resolved before coding begins:

1. Whether the stack should loop infinitely beyond the known workout range or
   clamp to a bounded date range.
2. How many trailing cards should remain visibly exposed on smaller screens.
3. Whether drag should move the entire stack or only the active card.
4. Whether direct date jumps should have a small entry animation or be fully
   instantaneous.

Recommended answers for v1:

- clamp to a bounded date range derived from the filtered workout span with a
  small rest-day margin
- show 3 visible stack layers
- drag only the active card
- use a short stack entry animation for direct jumps unless reduced motion is
  enabled

## Verification Expectations

- `pnpm test` must pass after replacing the calendar helper tests.
- `pnpm typecheck` must pass after extracting components and adding GSAP.
- Manual verification must cover:
  - desktop mouse wheel
  - desktop trackpad
  - mobile touch swipe
  - active-card drag
  - workout card click-through
  - month picker jump
  - Today button jump
  - reduced-motion mode
  - filter changes while on a rest day and while on a day with workouts

## Delivery Sequence

Implement in this order:

1. component extraction without behavior change
2. day-buffer helpers and tests
3. static one-day deck
4. FLIP transitions
5. wheel and swipe
6. drag
7. reduced motion and cleanup

This order keeps the interaction model correct before animation polish and
reduces the risk of debugging GSAP and state migration simultaneously.

## Non-Goals

This implementation does not include:

- server-side pagination or API-backed calendar loading
- infinite looping beyond the allowed date range
- momentum or physics-based throw behavior
- simultaneous multi-card drag interactions
- a second calendar mode that preserves the old week grid

If those are desired later, they should be separate follow-up work after the
day-deck interaction is stable.

## Concrete Deliverables

The implementation is complete only when all of the following exist in the repo:

- extracted calendar feature components under `src/features/calendar/`
- GSAP installed and registered through a calendar-local integration module
- a bounded one-day deck rendered on desktop and mobile
- next and previous transitions driven by FLIP, not scroll position
- month picker jumps that rebuild the deck around a target date
- wheel, swipe, and drag support
- keyboard navigation and reduced-motion handling
- updated unit tests for the new helper model
- removal of obsolete scroll-window calendar code

## Detailed File Plan

### New Files

#### `src/features/calendar/CalendarView.tsx`

Responsibility:

- compose controls plus deck
- keep calendar-specific layout out of `src/App.tsx`

Expected props:

```ts
type CalendarViewProps = {
  calendarFocusDate: string;
  eventType: WorkoutFilters["eventType"];
  filteredWorkouts: WorkoutNote[];
  selectedWorkoutSlug: string | null;
  status: WorkoutStatus;
  onFocusDateChange: (value: string) => void;
  onEventTypeChange: (value: WorkoutFilters["eventType"]) => void;
  onStatusChange: (value: WorkoutStatus) => void;
  onSelectWorkout: (slug: string) => void;
};
```

#### `src/features/calendar/CalendarControls.tsx`

Responsibility:

- host Today button
- host month picker
- host desktop event-type buttons
- host filter menu

This file should mostly be extracted from existing code with minimal behavior
change.

#### `src/features/calendar/CalendarDayDeck.tsx`

Responsibility:

- render the bounded stack
- own deck refs
- bind gesture plugins
- coordinate FLIP transitions

Expected props:

```ts
type CalendarDayDeckProps = {
  activeDate: string;
  filteredWorkouts: WorkoutNote[];
  selectedWorkoutSlug: string | null;
  onActiveDateChange: (date: string) => void;
  onSelectWorkout: (slug: string) => void;
};
```

#### `src/features/calendar/CalendarDayCard.tsx`

Responsibility:

- render one day
- preserve today badge, rest-day state, and workout buttons
- expose refs and data attributes needed by GSAP and gesture logic

Expected props:

```ts
type CalendarDayCardProps = {
  day: CalendarDayStackItem;
  selectedWorkoutSlug: string | null;
  stackDepth: number;
  isInteractive: boolean;
  onSelectWorkout: (slug: string) => void;
};
```

#### `src/features/calendar/useCalendarDayDeck.ts`

Responsibility:

- prepare grouped workout data
- build and refill the bounded day buffer
- expose imperative next, previous, and jump actions
- hold transition lock and queued direction state

This hook must be pure React state plus helper orchestration. It should not
instantiate GSAP plugins directly.

#### `src/features/calendar/useReducedMotion.ts`

Responsibility:

- wrap `window.matchMedia("(prefers-reduced-motion: reduce)")`
- expose a stable boolean for calendar animation decisions

This can also be reused elsewhere later.

#### `src/features/calendar/gsap.ts`

Responsibility:

- import and register `Flip`, `Observer`, `Draggable`, and `useGSAP`
- export GSAP objects already registered for use in calendar feature files

This file should be the only place where calendar GSAP registration happens.

### Existing Files to Modify

#### `src/App.tsx`

Changes:

- replace inline calendar JSX with imported feature component usage
- delete now-obsolete `CalendarMonthGrid` and `CalendarWeeksDesktop`
- preserve app route logic, selected workout behavior, and top-level filter
  state

Do not move:

- route parsing
- workout detail pane logic
- app-wide layout state

#### `src/lib/calendar.ts`

Changes:

- keep date parsing and formatting helpers that still apply
- add new bounded-buffer helpers
- delete or deprecate scroll-window helpers after migration

#### `src/App.calendar.test.ts`

Changes:

- replace tests coupled to scroll behavior with tests coupled to active-date and
  buffer behavior

#### `src/index.css`

Changes:

- add deck layout and stack-depth styles
- add pointer affordances and depth styling
- remove obsolete week-grid-specific calendar styles only after the new deck is
  in place

## Detailed Helper API Plan

The helpers in `src/lib/calendar.ts` should become the non-React foundation for
the new deck behavior.

Recommended additions:

```ts
type CalendarDateRange = {
  startDate: string;
  endDate: string;
};

type CalendarDayData = {
  date: string;
  workouts: WorkoutNote[];
  isToday: boolean;
};

function buildWorkoutsByDate(workouts: WorkoutNote[]): Map<string, WorkoutNote[]>;
function getWorkoutDateRange(workouts: WorkoutNote[], marginDays?: number): CalendarDateRange | null;
function clampDateToRange(date: string, range: CalendarDateRange): string;
function getAdjacentDate(date: string, direction: "backward" | "forward"): string;
function buildCalendarDay(date: string, workoutsByDate: Map<string, WorkoutNote[]>): CalendarDayData;
function buildCalendarDayBuffer(options: {
  activeDate: string;
  workoutsByDate: Map<string, WorkoutNote[]>;
  range: CalendarDateRange;
  before: number;
  after: number;
}): CalendarDayData[];
```

Recommended removals after migration:

- `DESKTOP_CALENDAR_ROW_HEIGHT`
- `MOBILE_CALENDAR_CARD_HEIGHT`
- `MOBILE_CALENDAR_CARD_GAP`
- `DESKTOP_CALENDAR_WINDOW_WEEKS`
- `MOBILE_CALENDAR_WINDOW_WEEKS`
- `CALENDAR_WINDOW_SHIFT_WEEKS`
- `chunkCalendarWeeks`
- `buildCalendarWindow`
- `shiftCalendarWindow`
- `getCalendarWindowShiftScrollOffset`
- `shouldReleaseCalendarEdgeLock`
- `freezeViewportScroll`

## Buffer Algorithm

The day deck should clamp to a bounded date range derived from the filtered
workouts with a rest-day margin.

Recommended margin:

- `14` days before the earliest filtered workout
- `14` days after the latest filtered workout

If there are no filtered workouts:

- `calendarFocusDate` should remain empty
- the deck should not render
- the existing empty state should remain visible

### Initial Build

Pseudo-logic:

```ts
const workoutsByDate = buildWorkoutsByDate(filteredWorkouts);
const range = getWorkoutDateRange(filteredWorkouts, 14);
const activeDate = clampDateToRange(requestedActiveDate, range);
const buffer = buildCalendarDayBuffer({
  activeDate,
  workoutsByDate,
  range,
  before: 3,
  after: 3,
});
```

### Next Day

Pseudo-logic:

```ts
if (transitionState !== "idle") return;
if (activeDate === range.endDate) return;

const nextDate = getAdjacentDate(activeDate, "forward");
setTransitionState("animating-forward");
setBuffer((current) => refillForward(current, nextDate, workoutsByDate, range));
onActiveDateChange(nextDate);
```

### Previous Day

Pseudo-logic:

```ts
if (transitionState !== "idle") return;
if (activeDate === range.startDate) return;

const previousDate = getAdjacentDate(activeDate, "backward");
setTransitionState("animating-backward");
setBuffer((current) => refillBackward(current, previousDate, workoutsByDate, range));
onActiveDateChange(previousDate);
```

### Jump to Date

Pseudo-logic:

```ts
const targetDate = clampDateToRange(requestedDate, range);
if (targetDate === activeDate) return;

setTransitionState("rebuilding");
setBuffer(buildCalendarDayBuffer({
  activeDate: targetDate,
  workoutsByDate,
  range,
  before: 3,
  after: 3,
}));
onActiveDateChange(targetDate);
```

## Transition State Machine

The deck should use an explicit state machine instead of ad hoc booleans.

Recommended states:

- `idle`
- `animating-forward`
- `animating-backward`
- `rebuilding`
- `dragging`
- `snap-back`

Recommended rules:

- `idle` is the only state that may accept wheel and keyboard navigation
- `dragging` suppresses wheel and swipe handling
- `animating-forward`, `animating-backward`, and `rebuilding` suppress all new
  mutations
- `snap-back` blocks new gestures until the active card visually resets

Recommended implementation shape:

```ts
type DeckTransitionState =
  | "idle"
  | "animating-forward"
  | "animating-backward"
  | "rebuilding"
  | "dragging"
  | "snap-back";
```

## Gesture Arbitration Plan

The calendar will support multiple input channels. They must not all be allowed
to drive navigation independently at the same time.

Precedence rules:

1. If the active card is being dragged, drag owns the interaction.
2. If a FLIP transition is running, all gesture sources are locked out.
3. If a snap-back animation is running, all gesture sources are locked out.
4. Wheel and swipe should funnel into the same `goToNextDay` and
   `goToPreviousDay` actions.

### Wheel Tuning

Implementation notes:

- accumulate delta using `Observer`
- require the dominant direction to exceed threshold before navigation
- clear accumulation when a transition starts or finishes

Recommended first-pass values:

- wheel threshold: `80` for mouse wheels
- trackpad threshold: derive from accumulated `deltaY`, not single event values

The exact threshold should be tuned manually after the first working pass.

### Drag Tuning

Implementation notes:

- drag the top card only
- use a vertical transform, not layout properties
- clamp the drag offset to avoid pulling the card fully off-screen before
  release
- use a release threshold plus direction sign to resolve

Recommended first-pass values:

- max drag offset: `30%` of card height
- release threshold: `22%` of card height
- snap-back duration: `160ms` to `220ms`

### Swipe Tuning

Implementation notes:

- vertical intent must exceed horizontal intent
- short accidental touches must be ignored
- swipe should resolve at release, not continuously scrub the stack

Recommended first-pass values:

- minimum swipe distance: `36px`
- vertical dominance ratio: `1.2x` horizontal distance

## Layout and Styling Plan

### Deck Container

The deck container should:

- own the available height under the calendar controls
- use `position: relative`
- prevent native scroll chaining during gestures
- expose a stable ref for `Observer`

### Card Positioning

Cards should be absolutely stacked inside the container so FLIP can animate
reordering cleanly.

Recommended positioning model:

- all visible cards occupy the same footprint
- depth is expressed with transform and opacity
- only the active card has pointer events enabled by default
- deeper cards use `pointer-events: none`

### Active Card Content

The active card should:

- allow internal vertical scrolling if its own workout list exceeds card height
- preserve horizontal workout-card scrolling only if still needed after the new
  design is applied

Recommended simplification:

- keep workout buttons vertically stacked inside the day card
- avoid nested horizontal scrolling inside a drag-driven top card if possible

That reduces pointer conflict between dragging the day card and interacting with
its children.

## Workout Selection Behavior

Clicking a workout inside the active day card should:

- call `onSelectWorkout(workout.slug)`
- preserve the current active date
- not trigger a day transition

If the selected workout belongs to the active day:

- the active day remains where it is
- the workout card gets selected styling as it does today

If a route change outside the deck opens a workout on another day:

- `src/App.tsx` already updates `calendarFocusDate`
- the day deck should respond by rebuilding around that date

## Filter Change Behavior

Filter changes are one of the easiest ways to desynchronize state if they are
not handled explicitly.

Required behavior:

1. rebuild `workoutsByDate`
2. derive a new clamped date range
3. if the current `calendarFocusDate` remains within range, keep it
4. if it falls outside range, clamp to the nearest valid date
5. rebuild the day buffer around the resolved active date
6. if there are no filtered workouts, show the existing empty state

This must happen without requiring the user to manually reselect a month or day.

## Reduced Motion Plan

`useReducedMotion` should be consulted in:

- FLIP transition setup
- drag-follow visual updates
- snap-back animation
- direct jump animation

When reduced motion is enabled:

- buffer changes happen immediately
- cards do not translate during drag
- release resolves directly to previous, next, or unchanged

The deck should still support:

- buttons
- wheel
- swipe
- keyboard

Reduced motion changes how transitions render, not what controls are available.

## Detailed Test Plan

### Unit Tests

Add or update tests for:

- `buildWorkoutsByDate`
- `getWorkoutDateRange`
- `clampDateToRange`
- `getAdjacentDate`
- `buildCalendarDay`
- `buildCalendarDayBuffer`
- buffer rebuild on direct jump
- buffer refill on next and previous transitions

### Interaction Tests

If practical with the existing test setup, add component-level tests for:

- Today button updates active date
- month picker selection updates active date
- selected workout styling persists on the active day
- empty state appears when filters remove all workouts

### Manual Verification Matrix

For desktop:

- mouse wheel one-step next and previous movement
- trackpad scroll without multi-step accidental skipping
- drag with mouse
- click workout card after a drag snap-back

For mobile:

- touch swipe next and previous
- drag on active card
- tap workout card inside active card

For shared behavior:

- filter changes while on earliest date
- filter changes while on latest date
- Today button on both rest and workout days
- direct jump from month picker to rest day
- direct jump from month picker to workout day
- opening a workout from outside the deck recenters the stack correctly
- reduced-motion mode disables animated movement

## Detailed Phase Checklist

### Phase 1 Checklist

- create `src/features/calendar/`
- move `CalendarView`
- move `CalendarControls`
- move `MonthPicker`
- keep imports and props working from `src/App.tsx`
- run `pnpm typecheck`
- run `pnpm test`

### Phase 2 Checklist

- add `buildWorkoutsByDate`
- add date range helper
- add clamp helper
- add adjacent date helper
- add day buffer helper
- replace helper tests
- remove dependence on scroll metrics in tests

### Phase 3 Checklist

- implement `CalendarDayCard`
- implement `CalendarDayDeck`
- render bounded buffer only
- preserve workout button selection styling
- wire Today and picker to active-date jump

### Phase 4 Checklist

- add `gsap` and `@gsap/react`
- add feature-local GSAP registration
- add FLIP ids to day cards
- implement forward and backward transitions
- implement direct jump rebuild transition
- add transition locking and cleanup

### Phase 5 Checklist

- add `Observer` wheel handling
- add `Observer` touch handling
- add `Draggable` active-card drag
- keep buttons clickable
- tune thresholds

### Phase 6 Checklist

- add keyboard handling
- add `useReducedMotion`
- remove old calendar grid code
- remove old scroll helpers
- remove old calendar CSS
- verify no dead imports remain

## Completion Criteria

The work is finished only when:

- no runtime calendar code depends on scroll-window shifting
- no calendar rendering path depends on desktop week grids
- desktop and mobile both use the same day-deck component
- month picker jumps directly to a target day
- wheel, swipe, and drag all work against the same active-date state machine
- reduced-motion mode avoids animated transitions
- tests and typecheck pass

## Recommended First Implementation Order Inside Coding Sessions

Within the actual coding work, use this micro-order:

1. extract current controls unchanged
2. land helper rewrite and tests
3. render a static top-card-only day deck
4. expand to bounded stacked cards
5. wire active-date transitions with plain React state
6. add FLIP
7. add wheel and swipe
8. add drag
9. add reduced motion
10. remove dead code

That sequence minimizes the surface area being debugged at one time and makes
regressions easier to isolate.
