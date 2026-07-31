// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// This dataset is built at line level, not sheet level, because cost code and
// daywork live on the line. The sheet's date and status have to come down onto
// each line for the time series and the "awaiting approval" figure to work.
import { describe, it, expect } from 'vitest';
import { buildFieldTimeInsights } from './fieldTimeInsights';
import type { FieldTimesheet } from './api';

/** Mirrors i18next's defaultValue behaviour without pulling in the runtime. */
const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;

function line(over: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    timesheet_id: 'ts1',
    kind: 'labour',
    cost_code: '03-100 Concrete frame',
    is_daywork: false,
    hours: '8.00',
    ...over,
  };
}

function sheet(over: Partial<FieldTimesheet>): FieldTimesheet {
  return {
    id: 'ts1',
    project_id: 'pr1',
    reference: 'TS-0105',
    date: '2026-07-13',
    status: 'approved',
    lines: [line()],
    metadata: {},
    ...over,
  } as FieldTimesheet;
}

function rows(sheets: FieldTimesheet[]) {
  return buildFieldTimeInsights(sheets, t).datasets[0]?.rows ?? [];
}

describe('buildFieldTimeInsights', () => {
  it('emits one row per line, not per sheet', () => {
    const s = sheet({ lines: [line(), line({ id: 'l2' }), line({ id: 'l3' })] as never });
    expect(rows([s])).toHaveLength(3);
  });

  it('carries the sheet date and status down onto each line', () => {
    const r = rows([sheet({ date: '2026-07-13', status: 'submitted' })])[0];
    expect(r?.month).toBe('2026-07');
    expect(r?.status).toBe('Submitted');
  });

  it('parses decimal-string hours instead of concatenating them', () => {
    expect(rows([sheet({ lines: [line({ hours: '8.50' })] as never })])[0]?.hours).toBe(8.5);
  });

  it('does not poison a sum when hours are missing or unparseable', () => {
    expect(rows([sheet({ lines: [line({ hours: null })] as never })])[0]?.hours).toBe(0);
  });

  it('splits daywork off measured work, because they are recovered differently', () => {
    const dw = rows([sheet({ lines: [line({ is_daywork: true, hours: '14' })] as never })])[0];
    expect(dw?.daywork).toBe(14);
    expect(dw?.daywork_flag).toBe('Daywork');
    const mw = rows([sheet({ lines: [line({ is_daywork: false, hours: '14' })] as never })])[0];
    expect(mw?.daywork).toBe(0);
    expect(mw?.daywork_flag).toBe('Measured work');
  });

  it('counts draft and submitted hours as awaiting approval', () => {
    expect(rows([sheet({ status: 'draft' })])[0]?.unapproved).toBe(8);
    expect(rows([sheet({ status: 'submitted' })])[0]?.unapproved).toBe(8);
  });

  it('does not count approved or reversed hours as awaiting approval', () => {
    expect(rows([sheet({ status: 'approved' })])[0]?.unapproved).toBe(0);
    expect(rows([sheet({ status: 'reversed' } as Partial<FieldTimesheet>)])[0]?.unapproved).toBe(0);
  });

  it('names an uncoded line rather than leaving the bar blank', () => {
    expect(rows([sheet({ lines: [line({ cost_code: '  ' })] as never })])[0]?.cost_code).toBe(
      'No cost code',
    );
  });

  it('draws nothing when a project has sheets but no booked lines', () => {
    expect(buildFieldTimeInsights([sheet({ lines: [] })], t).datasets[0]?.rows).toHaveLength(0);
    expect(
      buildFieldTimeInsights([sheet({})], t).datasets[0]?.rows.length,
    ).toBeGreaterThan(0);
  });

  it('exposes no currency-formatted measure, because a line carries no rate', () => {
    const ds = buildFieldTimeInsights([], t).datasets[0];
    expect(ds?.currency).toBe('');
    expect(ds?.fields.some((f) => f.format === 'currency')).toBe(false);
  });
});
