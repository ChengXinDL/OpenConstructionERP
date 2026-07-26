// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The point of this panel is the difference between "we have a file" and
// "someone confirmed it is the right file". If bound ever counts as verified,
// or an empty optional item counts as a gap, the numbers go quiet in the
// direction that makes the pack look ready when it is not.
import { describe, it, expect } from 'vitest';
import { buildCloseoutInsights } from './closeoutInsights';
import type { CloseoutBinding, CloseoutSlot, SlotStatus } from './api';

/** Mirrors i18next's defaultValue behaviour without pulling in the runtime. */
const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;

function binding(over: Partial<CloseoutBinding> = {}): CloseoutBinding {
  return {
    id: 'bd1',
    slot_id: 'sl1',
    document_id: 'doc1',
    document_name: 'As-built set rev C',
    external_url: null,
    is_verified: false,
    verified_by: null,
    verified_at: null,
    suggested_by_ai: false,
    ai_confidence: null,
    metadata: {},
    created_at: null,
    ...over,
  };
}

function slot(over: Partial<CloseoutSlot> = {}): CloseoutSlot {
  return {
    id: 'sl1',
    package_id: 'pk1',
    slot_key: 'as_built_arch',
    title: 'As-built drawings, architectural',
    category: 'as_built',
    discipline: 'Architectural',
    is_required: true,
    source_kind: 'cde_document',
    generated_artifact: null,
    ordinal: 1,
    metadata: {},
    status: 'empty',
    binding: null,
    ...over,
  };
}

const build = (list: CloseoutSlot[]) => buildCloseoutInsights(list, t);
const rowsOf = (list: CloseoutSlot[]) => build(list).datasets[0]?.rows ?? [];
const row = (over: Partial<CloseoutSlot> = {}) => rowsOf([slot(over)])[0];

describe('buildCloseoutInsights', () => {
  it('counts a required empty item as a gap', () => {
    expect(row({ is_required: true, status: 'empty' })?.missing).toBe(1);
  });

  it('does not count an empty optional item as a gap', () => {
    // Leaving an optional item out is a decision, not a hole. Counting it
    // would pad every chase list with work nobody owes.
    expect(row({ is_required: false, status: 'empty' })?.missing).toBe(0);
  });

  it.each(['bound', 'verified'] as const)('stops calling a %s item missing', (status) => {
    expect(row({ status })?.missing).toBe(0);
  });

  it('separates a document being attached from someone having checked it', () => {
    const bound = row({ status: 'bound', binding: binding() });
    expect(bound?.unverified).toBe(1);
    expect(bound?.delivered).toBe(1);

    const verified = row({ status: 'verified', binding: binding({ is_verified: true }) });
    expect(verified?.unverified).toBe(0);
    expect(verified?.delivered).toBe(1);
  });

  it('does not count an empty item as attached', () => {
    const r = row({ status: 'empty' });
    expect(r?.unverified).toBe(0);
    expect(r?.delivered).toBe(0);
  });

  it('flags a binding the AI proposed and nobody confirmed', () => {
    expect(row({ status: 'bound', binding: binding({ suggested_by_ai: true }) })?.ai_unchecked).toBe(1);
  });

  it('clears the AI flag once a human has verified the suggestion', () => {
    // Verified is verified, regardless of who proposed it. Leaving the flag on
    // would make a reviewed pack look permanently unreviewed.
    const r = row({
      status: 'verified',
      binding: binding({ suggested_by_ai: true, is_verified: true }),
    });
    expect(r?.ai_unchecked).toBe(0);
  });

  it('does not flag a binding a person made themselves', () => {
    expect(row({ status: 'bound', binding: binding({ suggested_by_ai: false }) })?.ai_unchecked).toBe(0);
  });

  it('survives a bound slot whose binding did not come through', () => {
    // status and binding are sent separately, so they can disagree on the wire.
    expect(row({ status: 'bound', binding: null })?.ai_unchecked).toBe(0);
    expect(row({ status: 'bound', binding: null })?.unverified).toBe(1);
  });

  it('names an item with no discipline instead of grouping it under blank', () => {
    // Several handover items genuinely belong to no single discipline.
    expect(row({ discipline: null })?.discipline).toBe('Not discipline specific');
    expect(row({ discipline: '   ' })?.discipline).toBe('Not discipline specific');
  });

  it('labels category and status with the same keys the checklist uses', () => {
    const keyOnly = ((key: string) => key) as never;
    const r = buildCloseoutInsights([slot({ status: 'bound' })], keyOnly).datasets[0]?.rows[0];
    expect(r?.category).toBe('closeout.category.as_built');
    expect(r?.status).toBe('closeout.status.bound');
  });

  it('keeps the checklist order rather than the order the server happened to send', () => {
    const rows = rowsOf([
      slot({ id: 'c', title: 'Third', ordinal: 3 }),
      slot({ id: 'a', title: 'First', ordinal: 1 }),
      slot({ id: 'b', title: 'Second', ordinal: 2 }),
    ]);
    expect(rows.map((r) => r.slot)).toEqual(['First', 'Second', 'Third']);
  });

  it('separates required from optional as a groupable dimension', () => {
    expect(row({ is_required: true })?.obligation).toBe('Required');
    expect(row({ is_required: false })?.obligation).toBe('Optional');
  });

  it('falls back to a clearly-marked sample when there is no package yet', () => {
    expect(build([]).datasets[0]?.sample).toBe(true);
    expect(build([slot()]).datasets[0]?.sample).toBe(false);
  });

  it('exposes no currency-formatted measure, because a handover item carries no money', () => {
    const ds = build([]).datasets[0];
    expect(ds?.currency).toBe('');
    expect(ds?.fields.some((f) => f.format === 'currency')).toBe(false);
  });

  it('points every builtin at a dataset and a field that exist', () => {
    // datasetId, measure and dimension are plain strings, so a typo here is
    // invisible to both tsc and the renderer: the chart just draws nothing.
    const { datasets, builtins } = build([]);
    const ids = new Set(datasets.map((d) => d.id));
    const keys = new Set(datasets.flatMap((d) => d.fields.map((f) => f.key)));
    for (const b of builtins) {
      expect(ids, `${b.id} dataset`).toContain(b.datasetId);
      if (b.measure) expect(keys, `${b.id} measure`).toContain(b.measure);
      if (b.dimension) expect(keys, `${b.id} dimension`).toContain(b.dimension);
    }
    expect(new Set(builtins.map((b) => b.id)).size).toBe(builtins.length);
  });

  it('draws every builtin from the sample, so an empty package is not a blank panel', () => {
    const rows = build([]).datasets[0]?.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const measure of ['missing', 'unverified', 'ai_unchecked', 'delivered']) {
      const total = rows.reduce((sum, r) => sum + Number(r[measure] ?? 0), 0);
      expect(total, measure).toBeGreaterThan(0);
    }
    // The two bar charts need more than one bucket each or they are just a KPI
    // with extra steps.
    for (const dimension of ['discipline', 'source']) {
      const buckets = new Set(rows.filter((r) => Number(r.missing) > 0).map((r) => r[dimension]));
      expect(buckets.size, dimension).toBeGreaterThan(1);
    }
  });

  it('keeps the sample honest about the status vocabulary it claims to show', () => {
    const statuses = new Set(build([]).datasets[0]?.rows.map((r) => r.status));
    const expected: SlotStatus[] = ['empty', 'bound', 'verified'];
    expect(statuses.size).toBe(expected.length);
  });
});
