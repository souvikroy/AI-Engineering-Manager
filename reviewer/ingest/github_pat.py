"""GitHub REST helpers using a PAT in $GITHUB_TOKEN. Anonymous fallback for public repos."""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_random_exponential

from ..core.config import get_settings

GITHUB_API = "https://api.github.com"

REPO_URL_RE = re.compile(r"github\.com[:/](?P<owner>[^/]+)/(?P<repo>[^/.]+)(?:\.git)?/?$", re.I)


@dataclass(frozen=True)
class RepoRef:
    owner: str
    repo: str

    @property
    def full(self) -> str:
        return f"{self.owner}/{self.repo}"


def parse_repo_url(url: str) -> RepoRef:
    m = REPO_URL_RE.search(url.strip())
    if not m:
        raise ValueError(f"Not a GitHub repo URL: {url!r}")
    return RepoRef(owner=m.group("owner"), repo=m.group("repo"))


def _headers() -> dict[str, str]:
    s = get_settings()
    h = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "reviewer/0.1",
    }
    if s.github_token:
        h["Authorization"] = f"Bearer {s.github_token}"
    return h


@retry(
    retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TransportError)),
    wait=wait_random_exponential(multiplier=0.5, max=30),
    stop=stop_after_attempt(5),
    reraise=True,
)
def _get(path: str, *, params: dict | None = None) -> dict | list:
    with httpx.Client(headers=_headers(), timeout=30.0) as c:
        r = c.get(f"{GITHUB_API}{path}", params=params)
        if r.status_code >= 400:
            r.raise_for_status()
        return r.json()


def repo_metadata(ref: RepoRef) -> dict:
    return _get(f"/repos/{ref.full}")  # type: ignore[return-value]


def list_branches(ref: RepoRef, *, per_page: int = 100) -> list[dict]:
    out: list[dict] = []
    page = 1
    while True:
        chunk = _get(f"/repos/{ref.full}/branches", params={"per_page": per_page, "page": page})
        if not isinstance(chunk, list) or not chunk:
            break
        out.extend(chunk)
        if len(chunk) < per_page:
            break
        page += 1
        if page > 50:  # 5000 branches hard cap; rare repos beyond this get truncated and noted.
            break
    return out


def latest_commit(ref: RepoRef, branch: str) -> dict:
    return _get(f"/repos/{ref.full}/commits/{branch}")  # type: ignore[return-value]


def list_commits(ref: RepoRef, branch: str, *, per_page: int = 100, max_pages: int = 5) -> list[dict]:
    out: list[dict] = []
    for page in range(1, max_pages + 1):
        chunk = _get(f"/repos/{ref.full}/commits", params={"sha": branch, "per_page": per_page, "page": page})
        if not isinstance(chunk, list) or not chunk:
            break
        out.extend(chunk)
        if len(chunk) < per_page:
            break
    return out


def get_readme(ref: RepoRef) -> str:
    try:
        data = _get(f"/repos/{ref.full}/readme")
    except httpx.HTTPStatusError:
        return ""
    import base64
    if isinstance(data, dict) and data.get("content"):
        try:
            return base64.b64decode(data["content"]).decode("utf-8", errors="replace")
        except Exception:
            return ""
    return ""


def clone_url_for(ref: RepoRef) -> str:
    """HTTPS clone URL with PAT injected if available. Token is never logged by callers."""
    s = get_settings()
    if s.github_token:
        return f"https://x-access-token:{s.github_token}@github.com/{ref.full}.git"
    return f"https://github.com/{ref.full}.git"
