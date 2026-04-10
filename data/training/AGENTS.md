# Training Authoring Rules

This folder is the editable training plan and workout note source used by
`measured`. Root documents live here, and individual workout notes live under `notes/`.

Standardize scheduled training events as all-day calendar notes with:

- `allDay: true`
- `type: single`
- a `date` property matching the workout date
- `completed: false` by default
- `eventType` set appropriately: `run`, `basketball`, `strength`, `mobility`, or `race`
- no `startTime` or `endTime`
- `schemaVersion: 1`
- filenames that match `YYYY-MM-DD Title.json`
- a `sections` array with canonical `program`, `analysis`, `importedFromStrava`, or `markdown` section kinds
