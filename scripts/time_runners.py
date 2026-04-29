"""Time each static runner against the cloned example repo to find the slow one."""

from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from reviewer.static.runners import all_runners

WORK = Path("/Users/souvikroy1601/Documents/AI code review/.reviewer/souvikroy__real-time-voice-bot/work")

if not WORK.exists():
    print("checkout not found at", WORK)
    sys.exit(1)

runners = all_runners()
for name, fn in sorted(runners.items()):
    t0 = time.perf_counter()
    try:
        n = sum(1 for _ in fn(WORK, None))
    except Exception as e:
        print(f"{name:30}  ERROR  {e}")
        continue
    elapsed = time.perf_counter() - t0
    flag = "  <SLOW>" if elapsed > 2 else ""
    print(f"{name:30}  {elapsed:6.2f}s  {n:>4} findings{flag}")
