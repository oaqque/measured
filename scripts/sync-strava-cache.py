#!/usr/bin/env python3
"""Populate a local SQLite cache of Strava run data for this repo."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib import error as urllib_error
from urllib import parse as urllib_parse
from urllib import request as urllib_request

from dotenv import load_dotenv

from strava_mcp.runtime import build_service
from strava_mcp.strava.contracts import STRAVA_SCOPE_ACTIVITY_READ

DEFAULT_ROOT = Path("vault/strava")
DEFAULT_NOTES_DIR = Path("data/training/notes")
DEFAULT_DB_NAME = "cache.sqlite3"
DEFAULT_EXPORT_NAME = "cache-export.json"
DEFAULT_PER_PAGE = 200
DETAIL_RESERVE_REQUESTS = 5
STREAM_RESERVE_REQUESTS = 12
STANDARD_STREAM_TYPES = (
    "time",
    "distance",
    "latlng",
    "altitude",
    "velocity_smooth",
    "heartrate",
    "cadence",
    "moving",
    "grade_smooth",
)
_STRAVA_API_BASE_URL = "https://www.strava.com/api/v3"
_FRONTMATTER_PATTERN = re.compile(r"(?ms)\A---\n(.*?)\n---")
_STRAVA_ID_PATTERN = re.compile(r"(?m)^stravaId:\s*['\"]?(\d+)['\"]?\s*$")


@dataclass(slots=True)
class RateWindow:
    limit: int
    usage: int

    @property
    def remaining(self) -> int:
        return max(self.limit - self.usage, 0)


@dataclass(slots=True)
class RateState:
    overall_short: RateWindow | None = None
    overall_day: RateWindow | None = None
    read_short: RateWindow | None = None
    read_day: RateWindow | None = None

    def update(self, headers: dict[str, str]) -> None:
        overall_limit = _parse_rate_pair(headers.get("x-ratelimit-limit"))
        overall_usage = _parse_rate_pair(headers.get("x-ratelimit-usage"))
        read_limit = _parse_rate_pair(headers.get("x-readratelimit-limit"))
        read_usage = _parse_rate_pair(headers.get("x-readratelimit-usage"))

        if overall_limit and overall_usage:
            self.overall_short = RateWindow(overall_limit[0], overall_usage[0])
            self.overall_day = RateWindow(overall_limit[1], overall_usage[1])
        if read_limit and read_usage:
            self.read_short = RateWindow(read_limit[0], read_usage[0])
            self.read_day = RateWindow(read_limit[1], read_usage[1])

    def can_spend(self, reserve_requests: int) -> bool:
        for window in (self.read_short, self.read_day, self.overall_short, self.overall_day):
            if window is not None and window.remaining <= reserve_requests:
                return False
        return True

    def summary(self) -> dict[str, dict[str, int] | None]:
        return {
            "overallShort": _rate_window_to_json(self.overall_short),
            "overallDay": _rate_window_to_json(self.overall_day),
            "readShort": _rate_window_to_json(self.read_short),
            "readDay": _rate_window_to_json(self.read_day),
        }


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    parser = build_parser()
    args = parser.parse_args(argv)

    root = args.root.expanduser()
    db_path = (root / DEFAULT_DB_NAME) if args.db is None else args.db.expanduser()
    export_path = (root / DEFAULT_EXPORT_NAME) if args.export is None else args.export.expanduser()
    notes_dir = args.notes_dir.expanduser()

    root.mkdir(parents=True, exist_ok=True)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    service = build_service(root)
    session = service._ensure_session(required_scopes=(STRAVA_SCOPE_ACTIVITY_READ,))  # type: ignore[attr-defined]
    athlete_id = session.athlete_id
    if athlete_id is None:
        athlete = service.get_athlete()
        athlete_id = athlete.id
    if athlete_id is None:
        raise SystemExit("Unable to resolve athlete ID from the current Strava session.")

    rate_state = RateState()
    sync_started_at = iso_now()

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        initialize_schema(connection)
        sync_run_id = insert_sync_run(connection, mode="sync", started_at=sync_started_at)

        activities = sync_run_activities(
            connection=connection,
            access_token=session.token.access_token,
            athlete_id=athlete_id,
            rate_state=rate_state,
        )
        note_links = scan_note_links(notes_dir)
        refresh_note_links(connection, note_links)

        detail_requests = hydrate_missing_details(
            connection=connection,
            access_token=session.token.access_token,
            athlete_id=athlete_id,
            rate_state=rate_state,
        )
        stream_requests = 0
        if args.with_streams:
            stream_requests = hydrate_missing_streams(
                connection=connection,
                access_token=session.token.access_token,
                athlete_id=athlete_id,
                rate_state=rate_state,
            )

        write_export(connection, export_path)
        store_rate_state(connection, rate_state)
        complete_sync_run(
            connection,
            sync_run_id=sync_run_id,
            finished_at=iso_now(),
            status="completed",
            request_count=activities.request_count + detail_requests + stream_requests,
            error_text=None,
        )

    print(
        json.dumps(
            {
                "database": str(db_path),
                "export": str(export_path),
                "runsSeen": activities.run_count,
                "listRequests": activities.request_count,
                "detailRequests": detail_requests,
                "streamRequests": stream_requests,
                "rateLimits": rate_state.summary(),
            },
            indent=2,
        )
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sync-strava-cache",
        description="Cache Strava run data into a repo-local SQLite database.",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_ROOT,
        help=f"Directory that stores Strava auth and cache state (default: {DEFAULT_ROOT}).",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=None,
        help="Optional explicit SQLite database path. Defaults to <root>/cache.sqlite3.",
    )
    parser.add_argument(
        "--export",
        type=Path,
        default=None,
        help="Optional explicit export JSON path. Defaults to <root>/cache-export.json.",
    )
    parser.add_argument(
        "--notes-dir",
        type=Path,
        default=DEFAULT_NOTES_DIR,
        help=f"Workout notes directory for note linkage scanning (default: {DEFAULT_NOTES_DIR}).",
    )
    parser.add_argument(
        "--with-streams",
        action="store_true",
        help="Also hydrate activity stream payloads for runs that do not already have them cached.",
    )
    return parser


def initialize_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS activities (
          activity_id INTEGER PRIMARY KEY,
          athlete_id INTEGER NOT NULL,
          sport_type TEXT,
          name TEXT,
          start_date TEXT,
          start_date_local TEXT,
          timezone TEXT,
          distance_m REAL,
          moving_time_s INTEGER,
          elapsed_time_s INTEGER,
          total_elevation_gain_m REAL,
          average_speed_mps REAL,
          max_speed_mps REAL,
          average_heartrate REAL,
          max_heartrate REAL,
          summary_polyline TEXT,
          start_lat REAL,
          start_lng REAL,
          end_lat REAL,
          end_lng REAL,
          summary_json TEXT NOT NULL,
          detail_json TEXT,
          summary_fetched_at TEXT NOT NULL,
          detail_fetched_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS activity_streams (
          activity_id INTEGER NOT NULL,
          stream_set TEXT NOT NULL,
          stream_json TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          PRIMARY KEY (activity_id, stream_set),
          FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS note_links (
          note_path TEXT PRIMARY KEY,
          note_slug TEXT NOT NULL,
          activity_id INTEGER NOT NULL,
          linked_at TEXT NOT NULL,
          match_source TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          mode TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'running',
          started_at TEXT NOT NULL,
          finished_at TEXT,
          request_count INTEGER NOT NULL DEFAULT 0,
          error_text TEXT
        );

        CREATE TABLE IF NOT EXISTS rate_limit_state (
          key TEXT PRIMARY KEY,
          payload_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        """
    )


def insert_sync_run(
    connection: sqlite3.Connection, *, mode: str, started_at: str
) -> int:
    cursor = connection.execute(
        """
        INSERT INTO sync_runs (mode, status, started_at)
        VALUES (?, 'running', ?)
        """,
        (mode, started_at),
    )
    connection.commit()
    return int(cursor.lastrowid)


def complete_sync_run(
    connection: sqlite3.Connection,
    *,
    sync_run_id: int,
    finished_at: str,
    status: str,
    request_count: int,
    error_text: str | None,
) -> None:
    connection.execute(
        """
        UPDATE sync_runs
        SET status = ?, finished_at = ?, request_count = ?, error_text = ?
        WHERE id = ?
        """,
        (status, finished_at, request_count, error_text, sync_run_id),
    )
    connection.commit()


def store_rate_state(connection: sqlite3.Connection, rate_state: RateState) -> None:
    payload = json.dumps(rate_state.summary(), sort_keys=True)
    connection.execute(
        """
        INSERT INTO rate_limit_state (key, payload_json, updated_at)
        VALUES ('latest', ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
        """,
        (payload, iso_now()),
    )
    connection.commit()


@dataclass(slots=True)
class ActivitySyncResult:
    run_count: int
    request_count: int


def sync_run_activities(
    *,
    connection: sqlite3.Connection,
    access_token: str,
    athlete_id: int,
    rate_state: RateState,
) -> ActivitySyncResult:
    page = 1
    request_count = 0
    run_count = 0

    while True:
        payload, headers = api_get_json(
            path="/athlete/activities",
            access_token=access_token,
            query={"page": page, "per_page": DEFAULT_PER_PAGE},
        )
        rate_state.update(headers)
        request_count += 1
        if not isinstance(payload, list):
            raise RuntimeError("Strava activity list response was not a JSON array.")
        if not payload:
            break

        for item in payload:
            if not isinstance(item, dict):
                continue
            sport_type = str(item.get("sport_type") or item.get("type") or "").strip()
            if sport_type.lower() != "run":
                continue
            run_count += 1
            upsert_activity_summary(connection, athlete_id=athlete_id, summary=item)

        connection.commit()
        page += 1

    return ActivitySyncResult(run_count=run_count, request_count=request_count)


def hydrate_missing_details(
    *,
    connection: sqlite3.Connection,
    access_token: str,
    athlete_id: int,
    rate_state: RateState,
) -> int:
    rows = connection.execute(
        """
        SELECT activity_id
        FROM activities
        WHERE athlete_id = ? AND detail_json IS NULL
        ORDER BY start_date DESC, activity_id DESC
        """,
        (athlete_id,),
    ).fetchall()

    request_count = 0
    for row in rows:
        if not rate_state.can_spend(DETAIL_RESERVE_REQUESTS):
            break
        activity_id = int(row["activity_id"])
        payload, headers = api_get_json(
            path=f"/activities/{activity_id}",
            access_token=access_token,
        )
        rate_state.update(headers)
        request_count += 1
        if not isinstance(payload, dict):
            continue
        upsert_activity_detail(connection, athlete_id=athlete_id, detail=payload)
        connection.commit()

    return request_count


def hydrate_missing_streams(
    *,
    connection: sqlite3.Connection,
    access_token: str,
    athlete_id: int,
    rate_state: RateState,
) -> int:
    rows = connection.execute(
        """
        SELECT activity_id
        FROM activities
        WHERE athlete_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM activity_streams
            WHERE activity_streams.activity_id = activities.activity_id
              AND stream_set = ?
          )
        ORDER BY start_date DESC, activity_id DESC
        """,
        (athlete_id, ",".join(STANDARD_STREAM_TYPES)),
    ).fetchall()

    request_count = 0
    for row in rows:
        if not rate_state.can_spend(STREAM_RESERVE_REQUESTS):
            break
        activity_id = int(row["activity_id"])
        payload, headers = api_get_json(
            path=f"/activities/{activity_id}/streams",
            access_token=access_token,
            query={
                "keys": ",".join(STANDARD_STREAM_TYPES),
                "key_by_type": "true",
                "resolution": "medium",
                "series_type": "time",
            },
        )
        rate_state.update(headers)
        request_count += 1
        if not isinstance(payload, dict):
            continue
        connection.execute(
            """
            INSERT INTO activity_streams (activity_id, stream_set, stream_json, fetched_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(activity_id, stream_set) DO UPDATE SET
              stream_json = excluded.stream_json,
              fetched_at = excluded.fetched_at
            """,
            (
                activity_id,
                ",".join(STANDARD_STREAM_TYPES),
                json.dumps(payload, sort_keys=True),
                iso_now(),
            ),
        )
        connection.commit()

    return request_count


def upsert_activity_summary(
    connection: sqlite3.Connection, *, athlete_id: int, summary: dict[str, Any]
) -> None:
    activity_id = _require_activity_id(summary)
    map_payload = summary.get("map") if isinstance(summary.get("map"), dict) else {}
    start_lat, start_lng = _extract_latlng(summary.get("start_latlng"))
    end_lat, end_lng = _extract_latlng(summary.get("end_latlng"))
    now = iso_now()
    connection.execute(
        """
        INSERT INTO activities (
          activity_id,
          athlete_id,
          sport_type,
          name,
          start_date,
          start_date_local,
          timezone,
          distance_m,
          moving_time_s,
          elapsed_time_s,
          total_elevation_gain_m,
          average_speed_mps,
          max_speed_mps,
          average_heartrate,
          max_heartrate,
          summary_polyline,
          start_lat,
          start_lng,
          end_lat,
          end_lng,
          summary_json,
          summary_fetched_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(activity_id) DO UPDATE SET
          athlete_id = excluded.athlete_id,
          sport_type = excluded.sport_type,
          name = excluded.name,
          start_date = excluded.start_date,
          start_date_local = excluded.start_date_local,
          timezone = excluded.timezone,
          distance_m = excluded.distance_m,
          moving_time_s = excluded.moving_time_s,
          elapsed_time_s = excluded.elapsed_time_s,
          total_elevation_gain_m = excluded.total_elevation_gain_m,
          average_speed_mps = excluded.average_speed_mps,
          max_speed_mps = excluded.max_speed_mps,
          average_heartrate = excluded.average_heartrate,
          max_heartrate = excluded.max_heartrate,
          summary_polyline = excluded.summary_polyline,
          start_lat = excluded.start_lat,
          start_lng = excluded.start_lng,
          end_lat = excluded.end_lat,
          end_lng = excluded.end_lng,
          summary_json = excluded.summary_json,
          summary_fetched_at = excluded.summary_fetched_at,
          updated_at = excluded.updated_at
        """,
        (
            activity_id,
            athlete_id,
            _as_optional_text(summary.get("sport_type") or summary.get("type")),
            _as_optional_text(summary.get("name")),
            _as_optional_text(summary.get("start_date")),
            _as_optional_text(summary.get("start_date_local")),
            _as_optional_text(summary.get("timezone")),
            _as_optional_float(summary.get("distance")),
            _as_optional_int(summary.get("moving_time")),
            _as_optional_int(summary.get("elapsed_time")),
            _as_optional_float(summary.get("total_elevation_gain")),
            _as_optional_float(summary.get("average_speed")),
            _as_optional_float(summary.get("max_speed")),
            _as_optional_float(summary.get("average_heartrate")),
            _as_optional_float(summary.get("max_heartrate")),
            _as_optional_text(map_payload.get("summary_polyline")),
            start_lat,
            start_lng,
            end_lat,
            end_lng,
            json.dumps(summary, sort_keys=True),
            now,
            now,
        ),
    )


def upsert_activity_detail(
    connection: sqlite3.Connection, *, athlete_id: int, detail: dict[str, Any]
) -> None:
    activity_id = _require_activity_id(detail)
    upsert_activity_summary(connection, athlete_id=athlete_id, summary=detail)
    connection.execute(
        """
        UPDATE activities
        SET detail_json = ?, detail_fetched_at = ?, updated_at = ?
        WHERE activity_id = ?
        """,
        (json.dumps(detail, sort_keys=True), iso_now(), iso_now(), activity_id),
    )


def scan_note_links(notes_dir: Path) -> list[tuple[str, str, int, str, str]]:
    if not notes_dir.is_dir():
        return []

    linked_at = iso_now()
    rows: list[tuple[str, str, int, str, str]] = []
    for file_path in sorted(notes_dir.glob("*.md")):
        content = file_path.read_text(encoding="utf-8")
        frontmatter_match = _FRONTMATTER_PATTERN.search(content)
        if not frontmatter_match:
            continue
        activity_match = _STRAVA_ID_PATTERN.search(frontmatter_match.group(1))
        if not activity_match:
            continue
        rows.append(
            (
                file_path.as_posix(),
                slugify(file_path.stem),
                int(activity_match.group(1)),
                linked_at,
                "frontmatter",
            )
        )
    return rows


def refresh_note_links(
    connection: sqlite3.Connection, rows: list[tuple[str, str, int, str, str]]
) -> None:
    connection.execute("DELETE FROM note_links")
    connection.executemany(
        """
        INSERT INTO note_links (note_path, note_slug, activity_id, linked_at, match_source)
        VALUES (?, ?, ?, ?, ?)
        """,
        rows,
    )
    connection.commit()


def write_export(connection: sqlite3.Connection, export_path: Path) -> None:
    export_path.parent.mkdir(parents=True, exist_ok=True)
    rows = connection.execute(
        """
        SELECT
          activities.activity_id,
          activities.name,
          activities.sport_type,
          activities.start_date,
          activities.distance_m,
          activities.moving_time_s,
          activities.elapsed_time_s,
          activities.total_elevation_gain_m,
          activities.average_heartrate,
          activities.max_heartrate,
          activities.summary_polyline,
          activities.detail_fetched_at,
          EXISTS(
            SELECT 1
            FROM activity_streams
            WHERE activity_streams.activity_id = activities.activity_id
          ) AS has_streams
        FROM activities
        ORDER BY activities.start_date DESC, activities.activity_id DESC
        """
    ).fetchall()

    payload = {
        "generatedAt": iso_now(),
        "activities": {
            str(int(row["activity_id"])): {
                "activityId": int(row["activity_id"]),
                "name": row["name"],
                "sportType": row["sport_type"],
                "startDate": row["start_date"],
                "distanceMeters": row["distance_m"],
                "distanceKm": _meters_to_km(row["distance_m"]),
                "movingTimeSeconds": row["moving_time_s"],
                "elapsedTimeSeconds": row["elapsed_time_s"],
                "totalElevationGainMeters": row["total_elevation_gain_m"],
                "averageHeartrate": row["average_heartrate"],
                "maxHeartrate": row["max_heartrate"],
                "summaryPolyline": row["summary_polyline"],
                "detailFetchedAt": row["detail_fetched_at"],
                "hasStreams": bool(row["has_streams"]),
            }
            for row in rows
        },
    }
    export_path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf-8")


def api_get_json(
    *, path: str, access_token: str, query: dict[str, Any] | None = None
) -> tuple[dict[str, Any] | list[Any], dict[str, str]]:
    encoded_query = urllib_parse.urlencode(
        {key: value for key, value in (query or {}).items() if value is not None}
    )
    url = f"{_STRAVA_API_BASE_URL}{path}"
    if encoded_query:
        url = f"{url}?{encoded_query}"
    request = urllib_request.Request(
        url,
        headers={
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib_request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
            headers = {key.lower(): value for key, value in response.headers.items()}
    except urllib_error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Strava API request failed ({exc.code}) for {url}: {body}") from exc
    except urllib_error.URLError as exc:
        raise RuntimeError(f"Unable to reach Strava API for {url}: {exc.reason}") from exc
    if not isinstance(payload, (dict, list)):
        raise RuntimeError(f"Strava API response for {url} was not a JSON object or array.")
    return payload, headers


def iso_now() -> str:
    return datetime.now(UTC).isoformat()


def slugify(value: str) -> str:
    return re.sub(r"(^-+|-+$)", "", re.sub(r"[^a-z0-9]+", "-", value.lower()))


def _require_activity_id(payload: dict[str, Any]) -> int:
    raw = payload.get("id")
    if not isinstance(raw, int):
        raise RuntimeError("Strava activity payload missing integer id.")
    return raw


def _extract_latlng(value: Any) -> tuple[float | None, float | None]:
    if isinstance(value, list) and len(value) == 2:
        return _as_optional_float(value[0]), _as_optional_float(value[1])
    return None, None


def _parse_rate_pair(raw: str | None) -> tuple[int, int] | None:
    if raw is None:
        return None
    parts = [item.strip() for item in raw.split(",")]
    if len(parts) != 2:
        return None
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return None


def _rate_window_to_json(window: RateWindow | None) -> dict[str, int] | None:
    if window is None:
        return None
    return {"limit": window.limit, "usage": window.usage, "remaining": window.remaining}


def _as_optional_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text if text else None


def _as_optional_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value))
    except ValueError:
        return None


def _as_optional_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    try:
        return int(str(value))
    except ValueError:
        return None


def _meters_to_km(value: Any) -> float | None:
    meters = _as_optional_float(value)
    if meters is None:
        return None
    return round(meters / 1000.0, 3)


if __name__ == "__main__":
    raise SystemExit(main())
