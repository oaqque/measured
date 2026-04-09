#!/usr/bin/env python3
"""Populate a local SQLite cache of Strava run data for this repo."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
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
DEFAULT_IMAGE_CACHE_DIR_NAME = "cache-images"
DEFAULT_PER_PAGE = 200
DETAIL_RESERVE_REQUESTS = 5
STREAM_RESERVE_REQUESTS = 12
OPEN_METEO_PROVIDER = "open-meteo"
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_HOURLY_FIELDS = (
    "temperature_2m",
    "apparent_temperature",
    "relative_humidity_2m",
    "precipitation",
    "wind_speed_10m",
    "wind_gusts_10m",
    "weather_code",
)
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


class StravaRateLimitExceededError(RuntimeError):
    """Raised when Strava returns HTTP 429."""


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


@dataclass(slots=True)
class ActivityImageRef:
    source_url: str
    unique_id: str | None


def main(argv: list[str] | None = None) -> int:
    load_dotenv()
    parser = build_parser()
    args = parser.parse_args(argv)

    root = args.root.expanduser()
    db_path = (root / DEFAULT_DB_NAME) if args.db is None else args.db.expanduser()
    export_path = (root / DEFAULT_EXPORT_NAME) if args.export is None else args.export.expanduser()
    image_cache_dir = root / DEFAULT_IMAGE_CACHE_DIR_NAME
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
        image_requests = hydrate_missing_images(connection=connection)
        stream_requests = 0
        if args.with_streams:
            stream_requests = hydrate_missing_streams(
                connection=connection,
                access_token=session.token.access_token,
                athlete_id=athlete_id,
                rate_state=rate_state,
            )
        weather_requests = hydrate_missing_weather(connection=connection)

        write_export(connection, export_path, image_cache_dir=image_cache_dir)
        store_rate_state(connection, rate_state)
        complete_sync_run(
            connection,
            sync_run_id=sync_run_id,
            finished_at=iso_now(),
            status="completed",
            request_count=activities.request_count
            + detail_requests
            + image_requests
            + stream_requests
            + weather_requests,
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
                "imageDownloads": image_requests,
                "streamRequests": stream_requests,
                "weatherRequests": weather_requests,
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

        CREATE TABLE IF NOT EXISTS activity_images (
          activity_id INTEGER PRIMARY KEY,
          unique_id TEXT,
          source_url TEXT NOT NULL,
          content_type TEXT,
          image_bytes BLOB NOT NULL,
          fetched_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (activity_id) REFERENCES activities(activity_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS activity_weather (
          activity_id INTEGER PRIMARY KEY,
          provider TEXT NOT NULL,
          lookup_lat REAL NOT NULL,
          lookup_lng REAL NOT NULL,
          lookup_timezone TEXT NOT NULL,
          lookup_start_local TEXT NOT NULL,
          lookup_end_local TEXT NOT NULL,
          weather_json TEXT NOT NULL,
          summary_json TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
        try:
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
        except StravaRateLimitExceededError:
            break
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


def hydrate_missing_images(*, connection: sqlite3.Connection) -> int:
    rows = connection.execute(
        """
        SELECT activity_id, detail_json
        FROM activities
        WHERE detail_json IS NOT NULL
        ORDER BY start_date DESC, activity_id DESC
        """
    ).fetchall()
    existing_rows = connection.execute(
        """
        SELECT activity_id, unique_id, source_url
        FROM activity_images
        """
    ).fetchall()
    existing_images = {
        int(row["activity_id"]): (
            _as_optional_text(row["source_url"]),
            _as_optional_text(row["unique_id"]),
        )
        for row in existing_rows
    }

    request_count = 0
    for row in rows:
        activity_id = int(row["activity_id"])
        detail_json = row["detail_json"]
        if not isinstance(detail_json, str) or detail_json.strip() == "":
            continue

        try:
            detail = json.loads(detail_json)
        except json.JSONDecodeError:
            continue
        if not isinstance(detail, dict):
            continue

        image_ref = extract_primary_image_ref(detail)
        if image_ref is None:
            if activity_id in existing_images:
                connection.execute(
                    "DELETE FROM activity_images WHERE activity_id = ?",
                    (activity_id,),
                )
                connection.commit()
            continue

        existing_image = existing_images.get(activity_id)
        if existing_image == (image_ref.source_url, image_ref.unique_id):
            continue

        image_bytes, content_type = download_image_bytes(image_ref.source_url)
        upsert_activity_image(
            connection,
            activity_id=activity_id,
            unique_id=image_ref.unique_id,
            source_url=image_ref.source_url,
            content_type=content_type,
            image_bytes=image_bytes,
        )
        existing_images[activity_id] = (image_ref.source_url, image_ref.unique_id)
        request_count += 1
        connection.commit()

    return request_count


def hydrate_missing_weather(*, connection: sqlite3.Connection) -> int:
    rows = connection.execute(
        """
        SELECT
          activities.activity_id,
          activities.start_date_local,
          activities.timezone,
          activities.start_lat,
          activities.start_lng,
          COALESCE(activities.elapsed_time_s, activities.moving_time_s, 0) AS duration_s
        FROM activities
        LEFT JOIN activity_weather ON activity_weather.activity_id = activities.activity_id
        WHERE activity_weather.activity_id IS NULL
          AND activities.start_date_local IS NOT NULL
          AND activities.start_lat IS NOT NULL
          AND activities.start_lng IS NOT NULL
        ORDER BY activities.start_date DESC, activities.activity_id DESC
        """
    ).fetchall()

    request_count = 0
    for row in rows:
        activity_id = int(row["activity_id"])
        start_date_local = _as_optional_text(row["start_date_local"])
        timezone_name = _extract_timezone_name(_as_optional_text(row["timezone"])) or "auto"
        lookup_lat = _as_optional_float(row["start_lat"])
        lookup_lng = _as_optional_float(row["start_lng"])
        duration_s = max(_as_optional_int(row["duration_s"]) or 0, 0)
        local_start = _parse_local_datetime(start_date_local)
        if local_start is None or lookup_lat is None or lookup_lng is None:
            continue

        local_end = local_start + timedelta(seconds=duration_s)
        try:
            weather_payload = fetch_open_meteo_archive(
                latitude=lookup_lat,
                longitude=lookup_lng,
                start_date=local_start.date().isoformat(),
                end_date=local_end.date().isoformat(),
                timezone_name=timezone_name,
            )
            summary = summarize_open_meteo_weather(
                weather_payload=weather_payload,
                local_start=local_start,
                local_end=local_end,
            )
        except RuntimeError as exc:
            print(f"Warning: unable to hydrate weather for activity {activity_id}: {exc}")
            continue

        if summary is None:
            continue

        upsert_activity_weather(
            connection,
            activity_id=activity_id,
            provider=OPEN_METEO_PROVIDER,
            lookup_lat=lookup_lat,
            lookup_lng=lookup_lng,
            lookup_timezone=timezone_name,
            lookup_start_local=local_start.isoformat(timespec="seconds"),
            lookup_end_local=local_end.isoformat(timespec="seconds"),
            weather_payload=weather_payload,
            summary=summary,
        )
        request_count += 1
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


def upsert_activity_image(
    connection: sqlite3.Connection,
    *,
    activity_id: int,
    unique_id: str | None,
    source_url: str,
    content_type: str | None,
    image_bytes: bytes,
) -> None:
    now = iso_now()
    connection.execute(
        """
        INSERT INTO activity_images (
          activity_id,
          unique_id,
          source_url,
          content_type,
          image_bytes,
          fetched_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(activity_id) DO UPDATE SET
          unique_id = excluded.unique_id,
          source_url = excluded.source_url,
          content_type = excluded.content_type,
          image_bytes = excluded.image_bytes,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
        """,
        (activity_id, unique_id, source_url, content_type, image_bytes, now, now),
    )


def upsert_activity_weather(
    connection: sqlite3.Connection,
    *,
    activity_id: int,
    provider: str,
    lookup_lat: float,
    lookup_lng: float,
    lookup_timezone: str,
    lookup_start_local: str,
    lookup_end_local: str,
    weather_payload: dict[str, Any],
    summary: dict[str, Any],
) -> None:
    now = iso_now()
    connection.execute(
        """
        INSERT INTO activity_weather (
          activity_id,
          provider,
          lookup_lat,
          lookup_lng,
          lookup_timezone,
          lookup_start_local,
          lookup_end_local,
          weather_json,
          summary_json,
          fetched_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(activity_id) DO UPDATE SET
          provider = excluded.provider,
          lookup_lat = excluded.lookup_lat,
          lookup_lng = excluded.lookup_lng,
          lookup_timezone = excluded.lookup_timezone,
          lookup_start_local = excluded.lookup_start_local,
          lookup_end_local = excluded.lookup_end_local,
          weather_json = excluded.weather_json,
          summary_json = excluded.summary_json,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
        """,
        (
            activity_id,
            provider,
            lookup_lat,
            lookup_lng,
            lookup_timezone,
            lookup_start_local,
            lookup_end_local,
            json.dumps(weather_payload, sort_keys=True),
            json.dumps(summary, sort_keys=True),
            now,
            now,
        ),
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
        activity_id = extract_frontmatter_strava_id(frontmatter_match.group(1))
        if activity_id is None:
            continue
        rows.append(
            (
                file_path.as_posix(),
                slugify(file_path.stem),
                activity_id,
                linked_at,
                "frontmatter",
            )
        )
    return rows


def extract_frontmatter_strava_id(frontmatter: str) -> int | None:
    legacy_match = _STRAVA_ID_PATTERN.search(frontmatter)
    if legacy_match:
        return int(legacy_match.group(1))

    in_activity_refs = False
    activity_refs_indent = 0

    for raw_line in frontmatter.splitlines():
        line = raw_line.rstrip()
        stripped = line.lstrip()
        indent = len(line) - len(stripped)

        if not stripped:
            continue

        if not in_activity_refs:
            if stripped == "activityRefs:":
                in_activity_refs = True
                activity_refs_indent = indent
            continue

        if indent <= activity_refs_indent:
            in_activity_refs = False
            if stripped == "activityRefs:":
                in_activity_refs = True
                activity_refs_indent = indent
            continue

        match = re.match(r"strava:\s*['\"]?(\d+)['\"]?\s*$", stripped)
        if match:
            return int(match.group(1))

    return None


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


def write_export(
    connection: sqlite3.Connection, export_path: Path, *, image_cache_dir: Path
) -> None:
    export_path.parent.mkdir(parents=True, exist_ok=True)
    image_assets = write_exportable_images(connection, image_cache_dir)
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
          activity_weather.summary_json AS weather_summary_json,
          EXISTS(
            SELECT 1
            FROM activity_streams
            WHERE activity_streams.activity_id = activities.activity_id
          ) AS has_streams
        FROM activities
        LEFT JOIN activity_weather ON activity_weather.activity_id = activities.activity_id
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
                "primaryImageFileName": image_assets.get(int(row["activity_id"]), {}).get("fileName"),
                "detailFetchedAt": row["detail_fetched_at"],
                "weather": load_exportable_weather(row["weather_summary_json"]),
                "hasStreams": bool(row["has_streams"]),
                "routeStreams": load_exportable_streams(
                    connection=connection, activity_id=int(row["activity_id"])
                ),
            }
            for row in rows
        },
    }
    export_path.write_text(f"{json.dumps(payload, indent=2, sort_keys=True)}\n", encoding="utf-8")


def write_exportable_images(
    connection: sqlite3.Connection, image_cache_dir: Path
) -> dict[int, dict[str, str]]:
    rows = connection.execute(
        """
        SELECT activity_id, content_type, source_url, image_bytes
        FROM activity_images
        ORDER BY activity_id ASC
        """
    ).fetchall()

    shutil.rmtree(image_cache_dir, ignore_errors=True)
    if not rows:
        return {}

    image_cache_dir.mkdir(parents=True, exist_ok=True)
    assets: dict[int, dict[str, str]] = {}
    for row in rows:
        image_bytes = row["image_bytes"]
        if not isinstance(image_bytes, bytes) or len(image_bytes) == 0:
            continue

        activity_id = int(row["activity_id"])
        suffix = infer_image_suffix(
            _as_optional_text(row["content_type"]),
            _as_optional_text(row["source_url"]),
        )
        file_name = f"{activity_id}{suffix}"
        file_path = image_cache_dir / file_name
        file_path.write_bytes(image_bytes)
        assets[activity_id] = {"fileName": file_name}

    return assets


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
        if exc.code == 429:
            raise StravaRateLimitExceededError(
                f"Strava API request failed ({exc.code}) for {url}: {body}"
            ) from exc
        raise RuntimeError(f"Strava API request failed ({exc.code}) for {url}: {body}") from exc
    except urllib_error.URLError as exc:
        raise RuntimeError(f"Unable to reach Strava API for {url}: {exc.reason}") from exc
    if not isinstance(payload, (dict, list)):
        raise RuntimeError(f"Strava API response for {url} was not a JSON object or array.")
    return payload, headers


def load_exportable_streams(
    *, connection: sqlite3.Connection, activity_id: int
) -> dict[str, Any] | None:
    row = connection.execute(
        """
        SELECT stream_json
        FROM activity_streams
        WHERE activity_id = ?
        ORDER BY fetched_at DESC
        LIMIT 1
        """,
        (activity_id,),
    ).fetchone()
    if row is None:
        return None

    try:
        payload = json.loads(row["stream_json"])
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    return {
        "latlng": _stream_data(payload.get("latlng")),
        "altitude": _stream_data(payload.get("altitude")),
        "distance": _stream_data(payload.get("distance")),
        "heartrate": _stream_data(payload.get("heartrate")),
        "velocitySmooth": _stream_data(payload.get("velocity_smooth")),
        "moving": _stream_data(payload.get("moving")),
    }


def load_exportable_weather(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, str) or value.strip() == "":
        return None

    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return None

    return payload if isinstance(payload, dict) else None


def extract_primary_image_ref(detail: dict[str, Any]) -> ActivityImageRef | None:
    photos = detail.get("photos")
    if not isinstance(photos, dict):
        return None

    primary = photos.get("primary")
    if not isinstance(primary, dict):
        return None

    urls = primary.get("urls")
    if not isinstance(urls, dict):
        return None

    candidates: list[tuple[int, str]] = []
    for key, value in urls.items():
        if not isinstance(value, str) or value.strip() == "":
            continue
        try:
            rank = int(str(key))
        except ValueError:
            rank = 0
        candidates.append((rank, value.strip()))

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0], reverse=True)
    return ActivityImageRef(
        source_url=candidates[0][1],
        unique_id=_as_optional_text(primary.get("unique_id")),
    )


def download_image_bytes(url: str) -> tuple[bytes, str | None]:
    request = urllib_request.Request(url, headers={"Accept": "image/*"}, method="GET")
    try:
        with urllib_request.urlopen(request, timeout=30) as response:
            payload = response.read()
            content_type = response.headers.get_content_type()
    except urllib_error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Image download failed ({exc.code}) for {url}: {body}") from exc
    except urllib_error.URLError as exc:
        raise RuntimeError(f"Unable to reach image URL {url}: {exc.reason}") from exc

    if not payload:
        raise RuntimeError(f"Image download returned no bytes for {url}")

    return payload, content_type if content_type != "application/octet-stream" else None


def fetch_open_meteo_archive(
    *,
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
    timezone_name: str,
) -> dict[str, Any]:
    encoded_query = urllib_parse.urlencode(
        {
            "latitude": latitude,
            "longitude": longitude,
            "start_date": start_date,
            "end_date": end_date,
            "timezone": timezone_name,
            "hourly": ",".join(OPEN_METEO_HOURLY_FIELDS),
            "wind_speed_unit": "kmh",
            "temperature_unit": "celsius",
            "precipitation_unit": "mm",
        }
    )
    url = f"{OPEN_METEO_ARCHIVE_URL}?{encoded_query}"
    request = urllib_request.Request(
        url,
        headers={"Accept": "application/json"},
        method="GET",
    )
    try:
        with urllib_request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
    except urllib_error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Open-Meteo request failed ({exc.code}) for {url}: {body}"
        ) from exc
    except urllib_error.URLError as exc:
        raise RuntimeError(f"Unable to reach Open-Meteo for {url}: {exc.reason}") from exc

    if not isinstance(payload, dict):
        raise RuntimeError(f"Open-Meteo response for {url} was not a JSON object.")
    if payload.get("error") is True:
        raise RuntimeError(f"Open-Meteo request failed for {url}: {payload.get('reason')}")
    return payload


def summarize_open_meteo_weather(
    *, weather_payload: dict[str, Any], local_start: datetime, local_end: datetime
) -> dict[str, Any] | None:
    hourly = weather_payload.get("hourly")
    if not isinstance(hourly, dict):
        return None

    times = _parse_hourly_timestamps(hourly.get("time"))
    if not times:
        return None

    start_index = _nearest_time_index(times, local_start)
    end_index = _nearest_time_index(times, local_end)
    if start_index is None or end_index is None:
        return None

    window_indices = _hourly_window_indices(times, local_start, local_end)
    if not window_indices:
        window_indices = [start_index]

    temperature = _coerce_numeric_list(hourly.get("temperature_2m"))
    apparent_temperature = _coerce_numeric_list(hourly.get("apparent_temperature"))
    humidity = _coerce_numeric_list(hourly.get("relative_humidity_2m"))
    precipitation = _coerce_numeric_list(hourly.get("precipitation"))
    wind_speed = _coerce_numeric_list(hourly.get("wind_speed_10m"))
    wind_gusts = _coerce_numeric_list(hourly.get("wind_gusts_10m"))
    weather_code = _coerce_integer_list(hourly.get("weather_code"))
    selected_code = _select_weather_code(weather_code, window_indices)

    return {
        "provider": OPEN_METEO_PROVIDER,
        "lookedUpAt": iso_now(),
        "startTemperatureC": _round_weather_value(_value_at_index(temperature, start_index)),
        "endTemperatureC": _round_weather_value(_value_at_index(temperature, end_index)),
        "averageTemperatureC": _round_weather_value(_mean_for_indices(temperature, window_indices)),
        "apparentTemperatureC": _round_weather_value(
            _mean_for_indices(apparent_temperature, window_indices)
        ),
        "humidityPercent": _round_weather_value(_mean_for_indices(humidity, window_indices)),
        "precipitationMm": _round_weather_value(_sum_for_indices(precipitation, window_indices)),
        "windSpeedKph": _round_weather_value(_mean_for_indices(wind_speed, window_indices)),
        "windGustKph": _round_weather_value(_max_for_indices(wind_gusts, window_indices)),
        "weatherCode": selected_code,
        "summary": _weather_code_label(selected_code),
    }


def infer_image_suffix(content_type: str | None, source_url: str | None) -> str:
    normalized_content_type = (content_type or "").strip().lower()
    if normalized_content_type == "image/jpeg":
        return ".jpg"
    if normalized_content_type == "image/png":
        return ".png"
    if normalized_content_type == "image/webp":
        return ".webp"
    if normalized_content_type == "image/gif":
        return ".gif"

    parsed_url = urllib_parse.urlparse(source_url or "")
    suffix = Path(parsed_url.path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return ".jpg" if suffix == ".jpeg" else suffix

    return ".img"


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


def _stream_data(value: Any) -> list[Any] | None:
    if not isinstance(value, dict):
        return None
    data = value.get("data")
    return data if isinstance(data, list) else None


def _meters_to_km(value: Any) -> float | None:
    meters = _as_optional_float(value)
    if meters is None:
        return None
    return round(meters / 1000.0, 3)


def _extract_timezone_name(value: str | None) -> str | None:
    if value is None:
        return None
    match = re.search(r"\)\s*(.+)$", value)
    if match is not None:
        timezone_name = match.group(1).strip()
        return timezone_name or None
    return value.strip() or None


def _parse_local_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _parse_hourly_timestamps(value: Any) -> list[datetime]:
    if not isinstance(value, list):
        return []
    timestamps: list[datetime] = []
    for item in value:
        if not isinstance(item, str):
            return []
        try:
            timestamps.append(datetime.fromisoformat(item))
        except ValueError:
            return []
    return timestamps


def _coerce_numeric_list(value: Any) -> list[float | None]:
    if not isinstance(value, list):
        return []
    return [_as_optional_float(item) for item in value]


def _coerce_integer_list(value: Any) -> list[int | None]:
    if not isinstance(value, list):
        return []
    return [_as_optional_int(item) for item in value]


def _nearest_time_index(times: list[datetime], target: datetime) -> int | None:
    if not times:
        return None
    return min(range(len(times)), key=lambda index: abs((times[index] - target).total_seconds()))


def _hourly_window_indices(
    times: list[datetime], local_start: datetime, local_end: datetime
) -> list[int]:
    if not times:
        return []
    window_start = local_start.replace(minute=0, second=0, microsecond=0)
    window_end = local_end.replace(minute=0, second=0, microsecond=0)
    return [
        index for index, timestamp in enumerate(times) if window_start <= timestamp <= window_end
    ]


def _value_at_index(values: list[float | None], index: int) -> float | None:
    if index < 0 or index >= len(values):
        return None
    return values[index]


def _mean_for_indices(values: list[float | None], indices: list[int]) -> float | None:
    samples = [
        values[index]
        for index in indices
        if 0 <= index < len(values) and values[index] is not None
    ]
    if not samples:
        return None
    return sum(samples) / len(samples)


def _sum_for_indices(values: list[float | None], indices: list[int]) -> float | None:
    samples = [
        values[index]
        for index in indices
        if 0 <= index < len(values) and values[index] is not None
    ]
    if not samples:
        return None
    return sum(samples)


def _max_for_indices(values: list[float | None], indices: list[int]) -> float | None:
    samples = [
        values[index]
        for index in indices
        if 0 <= index < len(values) and values[index] is not None
    ]
    if not samples:
        return None
    return max(samples)


def _select_weather_code(values: list[int | None], indices: list[int]) -> int | None:
    codes = [
        values[index]
        for index in indices
        if 0 <= index < len(values) and values[index] is not None
    ]
    if not codes:
        return None
    return max(codes, key=_weather_code_severity)


def _round_weather_value(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 1)


def _weather_code_severity(code: int) -> int:
    severity = {
        0: 0,
        1: 1,
        2: 2,
        3: 3,
        45: 10,
        48: 11,
        51: 20,
        53: 21,
        55: 22,
        56: 23,
        57: 24,
        61: 30,
        63: 31,
        65: 32,
        66: 33,
        67: 34,
        71: 40,
        73: 41,
        75: 42,
        77: 43,
        80: 50,
        81: 51,
        82: 52,
        85: 53,
        86: 54,
        95: 60,
        96: 61,
        99: 62,
    }
    return severity.get(code, code)


def _weather_code_label(code: int | None) -> str | None:
    if code is None:
        return None
    labels = {
        0: "Clear sky",
        1: "Mainly clear",
        2: "Partly cloudy",
        3: "Overcast",
        45: "Fog",
        48: "Depositing rime fog",
        51: "Light drizzle",
        53: "Moderate drizzle",
        55: "Dense drizzle",
        56: "Light freezing drizzle",
        57: "Dense freezing drizzle",
        61: "Slight rain",
        63: "Moderate rain",
        65: "Heavy rain",
        66: "Light freezing rain",
        67: "Heavy freezing rain",
        71: "Slight snow",
        73: "Moderate snow",
        75: "Heavy snow",
        77: "Snow grains",
        80: "Slight rain showers",
        81: "Moderate rain showers",
        82: "Violent rain showers",
        85: "Slight snow showers",
        86: "Heavy snow showers",
        95: "Thunderstorm",
        96: "Thunderstorm with slight hail",
        99: "Thunderstorm with heavy hail",
    }
    return labels.get(code)


if __name__ == "__main__":
    raise SystemExit(main())
