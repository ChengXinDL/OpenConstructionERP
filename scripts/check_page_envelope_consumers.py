#!/usr/bin/env python3
"""Refuse a half-migrated collection endpoint.

An endpoint that returns ``{items, total, offset, limit}`` breaks every caller
still expecting a bare array. TypeScript catches most of that, but NOT the
case this guard exists for: React Query caches by key, and the key is a
string. If two files share ``queryKey: ['schedules']`` and only one is
migrated, the cache hands the wrong shape to the other at RUNTIME. ``npm run
build`` is green and the screen is broken.

So the unit of migration is one endpoint plus every consumer of it, in one
commit. This script counts both sides and fails when they disagree.

Usage:
    python scripts/check_page_envelope_consumers.py
    python scripts/check_page_envelope_consumers.py --self-test

Exit codes:
    0  every migrated endpoint has every consumer migrated
    1  at least one endpoint is half migrated
    2  the scan found no consumers at all (broken instrument, not a pass)
"""

from __future__ import annotations

import argparse
import re
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FRONTEND = REPO / "frontend" / "src"

# Endpoints already migrated to the envelope. Add a line here in the same
# commit that migrates the endpoint, never later.
MIGRATED_ENDPOINTS: dict[str, str] = {
    "/v1/schedule/schedules/": "schedule list",
    "/v1/schedule/schedules/{}/activities/": "schedule activities",
}

# A call is migrated when it names the envelope type. A call that still
# names a bare array of the row type is not.
ENVELOPE_HINT = re.compile(r"Page<|\.items\b|items:\s")
BARE_ARRAY_HINT = re.compile(r"apiGet<\s*[A-Za-z_][A-Za-z0-9_]*\[\]\s*>")


def url_shape(url: str) -> str:
    """Reduce a URL to its route, with every interpolation collapsed."""
    url = url.split("?")[0]
    url = re.sub(r"\$\{[^}]*\}", "{}", url)
    return re.sub(r"/+", "/", url)


def scan(root: Path) -> tuple[dict[str, list[Path]], dict[str, list[Path]]]:
    """Return (consumers, unmigrated) keyed by migrated endpoint route."""
    consumers: dict[str, list[Path]] = {k: [] for k in MIGRATED_ENDPOINTS}
    unmigrated: dict[str, list[Path]] = {k: [] for k in MIGRATED_ENDPOINTS}

    for path in root.rglob("*.ts*"):
        if "node_modules" in path.parts:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for m in re.finditer(r"[`'\"]((?:/api)?/v1/[^`'\"\s]*)[`'\"]", text):
            raw = m.group(1)
            shape = url_shape(raw).removeprefix("/api")
            if shape not in MIGRATED_ENDPOINTS:
                continue
            # Doc comments quote these routes constantly. A comment is not a
            # consumer, and counting one produces a failure nobody can fix.
            line_start = text.rfind("\n", 0, m.start()) + 1
            if text[line_start : m.start()].lstrip().startswith(("*", "//", "/*")):
                continue
            # Only a GET reads the collection. The same route is also a POST
            # target (create) and a DELETE target (clear); neither returns a
            # page, so neither can be half migrated.
            #
            # Bind to the NEAREST preceding call, not to any call in a window:
            # these api objects list one route per line, so a window wide
            # enough to hold the call is wide enough to hold its neighbour's.
            before = text[max(0, m.start() - 400) : m.start()]
            verbs = re.findall(r"api(Get|Post|Patch|Put|Delete)", before)
            if not verbs or verbs[-1] != "Get":
                continue
            consumers[shape].append(path)
            # Look at the statement around the call, not the whole file: a
            # big page can migrate one call and leave a second one bare.
            window = text[max(0, m.start() - 400) : m.start() + 200]
            if BARE_ARRAY_HINT.search(window) or not ENVELOPE_HINT.search(window):
                unmigrated[shape].append(path)
    return consumers, unmigrated


def report(root: Path) -> int:
    consumers, unmigrated = scan(root)
    total_consumers = sum(len(v) for v in consumers.values())
    if total_consumers == 0:
        print("FAIL: found no consumers of any migrated endpoint.")
        print("      A zero here means the scan is broken, not that the tree is clean.")
        return 2

    failed = False
    for route, label in MIGRATED_ENDPOINTS.items():
        seen = consumers[route]
        bad = unmigrated[route]
        print(f"{label}: {len(seen)} call sites, {len(seen) - len(bad)} migrated")
        for p in sorted(set(bad)):
            print(f"  UNMIGRATED  {p.relative_to(REPO)}")
            failed = True
    if failed:
        print()
        print("FAIL: an endpoint returns the envelope but some callers still read a bare array.")
        print("      Migrate every consumer in this commit. A shared React Query key means")
        print("      a partial migration breaks at runtime and the build cannot see it.")
        return 1
    print("\nOK: every migrated endpoint has every consumer migrated.")
    return 0


def self_test() -> int:
    """Prove the guard can refuse.

    A guard nobody has watched fail is indistinguishable from one whose
    argument is ignored, so this plants a consumer that reads a bare array
    and asserts the scan rejects it.
    """
    with tempfile.TemporaryDirectory() as tmp:
        fake = Path(tmp)
        (fake / "Good.tsx").write_text(
            "const page = await apiGet<Page<Row>>(`/v1/schedule/schedules/?project_id=${id}`);\n"
            "return page.items;\n",
            encoding="utf-8",
        )
        consumers, unmigrated = scan(fake)
        if len(consumers["/v1/schedule/schedules/"]) != 1 or unmigrated["/v1/schedule/schedules/"]:
            print("SELF-TEST FAIL: a correctly migrated consumer was not accepted.")
            return 1

        (fake / "Bad.tsx").write_text(
            "const rows = await apiGet<ScheduleRow[]>(`/v1/schedule/schedules/?project_id=${id}`);\n"
            "return rows;\n",
            encoding="utf-8",
        )
        consumers, unmigrated = scan(fake)
        if len(unmigrated["/v1/schedule/schedules/"]) != 1:
            print("SELF-TEST FAIL: the guard accepted a consumer still reading a bare array.")
            print("                It cannot refuse, so a green run from it means nothing.")
            return 1

        # The narrowings have to be proven too, or a later tightening could
        # silence the refusal above without anyone noticing.
        (fake / "Bad.tsx").unlink()
        # The read sits a few lines above the writers, exactly as it does in
        # the real feature api objects. A window-based check passes this file
        # by borrowing the neighbouring apiGet, so it has to be in the fixture.
        (fake / "Writer.tsx").write_text(
            "export const api = {\n"
            "  getGantt: (id) => apiGet<GanttData>(`/v1/schedule/schedules/${id}/gantt/`),\n"
            "  createActivity: (id, body) =>\n"
            "    apiPost<Activity>(`/v1/schedule/schedules/${id}/activities/`, body),\n"
            "  clearActivities: (id) =>\n"
            "    apiDelete<Cleared>(`/v1/schedule/schedules/${id}/activities/`),\n"
            "};\n",
            encoding="utf-8",
        )
        (fake / "Doc.tsx").write_text(
            "/** See `/v1/schedule/schedules/?project_id=...` for the shape. */\n",
            encoding="utf-8",
        )
        consumers, unmigrated = scan(fake)
        if unmigrated["/v1/schedule/schedules/{}/activities/"]:
            print("SELF-TEST FAIL: a POST/DELETE on the route was counted as a truncated read.")
            return 1
        if len(consumers["/v1/schedule/schedules/"]) != 1:
            print("SELF-TEST FAIL: a doc comment quoting the route was counted as a consumer.")
            return 1

    print("SELF-TEST OK: accepts a migrated consumer, refuses an unmigrated one,")
    print("              and ignores writers and doc comments on the same route.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="prove the guard can fail, then exit")
    args = ap.parse_args()
    if args.self_test:
        return self_test()
    # The self test runs before every real scan, not only on demand. The
    # matching here is narrow enough that a later tightening could stop it
    # seeing anything at all, and a guard that cannot refuse reports the same
    # clean run as a tree with nothing wrong in it. Costs one temp directory.
    if self_test() != 0:
        print("FAIL: the guard could not prove it still refuses, so its verdict means nothing.")
        return 2
    print()
    return report(FRONTEND)


if __name__ == "__main__":
    sys.exit(main())
