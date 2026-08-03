#!/usr/bin/env python3
"""i18n orphan guard: block t() keys that no locale file can answer.

The two existing locale guards both start from a key that exists. The escape
guard reads locale files; the leak guard compares a locale's value against
en.ts. Neither can see the case where a key is in NO locale file at all,
because there is no value to read and nothing to compare against - the leak
guard exits 0 on it, the escape guard never visits it, tsc is happy, vitest
is happy and `npm run build` is happy.

The call site still renders, because `t(key, {defaultValue})` falls back to
the defaultValue when the key resolves nowhere. So the string reaches every
one of the 29 languages in English, and every gate we own reports green.
#175 shipped exactly this way: service.sla_breached and service.sla_late
were converted from English literals into keys, the keys were never added to
any locale file, and the SLA chip read in English in all 29 languages
through a full release with three hygiene gates passing on it.

This guard closes that hole. It reads every `t(key, {..., defaultValue, ...})`
call site under frontend/src, resolves each key against all 29 bundles, and
fails on any key fewer than all of them can answer.

Three things worth knowing about how it counts:

  * Plural forms. i18next resolves a counted key through its CLDR category,
    so `meetings.attachment_n` need never exist as a bare key if
    `meetings.attachment_n_one` and `_other` do. A key is reachable in a
    locale if the bare form OR any CLDR-suffixed form is present there.
    Ignoring this reports 23 orphans where there are 8. What it deliberately
    does NOT check is plural COMPLETENESS - a Russian file carrying only
    `_other` counts as reachable here, because "reachable at all" and "has
    every form this language needs" are different questions and conflating
    them would let this guard fail for a reason its message does not state.

  * Scope. Keys called WITHOUT a defaultValue are out of scope. A missing
    one of those renders the raw key on screen, which is loud, self-reporting
    and gets fixed the day someone opens the page. The defaultValue form is
    the silent one, and silence is what needs a machine watching it.

  * Baseline, not allowlist. Known debt lives in i18n_orphan_baseline.json
    as an explicit map of key to the SET of locales that cannot answer it,
    the same shape the leak guard uses and for the same reason: a count
    cannot tell a repaired locale from a newly broken one, and a bare key
    list goes green the moment the first locale is filled in. The set may
    only shrink. More locales missing than recorded is a regression.

Parser desync is a failure, not a pass. The key regex here is double-quote
only, matching the shape every locale file is written in; if a file ever
picks up single-quoted or multi-line entries its keys drop out of the scan
and the guard would go green on missing data. A locale file that parses to
no keys, or a source tree that yields no call sites, fails rather than
reporting success on nothing.
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys

LOCALE_GLOB = "frontend/src/app/locales/*.ts"
SOURCE_GLOB = "frontend/src/**/*.ts*"
BASELINE_PATH = "scripts/i18n_orphan_baseline.json"

# `"key": ` at the head of a line, the one-entry-per-line shape the locale
# files are generated in. Same double-quote-only blind spot the leak guard
# documents, and desync is caught by the zero-key check rather than tolerated.
_KEY_LINE = re.compile(r'^\s*"([A-Za-z0-9_.\-]+)"\s*:', re.MULTILINE)

# Opening of a t() call with a string-literal key, up to the `{` of its
# options object. The options object itself is brace-matched afterwards
# rather than regex-matched: a defaultValue is very often a template literal
# and `[^}]*` stops at the first `}` of an interpolation, which would drop
# real call sites and make this guard quietly narrower than it claims.
_CALL_HEAD = re.compile(r"""\bt\(\s*(['"])([A-Za-z0-9_][A-Za-z0-9_.\-]*)\1\s*,\s*\{""")

_CLDR_SUFFIXES = ("_zero", "_one", "_two", "_few", "_many", "_other")


def _options_body(text: str, brace_index: int) -> str | None:
    """Return the source between the options `{` and its matching `}`."""
    depth = 0
    for i in range(brace_index, len(text)):
        char = text[i]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[brace_index + 1 : i]
    return None


def _read_locales() -> dict[str, set[str]]:
    """Map locale stem to the set of keys that locale file declares."""
    by_locale: dict[str, set[str]] = {}
    for path in sorted(glob.glob(LOCALE_GLOB)):
        stem = os.path.splitext(os.path.basename(path))[0]
        if stem in {"index", "types"}:
            continue
        with open(path, encoding="utf-8") as fh:
            by_locale[stem] = set(_KEY_LINE.findall(fh.read()))
    return by_locale


def _read_call_sites() -> dict[str, str]:
    """Map each key called with a defaultValue to the first file calling it."""
    sites: dict[str, str] = {}
    for path in sorted(glob.glob(SOURCE_GLOB, recursive=True)):
        posix = path.replace(os.sep, "/")
        if "/app/locales/" in posix or ".test." in posix or ".spec." in posix:
            continue
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        if "defaultValue" not in text:
            continue
        for match in _CALL_HEAD.finditer(text):
            body = _options_body(text, match.end() - 1)
            if body is None or "defaultValue" not in body:
                continue
            sites.setdefault(match.group(2), posix)
    return sites


def _reach(key: str, by_locale: dict[str, set[str]]) -> set[str]:
    """Locales that can answer this key, bare form or any CLDR plural form."""
    forms = (key, *(key + suffix for suffix in _CLDR_SUFFIXES))
    return {stem for stem, keys in by_locale.items() if any(f in keys for f in forms)}


def main() -> int:
    by_locale = _read_locales()
    if not by_locale:
        print(f"ERROR: no files matched {LOCALE_GLOB!r}", file=sys.stderr)
        return 1
    empty = sorted(stem for stem, keys in by_locale.items() if not keys)
    if empty:
        print(
            f"ERROR: {len(empty)} locale file(s) parsed to zero keys: {', '.join(empty)}.\n"
            "The key regex is double-quote only. A file written any other way "
            "drops out of this scan silently, so an empty parse is treated as a "
            "broken scan rather than a clean one.",
            file=sys.stderr,
        )
        return 1

    sites = _read_call_sites()
    if not sites:
        print(
            f"ERROR: no t(key, {{defaultValue}}) call sites found under {SOURCE_GLOB!r}. "
            "Finding nothing and not having looked must not print the same result.",
            file=sys.stderr,
        )
        return 1

    with open(BASELINE_PATH, encoding="utf-8") as fh:
        baseline: dict[str, dict[str, object]] = json.load(fh)

    all_locales = set(by_locale)
    new_gaps: list[tuple[str, str, list[str]]] = []
    widened: list[tuple[str, list[str]]] = []
    healed: list[str] = []

    for key, first_file in sorted(sites.items()):
        missing = sorted(all_locales - _reach(key, by_locale))
        entry = baseline.get(key)
        declared = sorted(entry["missing_locales"]) if entry else []  # type: ignore[index,arg-type]
        if not missing:
            if key in baseline:
                healed.append(key)
            continue
        if key not in baseline:
            new_gaps.append((key, first_file, missing))
        elif set(missing) - set(declared):
            widened.append((key, sorted(set(missing) - set(declared))))

    if new_gaps or widened:
        for key, first_file, missing in new_gaps:
            print(
                f"ERROR: {key} is answered by no locale file it needs "
                f"({len(all_locales) - len(missing)}/{len(all_locales)}), "
                f"called from {first_file}",
                file=sys.stderr,
            )
            print(f"  missing: {', '.join(missing)}", file=sys.stderr)
        for key, extra in widened:
            print(
                f"ERROR: {key} lost locales the baseline did not record: {', '.join(extra)}",
                file=sys.stderr,
            )
        print(
            "\nA key called with a defaultValue and answered by no locale file "
            "renders its English default in every language, and no other gate "
            "we own can see it: there is no value to compare against, so the "
            "leak guard passes, tsc passes and the build passes. Add the key to "
            "every locale, grounded in what that language's own units and plural "
            "forms substitute into the sentence. Do not silence this by dropping "
            "the defaultValue - that turns a silent English string into a raw "
            f"key on screen. {BASELINE_PATH} records existing debt only and may "
            "only shrink.",
            file=sys.stderr,
        )
        return 1

    print(
        f"i18n orphan keys OK: {len(sites)} keys called with a defaultValue "
        f"across {len(by_locale)} locales, {len(baseline)} in the baseline"
    )
    if healed:
        print(
            f"  {len(healed)} baseline key(s) now fully answered, drop them: {', '.join(healed)}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
