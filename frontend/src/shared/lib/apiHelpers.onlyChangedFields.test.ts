// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// `onlyChangedFields` decides what goes into a PATCH body. Getting it wrong in
// one direction sends a field nobody edited and reverts a colleague's work;
// getting it wrong in the other drops a field the caller meant to write and the
// save quietly does less than it said it did. Neither shows an error.
//
// The per-page tests next to the forms cover the ordinary case. These cover the
// helper's own edges, which no single page exercises: keys the form does not
// hold, values that are falsy but deliberate, and reference types.

import { describe, it, expect } from 'vitest';

import { onlyChangedFields } from './apiHelpers';

describe('onlyChangedFields', () => {
  it('drops a field the user never touched', () => {
    const base = { title: 'Kickoff', notes: 'Nothing yet' };
    const form = { ...base, title: 'Kickoff meeting' };

    expect(onlyChangedFields({ title: form.title, notes: form.notes }, form, base)).toEqual({
      title: 'Kickoff meeting',
    });
  });

  it('sends a payload key the form has no field for', () => {
    // A body is not always a mirror of the form. Ids and values derived from
    // elsewhere on the page have nothing to compare against, and `undefined`
    // against `undefined` reads as untouched, so a naive diff removes them.
    const base = { title: 'Kickoff' };
    const form = { ...base, title: 'Kickoff meeting' };

    const patch = onlyChangedFields(
      { title: form.title, project_id: 'p1', revision: 4 },
      form,
      base,
    );

    expect(patch).toEqual({ title: 'Kickoff meeting', project_id: 'p1', revision: 4 });
  });

  it('sends an unmatched key even when nothing on the form changed', () => {
    const base = { title: 'Kickoff' };

    expect(onlyChangedFields({ title: base.title, project_id: 'p1' }, base, base)).toEqual({
      project_id: 'p1',
    });
  });

  it('keeps a field whose base value is explicitly undefined but present', () => {
    // `in` distinguishes an absent key from one holding `undefined`. A form
    // field initialized to `undefined` and then filled in is an edit.
    const base: { note?: string } = { note: undefined };
    const form: { note?: string } = { note: 'filled in' };

    expect(onlyChangedFields({ note: form.note }, form, base)).toEqual({ note: 'filled in' });
  });

  it('reports no change when a present-but-undefined field is left alone', () => {
    const base: { note?: string } = { note: undefined };

    expect(onlyChangedFields({ note: base.note }, base, base)).toEqual({});
  });

  it('carries falsy edits that a truthiness check would swallow', () => {
    const base = { count: 3, enabled: true, label: 'x' };
    const form = { count: 0, enabled: false, label: '' };

    expect(onlyChangedFields({ count: form.count, enabled: form.enabled, label: form.label }, form, base)).toEqual(
      { count: 0, enabled: false, label: '' },
    );
  });

  it('does not treat a value equal to itself as a change', () => {
    const base = { amount: '12500.00' };
    const form = { amount: '12500.00' };

    expect(onlyChangedFields({ amount: form.amount }, form, base)).toEqual({});
  });

  it('compares by identity, so a rebuilt array or object counts as edited', () => {
    // Deliberate, and the safe direction: a fresh array on every render is
    // sent rather than dropped. Callers that want value semantics must keep
    // the reference stable, which is what the form initializers already do.
    const tags = ['a', 'b'];
    const base = { tags };
    const untouched = { tags };
    const rebuilt = { tags: ['a', 'b'] };

    expect(onlyChangedFields({ tags: untouched.tags }, untouched, base)).toEqual({});
    expect(onlyChangedFields({ tags: rebuilt.tags }, rebuilt, base)).toEqual({ tags: ['a', 'b'] });
  });

  it('returns an empty body when a form is opened and saved untouched', () => {
    const base = { title: 'Kickoff', notes: 'Nothing yet', due: '' };

    expect(onlyChangedFields({ title: base.title, notes: base.notes, due: base.due || null }, base, base)).toEqual(
      {},
    );
  });
});
