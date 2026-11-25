from __future__ import annotations

import json
from pathlib import Path

from .resolve import resolve_event

FIXTURE = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "gold-resolve.json"


def cases(path: Path | None = None) -> list[dict]:
    return json.loads((path or FIXTURE).read_text(encoding="utf-8"))["cases"]


def evaluate(rows: list[dict], path: Path | None = None) -> dict:
    listed = cases(path)
    known = {row["id"]: row for row in rows}
    results = []
    for case in listed:
        problems = []
        event = known.get(case["event_id"])
        basis = known.get(case["basis"])
        if event is None:
            problems.append("utterance missing")
        elif case["phrase"] not in (event.get("text") or ""):
            problems.append("phrase is not verbatim")
        if basis is None:
            problems.append("basis missing")
        elif case.get("quote") and case["quote"] not in (basis.get("text") or ""):
            problems.append("basis quote is not verbatim")
        got = resolve_event(rows, case["event_id"], case["phrase"])
        item = (got.get("phrases") or [{}])[0]
        resolved = item.get("resolved", [])
        if not problems and sorted(resolved) != sorted(case["expected"]):
            problems.append(f"resolved {resolved} != {case['expected']}")
        if not problems and not item.get("utterances"):
            problems.append("no utterance to look back at")
        results.append({
            "case": case["case"], "event_id": case["event_id"],
            "phrase": case["phrase"], "kind": case["kind"],
            "expected": case["expected"], "resolved": resolved,
            "label": (item.get("labels") or [""])[0],
            "utterances": item.get("utterance_count", 0),
            "reason": item.get("reason", ""),
            "verdict": "PASS" if not problems else "FAIL",
            "problems": problems,
        })
    passed = sum(1 for item in results if item["verdict"] == "PASS")
    return {"passed": passed, "total": len(results),
            "verdict": "gold_ok" if passed == len(results) else "BROKEN",
            "cases": results}
