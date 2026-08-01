#!/usr/bin/env python3
"""Locale escape guard: block doubled Unicode escapes in translation values.

A TypeScript string literal escapes a Unicode code point as a single
backslash followed by `u` and four hex digits, e.g. `"\\u2013"` in the source
file decodes to an en dash at runtime. If a translation pass (script,
find/replace, or an LLM re-emitting escaped text) doubles that leading
backslash, the source ends up with two literal backslashes before `u2013`.
TypeScript then parses the first backslash pair as an escaped backslash and
leaves `u2013` as four literal characters, so the string renders on screen as
the six-character garbage `–` instead of an en dash.

This is invisible to every other gate: it is a syntactically valid string, the
key is present, `tsc` and `npm run build` stay green, and key-count / missing-
key checks stay silent. Only a human looking at the rendered page catches it.
Found in 4 keys / 78 values across 28 locale files (fixed in a023d1e42 and
c452e3ecd); this guard exists so a fifth instance fails the commit instead of
waiting for another user report.

Usage:
    python scripts/check_locale_escapes.py

Exit code 0 means clean. Exit code 1 means a doubled escape was found and the
output names every offending file, line and match.
"""

from __future__ import annotations

import glob
import re
import sys

# Two literal backslashes followed by a four-hex-digit Unicode escape body.
# A correctly encoded value has exactly one backslash here (`–`); a
# doubled one (`\\u2013`) is always the corruption, never an intentional value
# - locale strings are prose, not code, and never need to describe a literal
# backslash followed by the letter u and four hex digits.
_DOUBLED_ESCAPE = re.compile(r"\\\\u[0-9a-fA-F]{4}")

LOCALE_GLOB = "frontend/src/app/locales/*.ts"


def _scan(paths: list[str]) -> list[tuple[str, int, str]]:
    hits: list[tuple[str, int, str]] = []
    for path in paths:
        with open(path, encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, start=1):
                for match in _DOUBLED_ESCAPE.finditer(line):
                    hits.append((path, lineno, match.group(0)))
    return hits


def main() -> int:
    paths = sorted(glob.glob(LOCALE_GLOB))
    if not paths:
        print(f"ERROR: no files matched {LOCALE_GLOB!r}", file=sys.stderr)
        return 1

    hits = _scan(paths)
    if hits:
        print(f"ERROR: doubled Unicode escape found in {len(hits)} place(s):", file=sys.stderr)
        for path, lineno, snippet in hits:
            print(f"  {path}:{lineno}: {snippet}", file=sys.stderr)
        print(
            "\nA doubled backslash before a \\uXXXX escape renders as literal "
            "garbage instead of the intended character. Fix the escaping only "
            "(one backslash, not two) - do not change which character it "
            "decodes to.",
            file=sys.stderr,
        )
        return 1

    print(f"locale escapes OK: {len(paths)} files, no doubled Unicode escapes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
