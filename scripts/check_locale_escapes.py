#!/usr/bin/env python3
"""Locale escape guard: block doubled single-character escapes in translations.

A TypeScript string literal escapes a Unicode code point as a single
backslash followed by `u` and four hex digits, e.g. `"\\u2013"` in the source
file decodes to an en dash at runtime, and the same single-backslash rule
applies to `\\n`, `\\t` and `\\r`. If a translation pass (script, find/replace,
or an LLM re-emitting escaped text) doubles that leading backslash, the
source ends up with two literal backslashes before the escape body.
TypeScript then parses the first backslash pair as an escaped backslash and
leaves the rest as literal characters, so the string renders on screen as
garbage - `–` instead of an en dash, or a literal backslash-n instead of a
line break.

This is invisible to every other gate: it is a syntactically valid string, the
key is present, `tsc` and `npm run build` stay green, and key-count / missing-
key checks stay silent. Only a human looking at the rendered page catches it.
Originally written for `\\u` only, after 4 keys / 78 values across 28 locale
files were found doubled (fixed in a023d1e42 and c452e3ecd). The same bug in
`\n`/`\t`/`\r` stayed invisible to this guard until a full scan found 216 more
cells across 26 locales (fixed in 09ae5c27d and a22535fbf); the regex now
covers all four escape bodies so the next occurrence fails the commit instead
of waiting for another sweep.

`ai.paste_placeholder` carries a doubled `\\t` in en.ts itself, not as
per-locale drift - every locale that shares it inherited it from the source.
That is a source-level question, not something this guard should decide, so
it is intentionally NOT excluded here: if it still has a doubled escape when
this runs, the guard will name it like any other hit, and it stays failing
until a human resolves the source value one way or the other.

Usage:
    python scripts/check_locale_escapes.py

Exit code 0 means clean. Exit code 1 means a doubled escape was found and the
output names every offending file, line and match.
"""

from __future__ import annotations

import glob
import re
import sys

# Two literal backslashes followed by an escape body: `n`, `t`, `r`, or a
# four-hex-digit Unicode body. A correctly encoded value has exactly one
# backslash here; a doubled one is always the corruption, never an
# intentional value - locale strings are prose, not code, and never need to
# describe a literal backslash followed by one of these escape bodies.
_DOUBLED_ESCAPE = re.compile(r"\\\\[ntr]|\\\\u[0-9a-fA-F]{4}")

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
        print(f"ERROR: doubled escape found in {len(hits)} place(s):", file=sys.stderr)
        for path, lineno, snippet in hits:
            print(f"  {path}:{lineno}: {snippet}", file=sys.stderr)
        print(
            "\nA doubled backslash before \\n, \\t, \\r or a \\uXXXX escape renders "
            "as literal garbage instead of the intended character or whitespace. "
            "Fix the escaping only (one backslash, not two) - do not change which "
            "character it decodes to.",
            file=sys.stderr,
        )
        return 1

    print(f"locale escapes OK: {len(paths)} files, no doubled escapes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
