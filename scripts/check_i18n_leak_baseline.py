#!/usr/bin/env python3
"""i18n leak guard: block new locale values that are byte-identical to en.ts.

On 2026-07-26, five commits (all titled "translate the X panel...") added
294 keys across 10 modules to all 29 locale files. Each wrote a real Russian
value and copied the literal English source string into the other 27 locale
files, self-admitted in the commit bodies ("English everywhere and Russian
in ru.ts"). Every key existed and every coverage check passed, because the
string was present - it was just the wrong string. 7965 cells shipped this
way and sat unnoticed until #181's translation work found the first one by
hand. See i18n_leak_baseline.json for the full, named list.

The fingerprint that finds this class of bug without knowing any of the 27
languages: a genuine translation produces uneven, locale-specific counts of
values that happen to equal English (0-6, varying key to key and locale to
locale - short technical nouns, codes, abbreviations coincide sometimes).
A leak produces the same count in every affected locale, with translated
ru the sole exception. Uniformity is the signal.

This guard does not repair anything and does not scan every string in every
locale for untranslated English - that is a much bigger, separately scoped
problem, and a byte comparison is structurally blind to a wrong-sense
translation that isn't English (e.g. mn's field_jurisdiction, which holds
real Mongolian text in the wrong sense - see MEMORY). What it does: freezes
the known 7965 cells as declared debt in the baseline (an explicit list of
key/locale pairs, not a count, because a count cannot tell a repaired cell
from a newly leaked one) and fails if any NEW key/locale pair not already in
that baseline turns up byte-identical to en. A key that heals drops out of
its own entry silently; nothing needs to be kept in sync by hand for that
direction.

Usage:
    python scripts/check_i18n_leak_baseline.py
    python scripts/check_i18n_leak_baseline.py --update-baseline

Exit code 0 means no new leak. Exit code 1 means a new key/locale pair was
found byte-identical to its en.ts source and is not already declared debt.

--update-baseline rewrites the baseline to the currently observed leaked
set. Use this only after a deliberate, reviewed decision to accept new debt
(or after repairing some of it) - never as a way to turn a red check green
without looking at what it found.
"""

from __future__ import annotations

import glob
import json
import re
import sys

LOCALE_GLOB = "frontend/src/app/locales/*.ts"
BASELINE_PATH = "scripts/i18n_leak_baseline.json"

_PAIR = re.compile(r'^\s*"([a-zA-Z0-9_.\-]+)":\s*"((?:[^"\\]|\\.)*)"', re.MULTILINE)
_ESCAPE = re.compile(r"\\(.)")


def _unescape(raw: str) -> str:
    return _ESCAPE.sub(lambda m: m.group(1), raw)


def _extract_pairs(text: str) -> dict[str, str]:
    return {k: _unescape(v) for k, v in _PAIR.findall(text)}


def _locale_stem(path: str) -> str:
    # "frontend/src/app/locales/es-MX.ts" -> "es-MX"
    return path.replace("\\", "/").rsplit("/", 1)[-1].removesuffix(".ts")


def main() -> int:
    update = "--update-baseline" in sys.argv

    paths = sorted(glob.glob(LOCALE_GLOB))
    if not paths:
        print(f"ERROR: no files matched {LOCALE_GLOB!r}", file=sys.stderr)
        return 1

    pairs_by_locale = {_locale_stem(p): _extract_pairs(open(p, encoding="utf-8").read()) for p in paths}
    if "en" not in pairs_by_locale:
        print("ERROR: en.ts not found among locale files", file=sys.stderr)
        return 1
    en_pairs = pairs_by_locale["en"]
    non_en = [s for s in pairs_by_locale if s != "en"]

    try:
        with open(BASELINE_PATH, encoding="utf-8") as fh:
            baseline: dict[str, dict] = json.load(fh)
    except FileNotFoundError:
        baseline = {}

    new_leaks: list[tuple[str, str]] = []
    healed: list[tuple[str, str]] = []
    for key, entry in sorted(baseline.items()):
        en_val = en_pairs.get(key)
        if en_val is None:
            continue  # key renamed or removed upstream; not this guard's concern
        known_leaked = set(entry.get("leaked_locales", []))
        current_leaked = {s for s in non_en if s != "ru" and pairs_by_locale[s].get(key) == en_val}
        for stem in sorted(current_leaked - known_leaked):
            new_leaks.append((key, stem))
        for stem in sorted(known_leaked - current_leaked):
            healed.append((key, stem))

    if healed:
        print(f"{len(healed)} baseline cell(s) no longer byte-identical to en (repaired, not a failure):")
        for key, stem in healed[:20]:
            print(f"  {key} / {stem}")
        if len(healed) > 20:
            print(f"  ... and {len(healed) - 20} more")
        print()

    if new_leaks:
        print(f"ERROR: {len(new_leaks)} new i18n leak(s) not in the declared baseline:", file=sys.stderr)
        for key, stem in new_leaks:
            print(f"  {key} / {stem} = {en_pairs[key]!r}", file=sys.stderr)
        print(
            "\nIf this is a real new leak: translate it (and its whole family - a "
            "leak this shape has never come alone) for real, in every locale.\n"
            "If this is deliberately-identical text (unit abbreviation, standards "
            "code, product name), that never belonged in the baseline - fix the "
            "false positive by narrowing the check, not by adding the cell here.",
            file=sys.stderr,
        )
        return 1

    if update:
        rebuilt = {}
        for key, entry in baseline.items():
            en_val = en_pairs.get(key)
            if en_val is None:
                continue
            current_leaked = sorted(s for s in non_en if s != "ru" and pairs_by_locale[s].get(key) == en_val)
            if current_leaked:
                rebuilt[key] = {"en_value": en_val, "leaked_locales": current_leaked}
        with open(BASELINE_PATH, "w", encoding="utf-8") as fh:
            json.dump(rebuilt, fh, ensure_ascii=False, indent=1, sort_keys=True)
            fh.write("\n")
        print(f"Baseline rewritten: {len(rebuilt)} keys (was {len(baseline)}).")

    print(f"i18n leak baseline OK: {len(baseline)} declared debt keys, no new leaks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
