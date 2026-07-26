// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// "Average slip by source module" is only honest if work that is not yet due
// contributes nothing. The backend sends a negative days_overdue for an item
// due next week, and averaging that in would make a late register look calm.
import { describe, it, expect } from 'vitest';
import { buildDeadlinesInsights } from './deadlinesInsights';
import type { DeadlineItem } from './api';

/** Mirrors i18next's defaultValue behaviour without pulling in the runtime. */
const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;

function item(over: Partial<DeadlineItem>): DeadlineItem {
  return {
    id: 'd1',
    module: 'punchlist',
    entity_type: 'punch_item',
    entity_id: 'p1',
    project_id: 'pr1',
    project_name: 'Demo',
    title: 'Fire door closer not self-latching',
    due_date: '2026-07-01',
    owner_user_id: null,
    owner_name: 'Site manager',
    status: 'open',
    classification: 'overdue',
    days_overdue: 12,
    severity: 'critical',
    action_url: '/punchlist',
    ...over,
  };
}

function rows(items: DeadlineItem[]) {
  return buildDeadlinesInsights(items, t).datasets[0]?.rows ?? [];
}

describe('buildDeadlinesInsights', () => {
  it('records slip for genuinely late work', () => {
    expect(rows([item({ days_overdue: 12 })])[0]?.days_late).toBe(12);
    expect(rows([item({ days_overdue: 12 })])[0]?.overdue).toBe(1);
  });

  it('zeroes slip for work that is not due yet instead of averaging a negative', () => {
    const r = rows([item({ days_overdue: -6, classification: 'approaching' })])[0];
    expect(r?.days_late).toBe(0);
    expect(r?.overdue).toBe(0);
    expect(r?.approaching).toBe(1);
  });

  it('so the module average reflects the late items only', () => {
    const built = rows([item({ days_overdue: 10 }), item({ days_overdue: -10 })]);
    const total = built.reduce((n, r) => n + Number(r.days_late), 0);
    // Not 0, which is what a raw average of +10 and -10 would have produced.
    expect(total).toBe(10);
  });

  it('labels the source module with the same key the register groups by', () => {
    // Resolve to the key rather than the fallback, so this pins the key the
    // helper asks for against the one MODULE_LABELS uses on the page.
    const keyOnly = ((key: string) => key) as never;
    const built = buildDeadlinesInsights([item({ module: 'qms_ncr_action' })], keyOnly);
    expect(built.datasets[0]?.rows[0]?.module).toBe('deadlines.module.qms_ncr_action');
  });

  it('humanises a module code that has no key of its own', () => {
    expect(rows([item({ module: 'qms_ncr_action' })])[0]?.module).toBe('Qms ncr action');
  });

  it('names an owner-less item rather than leaving the bar blank', () => {
    expect(rows([item({ owner_name: '  ' })])[0]?.owner).toBe('Unassigned');
  });

  it('falls back to a clearly-marked sample on an empty register', () => {
    expect(buildDeadlinesInsights([], t).datasets[0]?.sample).toBe(true);
    expect(buildDeadlinesInsights([item({})], t).datasets[0]?.sample).toBe(false);
  });

  it('exposes no currency-formatted measure, because a deadline carries no money', () => {
    const ds = buildDeadlinesInsights([], t).datasets[0];
    expect(ds?.currency).toBe('');
    expect(ds?.fields.some((f) => f.format === 'currency')).toBe(false);
  });
});
