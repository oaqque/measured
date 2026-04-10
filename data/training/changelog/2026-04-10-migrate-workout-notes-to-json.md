---
title: Migrate Workout Notes to Canonical JSON
date: "2026-04-10"
scope: training-data
tags:
  - notes
  - schema
  - apple-health
  - strava
affectedFiles:
  - AGENTS.md
  - notes/
---

Workout notes now use canonical JSON source documents under `data/training/notes/*.json` instead of markdown frontmatter files. The new note shape preserves ordered authored sections, keeps analysis entries typed, and adds explicit slots for Apple Health measurement analysis (`heartRate`, `cadence`) and Strava measurement analysis (`pace`, `heartRate`, `moving`, `elevation`).

This change keeps the current rendered markdown narrative in the app by having the data build regenerate note bodies from the structured JSON sections. It also updates the note-link and source-diagnostics tooling so provider linking still works after the source-format migration.
