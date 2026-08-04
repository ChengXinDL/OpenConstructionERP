// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The key builder for validation-finding lists.
//
// Tested here rather than only through the two lists that call it, because the
// bug it fixes was written twice — once in each list — and a test hung off one
// caller would have graded whichever copy happened to be right. One function,
// one place the rule lives, one set of cases.

import { describe, it, expect } from 'vitest';

import { findingKeys, type KeyableFinding } from './findingKeys';

// The EOT rule, because it is the reachable collision: it derives element_ref
// from the claim's id and falls back to the empty string, which the old key's
// `?? i` treats as a present reference.
function finding(over: Partial<KeyableFinding> = {}): KeyableFinding {
  return {
    rule_id: 'contracts.eot_days_valid',
    element_ref: '',
    message: 'EOT 3 grants 9 day(s) but only 4 claimed',
    ...over,
  };
}

describe('findingKeys', () => {
  it('separates two findings that name one rule and one element', () => {
    // The shape that used to collide: one rule, one element, two things wrong
    // with it. The old key was rule id plus element ref, so both rows got the
    // same string and React dropped one of them.
    const keys = findingKeys([
      finding(),
      finding({ message: 'EOT 5 grants 20 day(s) but only 12 claimed' }),
    ]);

    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it('is stable when a row is inserted above it', () => {
    // The reason the index is not the answer. A finding that has not changed
    // must keep its key when the list around it grows, or React tears down and
    // remounts rows that were never touched.
    const first = finding();
    const second = finding({ message: 'EOT 5 grants 20 day(s) but only 12 claimed' });
    const before = findingKeys([first, second]);
    const after = findingKeys([
      finding({
        rule_id: 'contracts.parties_complete',
        element_ref: 'c-1',
        message: 'Contract names 0 of the 2 parties that sign it',
      }),
      first,
      second,
    ]);

    expect(after.slice(1)).toEqual(before);
  });

  it('still separates findings that are identical in every field', () => {
    // Nothing emits this today. It is covered because "every field" is only
    // every field for the rules that exist now, and a duplicate key is a
    // silently dropped row rather than a visible failure.
    const keys = findingKeys([finding(), finding(), finding()]);

    expect(new Set(keys).size).toBe(3);
  });

  it('separates findings that differ only by element reference', () => {
    const keys = findingKeys([
      finding({ rule_id: 'contracts.eot_days_valid', element_ref: 'eot-1' }),
      finding({ rule_id: 'contracts.eot_days_valid', element_ref: 'eot-2' }),
    ]);

    expect(new Set(keys).size).toBe(2);
  });

  it('separates a null element reference from an empty one, by the counter', () => {
    // These two flatten to the same base string, deliberately: a reference the
    // backend left null and one it sent as "" are the same absence, and coining
    // a difference between them would be inventing information. What keeps the
    // rows apart is the repeat counter, which is the whole reason it is there.
    const keys = findingKeys([
      finding({ element_ref: null }),
      finding({ element_ref: '' }),
    ]);

    expect(new Set(keys).size).toBe(2);
  });

  it('returns one key per finding, in order', () => {
    const findings = [finding(), finding({ message: 'b' }), finding({ message: 'c' })];
    const keys = findingKeys(findings);

    expect(keys).toHaveLength(findings.length);
    expect(keys[1]).toContain('b');
  });

  it('returns nothing for an empty list', () => {
    expect(findingKeys([])).toEqual([]);
  });
});
