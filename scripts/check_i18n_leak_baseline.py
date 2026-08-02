#!/usr/bin/env python3
"""i18n leak guard: block new locale values that are byte-identical to en.ts.

On 2026-07-26, six commits added 422 keys across 11 modules to all 29 locale
files (five titled "translate the X panel...", one an ordinary feature commit,
feat(progress), that happened to add keys along the way — the mechanism is any
commit that adds locale keys, not a labelled i18n commit). Each wrote a real
Russian value and copied the literal English source string into the other 27
locale files. Two of the six commit bodies self-admitted it ("English
everywhere and Russian in ru.ts"); the other four said nothing about it at
all, so commit text is not a reliable way to find this class of bug. Every
key existed and every coverage check passed, because the string was present -
it was just the wrong string. 11360 cells shipped this way and sat unnoticed
until #181's translation work found the first one by hand.

The fingerprint that finds this class of bug without knowing any of the 27
languages: a genuine translation produces uneven, locale-specific counts of
values that happen to equal English (0-6, varying key to key and locale to
locale - short technical nouns, codes, abbreviations coincide sometimes). A
leak produces the same count in every affected locale, with translated ru
the sole exception. Uniformity is the signal. Generalised threshold: flag any
key identical to en.ts in at least 24 of the 28 non-en locales.

This guard runs that scan across the WHOLE of en.ts on every run, not just a
recheck of already-known debt, and requires every flagged key to land in
exactly one of two separate, never-merged lists:

  * i18n_leak_allowlist.json - keys identical to en on purpose (abbreviations,
    standards codes, product names, template-only strings, shortcuts, regex
    patterns...). Its tell is identical in EVERY locale, ru included. Each
    entry carries a reason_category and, where the category alone doesn't
    explain it, a free-text note. Permanent; may only grow.

  * i18n_leak_baseline.json - the leaked cells as declared debt, each key
    mapped to the explicit SET of locales still leaked (not a count - a count
    cannot tell a repaired cell from a newly leaked one, and not a bare key
    list - a bare key goes green on the first repaired locale). May only
    shrink; more locales leaked than recorded is a regression and fails.

A flagged key in neither list is a NEW leak (or a previously-undiscovered
one) and fails the build. A third file, i18n_leak_pending_review.json, holds
keys that don't fit either tell cleanly - almost-universal matches where a
handful of locales genuinely differ (e.g. a founder's name transliterated in
ar/ky but left in Latin script everywhere else). These are informational
only: reported every run, never failing, until a human reclassifies them.

Two failure modes beyond "new leak" this guard also catches:

  * False repair by deletion. A key leaving a baseline entry's leaked-locale
    set only proves it stopped being byte-identical to en - and with
    fallbackLng=en, deleting the key from that locale file also stops the
    match while the user still sees English. A "healed" cell is only accepted
    if the key is still PRESENT in that locale file.

  * Parser desync. The key/value regex here is double-quote-only, the same
    blind spot tsc's own TS1117 duplicate check has (single-quoted or
    multi-line entries are invisible to it). If a locale file ever picks up
    such an entry, its keys silently drop out of this scan and the lane goes
    green on missing data. Locale files legitimately carry different key
    counts from en.ts (a locale with richer CLDR plural categories than
    English - Russian has one/few/many/other where English has one/other -
    genuinely has thousands more keys), so cross-locale count comparison
    cannot be the check. Instead, within EACH file, this guard also matches a
    looser single-OR-double-quote pattern and fails if it finds more entries
    than the strict double-quote parser did - that gap is quoting the strict
    parser can't see, not a translation difference.

This guard does not repair anything and does not scan for real text in the
wrong sense (a byte comparison is structurally blind to e.g. mn's
field_jurisdiction, which holds real Mongolian text in the wrong sense - see
MEMORY) - that is a separately scoped, unbounded problem.

Usage:
    python scripts/check_i18n_leak_baseline.py
    python scripts/check_i18n_leak_baseline.py --update-baseline

Exit code 0 means every flagged key is accounted for and no baseline entry
regressed. Exit code 1 means a new leak, a baseline regression, a false
repair, or a parser-parity gap was found.

--update-baseline rewrites the baseline to the currently observed leaked set
for keys already in it (shrink direction only - a key whose observed set grew
still fails first). Use this only after a deliberate, reviewed decision to
accept a repair - never as a way to turn a red check green without looking at
what it found.
"""

from __future__ import annotations

import glob
import json
import sys

LOCALE_GLOB = "frontend/src/app/locales/*.ts"
BASELINE_PATH = "scripts/i18n_leak_baseline.json"
ALLOWLIST_PATH = "scripts/i18n_leak_allowlist.json"
PENDING_PATH = "scripts/i18n_leak_pending_review.json"

THRESHOLD = 24  # of 28 non-en locales

import re

_PAIR = re.compile(r'^\s*"([a-zA-Z0-9_.\-]+)":\s*"((?:[^"\\]|\\.)*)"', re.MULTILINE)
# Same key position, but the opening/closing quote on either side may be
# single OR double. Used only to detect entries the strict parser above
# would miss (single-quoted keys/values, which are valid TypeScript and
# invisible to _PAIR) - never to extract values, since it does not know how
# to un-escape a single-quoted body.
_LOOSE_PAIR = re.compile(r'''^\s*['"][a-zA-Z0-9_.\-]+['"]:\s*['"]''', re.MULTILINE)
_ESCAPE = re.compile(r"\\(.)")


def _unescape(raw: str) -> str:
    return _ESCAPE.sub(lambda m: m.group(1), raw)


def _extract_pairs(text: str) -> dict[str, str]:
    return {k: _unescape(v) for k, v in _PAIR.findall(text)}


def _locale_stem(path: str) -> str:
    # "frontend/src/app/locales/es-MX.ts" -> "es-MX"
    return path.replace("\\", "/").rsplit("/", 1)[-1].removesuffix(".ts")


def _load_json(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {}


def main() -> int:  # noqa: PLR0912, PLR0915 - one linear check, splitting it hides the sequencing
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

    # --- parser parity guard: within each file, not across locales ------
    # Cross-locale count comparison would false-positive on legitimate CLDR
    # plural richness (ru genuinely has thousands more keys than en). What
    # this guard checks instead: does the loose, quote-agnostic pattern find
    # more entries in a file than the strict double-quote parser does? If so,
    # some lines use a quoting style _PAIR can't see, and this scan is
    # silently blind to those keys - the same blind spot tsc's TS1117
    # duplicate check has. A handful of single-quoted VALUES are legitimate
    # and pre-existing (a value that itself contains a double-quoted
    # substring, e.g. 'No steps match "{{query}}"', written with single
    # quotes instead of escaping) - en.ts and ky.ts each carry exactly 2 of
    # these today, unrelated to this guard's leak scan. What this guard must
    # catch is a MATERIAL gap: a bad edit that silently desyncs dozens or
    # hundreds of entries, not two known, stable exceptions.
    HIDDEN_TOLERANCE = 5
    parity_failures = []
    parity_notes = []
    for path in paths:
        text = open(path, encoding="utf-8").read()
        strict_count = len(_PAIR.findall(text))
        loose_count = len(_LOOSE_PAIR.findall(text))
        hidden = loose_count - strict_count
        if hidden > HIDDEN_TOLERANCE:
            parity_failures.append((_locale_stem(path), strict_count, loose_count))
        elif hidden > 0:
            parity_notes.append((_locale_stem(path), hidden))
    if parity_notes:
        print(f"{len(parity_notes)} locale(s) have a small number of entries this scan's strict "
              "parser can't see (known, below the material-gap threshold, not gated):")
        for stem, hidden in parity_notes:
            print(f"  {stem}: {hidden} hidden")
        print()
    if parity_failures:
        print(f"ERROR: some locale file entries are invisible to the strict double-quote "
              f"scan this guard relies on, beyond the tolerance of {HIDDEN_TOLERANCE}:", file=sys.stderr)
        for stem, strict_count, loose_count in parity_failures:
            print(f"  {stem}: {strict_count} strict matches, {loose_count} quote-agnostic matches "
                  f"({loose_count - strict_count} entries hidden)",
                  file=sys.stderr)
        print(
            "\nThis usually means a bulk edit introduced single-quoted or "
            "multi-line entries (valid TypeScript, invisible to this regex and "
            "to tsc's TS1117 duplicate check alike). Fix the entries' quoting "
            "before trusting this guard again - it cannot see what it did not "
            "parse.",
            file=sys.stderr,
        )
        return 1

    allowlist: dict[str, dict] = _load_json(ALLOWLIST_PATH)
    baseline: dict[str, dict] = _load_json(BASELINE_PATH)
    pending: dict[str, dict] = _load_json(PENDING_PATH)

    # --- general scan across the whole of en.ts -------------------------
    flagged: dict[str, list[str]] = {}
    for key, en_val in en_pairs.items():
        identical = [s for s in non_en if pairs_by_locale[s].get(key) == en_val]
        if len(identical) >= THRESHOLD:
            flagged[key] = identical

    unclassified: list[tuple[str, list[str]]] = []
    new_leaks: list[tuple[str, str]] = []
    false_repairs: list[tuple[str, str]] = []
    healed: list[tuple[str, str]] = []

    for key, identical in flagged.items():
        if key in allowlist:
            continue  # permanent, no shrink/growth requirement
        if key in baseline:
            entry = baseline[key]
            known_leaked = set(entry.get("leaked_locales", []))
            current_leaked = {s for s in identical if s != "ru"}
            for stem in sorted(current_leaked - known_leaked):
                new_leaks.append((key, stem))
            for stem in sorted(known_leaked - current_leaked):
                # A cell leaving the leaked set only proves it stopped matching
                # en - confirm the key is still present in that locale, or a
                # deletion (not a translation) is masquerading as a repair.
                if key not in pairs_by_locale[stem]:
                    false_repairs.append((key, stem))
                else:
                    healed.append((key, stem))
            continue
        if key in pending:
            continue  # informational only, reported below
        unclassified.append((key, identical))

    if healed:
        print(f"{len(healed)} baseline cell(s) no longer byte-identical to en (repaired, not a failure):")
        for key, stem in healed[:20]:
            print(f"  {key} / {stem}")
        if len(healed) > 20:
            print(f"  ... and {len(healed) - 20} more")
        print()

    if pending:
        print(f"{len(pending)} key(s) in the pending-review list (informational, not gated):")
        for key in sorted(pending)[:10]:
            print(f"  {key}")
        if len(pending) > 10:
            print(f"  ... and {len(pending) - 10} more")
        print()

    failed = False

    if false_repairs:
        failed = True
        print(f"ERROR: {len(false_repairs)} baseline cell(s) left the leaked set by DELETION, not translation:", file=sys.stderr)
        for key, stem in false_repairs:
            print(f"  {key} / {stem} - key no longer present in that locale file", file=sys.stderr)
        print(
            "\nWith fallbackLng=en the user still sees English either way. "
            "Translate the key in that locale; do not remove it.",
            file=sys.stderr,
        )

    if new_leaks:
        failed = True
        print(f"ERROR: {len(new_leaks)} baseline cell(s) regressed (leaked in a locale not recorded):", file=sys.stderr)
        for key, stem in new_leaks:
            print(f"  {key} / {stem} = {en_pairs[key]!r}", file=sys.stderr)

    if unclassified:
        failed = True
        print(f"ERROR: {len(unclassified)} key(s) identical to en.ts in >= {THRESHOLD}/{len(non_en)} "
              "locales and not in any of the three lists:", file=sys.stderr)
        for key, identical in sorted(unclassified):
            print(f"  {key}  n={len(identical)}  en={en_pairs[key]!r}", file=sys.stderr)
        print(
            "\nIf this is a real new leak: translate it (and its whole family - a "
            "leak this shape has never come alone) for real, in every locale, or "
            "add it to i18n_leak_baseline.json as declared debt with its exact "
            "leaked-locale set.\n"
            "If this is deliberately-identical text (unit abbreviation, standards "
            "code, product name, template-only string): add it to "
            "i18n_leak_allowlist.json with a reason_category, but only if it is "
            "identical in every locale including ru - if not, it belongs in "
            "i18n_leak_pending_review.json instead, unresolved.",
            file=sys.stderr,
        )

    if failed:
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

    print(
        f"i18n leak guard OK: {len(baseline)} baseline keys, {len(allowlist)} allowlist keys, "
        f"{len(pending)} pending review, no new leaks, no regressions, no false repairs"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
