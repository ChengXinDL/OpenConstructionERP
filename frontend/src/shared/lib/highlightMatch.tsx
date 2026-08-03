// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Mark the part of a name that the typed query matched, and fold text the same
 * way for the filter that decided the row was a match in the first place.
 *
 * Structured catalogues (NPK in Switzerland, STLB and GAEB in Germany, BC3 in
 * Spain) write a position as "what the work is" first and "under which
 * conditions" last, so a family of positions shares a long prefix and differs
 * only in its final few words. Five rows can therefore read as five copies of
 * the same row. Clamping to two lines keeps the tail on screen; marking the
 * match tells the reader which words are the reason this row is in the list,
 * which is the thing they are actually scanning for.
 *
 * Matching folds case and diacritics, so "grue a tour" finds "grue à tour".
 * The fold is applied one character at a time and any character whose folded
 * form is not exactly one character is left alone, which keeps the folded
 * array index-for-index with the original and lets a hit be sliced straight
 * out of the source text.
 *
 * This lives in shared/ rather than in a feature because a picker that filters
 * with one comparison and highlights with another shows the user rows with
 * nothing marked on them. `foldForSearch` exists so both halves are the same
 * rule.
 */
import type { ReactNode } from 'react';

// Built from escapes rather than written out, so the combining marks it
// strips cannot be mangled by an editor or a diff that normalises the file.
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

/** Fold one character for comparison, or return it unchanged if folding it
 *  would change how many characters it occupies. */
function foldChar(ch: string): string {
  const folded = ch
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase();
  return Array.from(folded).length === 1 ? folded : ch.toLowerCase();
}

/** Fold a whole string with the same rule `highlightMatch` compares by, so a
 *  filter built on this marks every row it lets through. */
export function foldForSearch(text: string): string {
  return Array.from(text).map(foldChar).join('');
}

/** Index of `needle` in `hay` at or after `from`, both arrays of folded
 *  characters. Plain scan: names are short and a list holds a handful. */
function indexOfFrom(hay: string[], needle: string[], from: number): number {
  if (needle.length === 0) return -1;
  outer: for (let i = from; i <= hay.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Every non-overlapping hit of `needle` in `hay`, as [start, end) pairs. */
function hits(hay: string[], needle: string[]): Array<[number, number]> {
  const found: Array<[number, number]> = [];
  let at = indexOfFrom(hay, needle, 0);
  while (at !== -1) {
    found.push([at, at + needle.length]);
    at = indexOfFrom(hay, needle, at + needle.length);
  }
  return found;
}

/** Merge overlapping or touching ranges so two terms that meet render as one
 *  mark rather than as two abutting ones. */
function merge(ranges: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [start, end] of sorted) {
    const last = out[out.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else out.push([start, end]);
  }
  return out;
}

/**
 * Return `text` with the parts matching `query` wrapped in `<mark>`.
 *
 * The whole query is tried as one phrase first. Only if that is not present do
 * we fall back to its separate terms, because in a French or German position
 * text a one or two letter term like "à" or "im" occurs everywhere and marking
 * each one turns the row into noise. Terms shorter than two characters are
 * dropped from the fallback for the same reason.
 */
export function highlightMatch(text: string, query: string): ReactNode {
  const trimmed = query.trim();
  if (!trimmed || !text) return text;

  const chars = Array.from(text);
  const hay = chars.map(foldChar);

  const phrase = Array.from(trimmed).map(foldChar);
  let ranges = hits(hay, phrase);

  if (ranges.length === 0) {
    const terms = trimmed
      .split(/\s+/)
      .filter((t) => Array.from(t).length >= 2)
      .map((t) => Array.from(t).map(foldChar));
    ranges = merge(terms.flatMap((t) => hits(hay, t)));
  }

  if (ranges.length === 0) return text;

  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], i) => {
    if (start > cursor) parts.push(chars.slice(cursor, start).join(''));
    parts.push(
      <mark
        key={`m${i}`}
        className="bg-transparent font-semibold text-oe-blue underline decoration-oe-blue/40 underline-offset-2"
      >
        {chars.slice(start, end).join('')}
      </mark>,
    );
    cursor = end;
  });
  if (cursor < chars.length) parts.push(chars.slice(cursor).join(''));

  return <>{parts}</>;
}
