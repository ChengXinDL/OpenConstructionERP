// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Issue #407 — the BOQ editor's "add section" dialog offered the browser's
// saved payment data over a chapter-name field.
//
// The dialog is not inside a <form> and the input carried no `name`, no `id`
// and no `autocomplete`, so the browser grouped it page-wide and let its
// payment heuristics classify it. A user typing a chapter name was one click
// away from pasting a card number into a cost document.
//
// This is a source-level guard, not a behavioural test, and the distinction
// matters. BOQEditorPage is ~5800 lines behind a router, several stores and a
// dozen queries; rendering it to read one attribute would mean extracting the
// dialog, which is a larger change than the defect warrants. No unit test can
// prove what Chrome's heuristics do in any case. What this pins is that the
// three attributes which suppress the heuristic stay on the element.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const SOURCE = readFileSync(
  resolve(__dirname, '..', 'BOQEditorPage.tsx'),
  'utf-8',
);

/** The single <input …/> element bound to `sectionNameInput`. */
function sectionNameInputTag(): string {
  const bindings = [...SOURCE.matchAll(/<input\b[\s\S]*?\/>/g)]
    .map((m) => m[0] ?? '')
    .filter((tag) => tag.includes('value={sectionNameInput}'));

  // If the dialog is ever duplicated, this test should be updated to cover
  // both rather than silently checking the first one.
  expect(bindings).toHaveLength(1);
  return bindings[0] ?? '';
}

describe('BOQ add-section dialog - browser autofill (#407)', () => {
  it('declares autoComplete="off" on the section name input', () => {
    expect(sectionNameInputTag()).toContain('autoComplete="off"');
  });

  it('gives the input a stable name and id so it is not grouped page-wide', () => {
    const tag = sectionNameInputTag();
    expect(tag).toMatch(/\bid="boq-section-name"/);
    expect(tag).toMatch(/\bname="boq-section-name"/);
  });

  it('gives the input an accessible name from i18n, not a literal', () => {
    const tag = sectionNameInputTag();
    expect(tag).toMatch(/aria-label=\{t\(/);
    // A hardcoded English aria-label would ship untranslated to 26 locales.
    expect(tag).not.toMatch(/aria-label="[^"]+"/);
  });

  it('never claims a payment token or a malformed section token', () => {
    const value = sectionNameInputTag().match(/autoComplete="([^"]*)"/)?.[1];

    // `section-name` is malformed: the `section-*` prefix must be followed by
    // a field token ("section-billing given-name"), so a browser discards it
    // and falls back to the very heuristics we are suppressing. The cc-* set
    // would ask for the payment autofill the reporter saw.
    expect(value).toBe('off');
    expect(['cc-number', 'cc-name', 'cc-exp', 'cc-csc', 'section-name']).not.toContain(
      value,
    );
  });
});
