"""Google Sheets OKR ingest — cron 30 min via service-account.

Reads a configured spreadsheet whose first row is a header. We treat each
data row as one structured Document under `source="gsheet"`, with the row's
JSON as the body. The chat layer's `get_okr_status` tool prefers Jira's
native OKR data when available and falls back to these rows otherwise.

Configuration:
- `GOOGLE_SERVICE_ACCOUNT_JSON` — full JSON blob of the service-account key.
- A spreadsheet id + tab range supplied to `sync_spreadsheet()`.

Cursor: Drive API `revisionId` — if the file hasn't changed since last sync,
we no-op cheaply. Falls back to "always pull" when the Drive API isn't
authorized for the same service account.
"""
from __future__ import annotations

import json as jsonlib
import logging
from datetime import datetime, timezone
from typing import Any

from ..config import get_settings
from ..db import acquire
from .base import upsert_document

log = logging.getLogger(__name__)


def _credentials():
    settings = get_settings()
    if not settings.google_service_account_json:
        return None
    try:
        from google.oauth2 import service_account
    except ImportError:
        log.warning("google-auth not installed; gsheet disabled")
        return None
    info = jsonlib.loads(settings.google_service_account_json)
    return service_account.Credentials.from_service_account_info(
        info,
        scopes=[
            "https://www.googleapis.com/auth/spreadsheets.readonly",
            "https://www.googleapis.com/auth/drive.metadata.readonly",
        ],
    )


def _services(creds):
    try:
        from googleapiclient.discovery import build
    except ImportError:
        log.warning("google-api-python-client not installed; gsheet disabled")
        return None, None
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False)
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    return sheets, drive


def _row_to_text(headers: list[str], row: list[Any]) -> str:
    """Render a row as a small structured block — `key: value` per line.

    The retrieval layer indexes this as plain text; entity_refs get extracted
    by the regex pass automatically.
    """
    pairs = []
    for h, v in zip(headers, row, strict=False):
        if v is None or str(v).strip() == "":
            continue
        pairs.append(f"{h}: {v}")
    return "\n".join(pairs)


def _refs_from_row(headers: list[str], row: list[Any]) -> list[str]:
    """Pick up canonical refs from common OKR column headers."""
    refs: set[str] = set()
    by_h = {h.lower().strip(): v for h, v in zip(headers, row, strict=False)}
    if "team" in by_h and by_h["team"]:
        refs.add(f"team:{str(by_h['team']).lower().strip()}")
    if "owner" in by_h and by_h["owner"]:
        refs.add(f"engineer:{str(by_h['owner']).strip()}")
    if "service" in by_h and by_h["service"]:
        refs.add(f"service:{str(by_h['service']).strip()}")
    if "quarter" in by_h and by_h["quarter"]:
        refs.add(f"sprint:{str(by_h['quarter']).strip()}")
    return sorted(refs)


async def _last_revision(sheet_id: str) -> str | None:
    async with acquire() as conn:
        row = await conn.fetchrow(
            "SELECT cursor FROM rag.ingest_cursor WHERE id = $1", f"gsheet:{sheet_id}"
        )
    return row["cursor"] if row else None


async def sync_spreadsheet(
    sheet_id: str,
    *,
    range_a1: str = "Sheet1!A1:Z1000",
    workspace_id: str | None = None,
) -> dict[str, int]:
    creds = _credentials()
    if creds is None:
        return {"accepted": 0, "skipped": 0, "reason_no_creds": 1}
    sheets, drive = _services(creds)
    if sheets is None:
        return {"accepted": 0, "skipped": 0, "reason_no_libs": 1}

    # Drive revisionId for cheap dedup.
    try:
        meta = drive.files().get(fileId=sheet_id, fields="headRevisionId,name").execute()
        revision = meta.get("headRevisionId")
        title = meta.get("name", sheet_id)
    except Exception:
        revision = None
        title = sheet_id

    if revision and revision == await _last_revision(sheet_id):
        return {"accepted": 0, "skipped": 1, "reason_unchanged": 1}

    resp = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=sheet_id, range=range_a1)
        .execute()
    )
    values: list[list[Any]] = resp.get("values", []) or []
    if not values:
        return {"accepted": 0, "skipped": 1, "reason_empty": 1}

    headers = [str(h).strip() for h in values[0]]
    rows = values[1:]

    accepted = 0
    skipped = 0
    for idx, row in enumerate(rows, start=2):
        if not any(str(c).strip() for c in row):
            skipped += 1
            continue
        body = _row_to_text(headers, row)
        if not body:
            skipped += 1
            continue
        source_id = f"{sheet_id}:row:{idx}"
        out = await upsert_document(
            source="gsheet",
            source_id=source_id,
            title=f"{title} · row {idx}",
            content=body,
            source_url=f"https://docs.google.com/spreadsheets/d/{sheet_id}",
            metadata={"sheet_id": sheet_id, "row": idx, "headers": headers},
            entity_refs=_refs_from_row(headers, row),
            chunker_fn=lambda s: [s],  # one row = one chunk
            workspace_id=workspace_id,
            cursor_id=f"gsheet:{sheet_id}",
            cursor=revision,
        )
        if out.get("skipped"):
            skipped += 1
        else:
            accepted += 1

    if revision:
        async with acquire() as conn:
            now = datetime.now(timezone.utc)
            await conn.execute(
                """
                INSERT INTO rag.ingest_cursor (id, cursor, last_run_at, last_ok_at, error_streak)
                VALUES ($1, $2, $3, $3, 0)
                ON CONFLICT (id) DO UPDATE SET
                    cursor = EXCLUDED.cursor,
                    last_run_at = EXCLUDED.last_run_at,
                    last_ok_at = EXCLUDED.last_ok_at,
                    error_streak = 0
                """,
                f"gsheet:{sheet_id}",
                revision,
                now,
            )
    log.info("gsheet.sync", sheet_id=sheet_id, accepted=accepted, skipped=skipped)
    return {"accepted": accepted, "skipped": skipped}


async def sync_all_known(*, workspace_id: str | None = None) -> dict[str, int]:
    async with acquire() as conn:
        rows = await conn.fetch(
            "SELECT id FROM rag.ingest_cursor WHERE id LIKE 'gsheet:%'"
        )
    totals = {"accepted": 0, "skipped": 0}
    for r in rows:
        sheet_id = str(r["id"]).removeprefix("gsheet:")
        out = await sync_spreadsheet(sheet_id, workspace_id=workspace_id)
        for k, v in out.items():
            totals[k] = totals.get(k, 0) + int(v)
    return totals
