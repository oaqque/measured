# Apple Health Sync Hardening Plan

## Goal

Make bridge export and direct sync recover safely from local state loss, cache rebuilds,
staged authorization, and eventually consistent HealthKit route data.

## Hard Invariants

### Authorization

- The bridge must not enable sync/export until all required staged HealthKit read stages are complete.
- Base workout access and fully granted export access are distinct states.
- Missing later authorization stages must never be silently treated as complete export access.

### Workout Sync

- `deletedWorkoutIds` is durable sync truth and must survive app restarts and cache rebuilds.
- A full workout rebuild must not discard deletions that only exist in the stored anchor delta.
- Rebuilding `workouts.json` is a projection repair, not a reset of deletion history.

### Route Sync

- Route availability is provisional until it stabilizes.
- A successful route fetch is not automatically final.
- Route retry state must survive app restarts.
- Recent workouts should continue to be revisited even after a successful route fetch.

### Direct Sync

- Sender and receiver checkpoint sequences are monotonic.
- If the receiver checkpoint is ahead of the local sender state, the sender must rebase forward instead of regressing the receiver checkpoint.
- Losing local sender state must not require wiping the receiver.
- `_revs_diff` and checkpoint advancement must remain safe after sender-state loss.

## Recovery Rules

### Lost Sender State

- Rebase local sender sequence to at least the receiver checkpoint before allocating any new local sequence numbers.
- Rebuild local document revisions from current snapshot content.
- Use `_revs_diff` to avoid re-uploading matching receiver docs.
- Advance the receiver checkpoint only with a non-regressing sequence.

### Missing `workouts.json` With Existing Anchor

- Rebuild the current workout snapshot with `anchor=nil`.
- Replay the previously stored anchor delta immediately afterward.
- Persist deletions from the replayed delta into `deletedWorkoutIds`.
- Save the replayed delta anchor, not just the full-scan anchor.

### Route Backfill

- Persist per-workout route sync state:
  - `lastCheckedAt`
  - `lastLocationCount`
  - `stableRepeatCount`
  - `isFinal`
- Treat empty or tiny routes as provisional and retry later.
- Only finalize a route after it has stabilized and aged out of the provisional window.

## Verification Expectations

- Receiver tests must cover sender-state loss and checkpoint recovery.
- Bridge builds must continue to compile after every hardening change.
- Review findings in these four areas should be treated as invariant violations, not opportunistic bugs:
  - authorization gating
  - workout deletion preservation
  - route completeness
  - replication monotonicity
