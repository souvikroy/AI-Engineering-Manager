"""Code chunker. Tree-sitter when available; line-window fallback otherwise.

Each chunk: (path, span, lang, ast_kind, text). Lazy — only chunks files in the requested set.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

log = logging.getLogger(__name__)

EXT_LANG = {
    ".py": "python", ".pyi": "python",
    ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
    ".go": "go", ".java": "java", ".rs": "rust", ".rb": "ruby",
    ".cpp": "cpp", ".cc": "cpp", ".c": "c", ".h": "c",
    ".sql": "sql", ".md": "markdown", ".yaml": "yaml", ".yml": "yaml",
    ".json": "json", ".toml": "toml", ".sh": "bash",
}

WINDOW_LINES = 60
WINDOW_OVERLAP = 10
SKIP_PARTS = {"node_modules", ".venv", "venv", "dist", "build", ".git", "__pycache__"}


@dataclass(frozen=True)
class Chunk:
    path: str
    start_line: int
    end_line: int
    lang: str
    text: str
    symbol: str = ""
    ast_kind: str = ""
    parent_summary: str = ""


@dataclass
class ChunkIndex:
    chunks: list[Chunk] = field(default_factory=list)
    by_path: dict[str, list[int]] = field(default_factory=dict)

    def add(self, c: Chunk) -> None:
        self.by_path.setdefault(c.path, []).append(len(self.chunks))
        self.chunks.append(c)


def chunk_repo(workdir: Path, files: list[str] | None = None) -> ChunkIndex:
    idx = ChunkIndex()
    targets: list[Path] = []
    if files:
        targets = [workdir / f for f in files if (workdir / f).is_file()]
    else:
        for p in workdir.rglob("*"):
            if not p.is_file():
                continue
            if any(part in SKIP_PARTS for part in p.parts):
                continue
            if p.suffix.lower() in EXT_LANG:
                targets.append(p)

    for p in targets:
        for c in _chunk_file(workdir, p):
            idx.add(c)
    log.info("chunker: %d chunks across %d files", len(idx.chunks), len(idx.by_path))
    return idx


def _chunk_file(workdir: Path, p: Path) -> list[Chunk]:
    try:
        text = p.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return []
    lang = EXT_LANG.get(p.suffix.lower(), "text")
    rel = str(p.relative_to(workdir))

    if lang == "python":
        return _chunk_python(rel, text)
    return _window_chunks(rel, text, lang)


def _chunk_python(rel: str, text: str) -> list[Chunk]:
    """AST-aware chunking for Python: one chunk per top-level function/class."""
    import ast
    out: list[Chunk] = []
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return _window_chunks(rel, text, "python")

    lines = text.splitlines()
    seen_spans: list[tuple[int, int]] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            start = node.lineno
            end = getattr(node, "end_lineno", start) or start
            chunk_text = "\n".join(lines[start - 1 : end])
            kind = type(node).__name__
            out.append(Chunk(
                path=rel, start_line=start, end_line=end, lang="python",
                symbol=node.name, ast_kind=kind, text=chunk_text,
            ))
            seen_spans.append((start, end))

    # Module-level body that isn't inside a function/class — emit as one chunk.
    if seen_spans:
        seen_spans.sort()
        cursor = 1
        for s, e in seen_spans:
            if s - cursor >= 5:
                gap = "\n".join(lines[cursor - 1 : s - 1])
                if gap.strip():
                    out.append(Chunk(
                        path=rel, start_line=cursor, end_line=s - 1, lang="python",
                        symbol="<module>", ast_kind="Module", text=gap,
                    ))
            cursor = e + 1
        if cursor <= len(lines):
            gap = "\n".join(lines[cursor - 1 :])
            if gap.strip():
                out.append(Chunk(
                    path=rel, start_line=cursor, end_line=len(lines), lang="python",
                    symbol="<module>", ast_kind="Module", text=gap,
                ))
    else:
        out.extend(_window_chunks(rel, text, "python"))
    return out


def _window_chunks(rel: str, text: str, lang: str) -> list[Chunk]:
    lines = text.splitlines()
    out: list[Chunk] = []
    if not lines:
        return out
    n = len(lines)
    step = max(1, WINDOW_LINES - WINDOW_OVERLAP)
    start = 0
    while start < n:
        end = min(n, start + WINDOW_LINES)
        out.append(Chunk(
            path=rel, start_line=start + 1, end_line=end, lang=lang,
            symbol="", ast_kind="window",
            text="\n".join(lines[start:end]),
        ))
        if end >= n:
            break
        start += step
    return out
