"""Typer CLI: `reviewer review <github_url>`, `status`, `report`, `rules`."""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.table import Table

from .core.config import get_settings
from .orchestrator.graph import run_review
from .persistence.repository import get_job, list_findings
from .rules.registry import all_rules

app = typer.Typer(no_args_is_help=True, add_completion=False, help="AI code reviewer.")
console = Console()


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )


@app.command()
def review(
    repo_url: str = typer.Argument(..., help="GitHub repo URL, e.g. https://github.com/owner/repo"),
    branch: str | None = typer.Option(None, "--branch", "-b", help="Review only this branch (default: every non-default branch)."),
    out: Path = typer.Option(Path("./report"), "--out", "-o", help="Where to write report.md and findings.json."),
    verbose: bool = typer.Option(False, "--verbose", "-v"),
) -> None:
    """Clone the repo, run the full review pipeline, write the report. Exit code maps to severity."""
    _setup_logging(verbose)
    s = get_settings()
    if not s.llm_enabled:
        console.print("[yellow]OPENROUTER_API_KEY not set — only static rules will run. LLM workflows will be skipped.[/]")
    if not s.github_authed:
        console.print("[yellow]GITHUB_TOKEN not set — public repos only, low rate limit.[/]")

    try:
        result = run_review(repo_url, out_dir=out, branch=branch)
    except Exception as e:  # noqa: BLE001
        console.print(f"[red]review failed:[/] {e}")
        if verbose:
            console.print_exception()
        raise typer.Exit(code=2) from e

    totals = result["totals"]["by_severity"]
    table = Table(title="Findings", show_lines=False)
    table.add_column("Severity", style="bold")
    table.add_column("Count", justify="right")
    for sev, count in totals.items():
        style = {"P0": "red", "P1": "orange3", "P2": "yellow", "P3": "green"}.get(sev, "")
        table.add_row(f"[{style}]{sev}[/]", str(count))
    console.print(table)
    console.print(f"Report:  [cyan]{result['report_md']}[/]")
    console.print(f"JSON:    [cyan]{result['findings_json']}[/]")
    console.print(f"Job ID:  [magenta]{result['job_id']}[/]")
    console.print(f"Cost:    ${result['totals']['cost_usd']} ({result['totals']['tokens']:,} tokens)")
    raise typer.Exit(code=result["exit_code"])


@app.command()
def status(job_id: str) -> None:
    """Print the persisted state of a previous review job."""
    job = get_job(job_id)
    if job is None:
        console.print(f"[red]job not found:[/] {job_id}")
        raise typer.Exit(code=1)
    console.print(f"[bold]{job.id}[/] · status=[cyan]{job.status}[/] · branch=[yellow]{job.target_ref}[/] · sha={job.head_sha[:12]}")
    console.print(f"created={job.created_at}  finished={job.finished_at}")
    fs = list_findings(job_id)
    console.print(f"findings: {len(fs)}")


@app.command()
def report(job_id: str, fmt: str = typer.Option("md", "--format", "-f", help="md or json")) -> None:
    """Print findings for a stored job."""
    fs = list_findings(job_id)
    if fmt == "json":
        out = [
            {
                "rule_id": f.rule_id, "severity": f.severity, "workflow": f.workflow,
                "file": f.file_path, "line": f.start_line, "rationale": f.rationale,
                "fix": f.fix_suggestion, "confidence": float(f.confidence),
                "branch": f.branch,
            }
            for f in fs
        ]
        console.print_json(json.dumps(out))
        return
    for f in fs:
        console.print(f"[bold]{f.severity}[/] [magenta]{f.rule_id}[/] {f.file_path}:{f.start_line} — {f.rationale[:120]}")


@app.command()
def rules() -> None:
    """List the rule registry — id, workflow, kind, severity."""
    table = Table(title="Rule Registry")
    table.add_column("ID")
    table.add_column("WF", justify="right")
    table.add_column("Kind")
    table.add_column("Severity")
    table.add_column("Static runner")
    table.add_column("Text", overflow="fold")
    for r in sorted(all_rules().values(), key=lambda r: (r.workflow, r.id)):
        table.add_row(
            r.id, str(r.workflow), r.kind, r.severity,
            r.static_runner or "-",
            r.text[:120] + ("…" if len(r.text) > 120 else ""),
        )
    console.print(table)


def main() -> None:
    app()


if __name__ == "__main__":
    main()
