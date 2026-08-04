// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The two things this builder must refuse are easier to get wrong than right.
// A sheet's page_number looks like a number and is not one you may add up, and
// revision_date is null on most rows of a real drawing set, so a time series
// grounded on it would file the majority of the register into one empty bucket.
import { describe, it, expect } from 'vitest';
import { buildSheetsInsights } from './sheetsInsights';
import type { SheetRow } from './types';

/** Mirrors i18next's defaultValue plus `{{var}}` interpolation, without pulling
 *  in the runtime. Interpolation matters here: the page label is a real
 *  placeholder key, and a stub that returned the raw template would let a
 *  builder that forgot to pass the value through pass this suite. */
const t = ((key: string, opts?: Record<string, unknown>) => {
  const raw = (opts?.defaultValue as string) ?? key;
  return raw.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    opts && name in opts ? String(opts[name]) : whole,
  );
}) as never;

function sheet(over: Partial<SheetRow>): SheetRow {
  return {
    id: 's1',
    project_id: 'pr1',
    document_id: 'doc-1',
    page_number: 7,
    sheet_number: 'A-101',
    sheet_title: 'Ground Floor Plan',
    discipline: 'Architectural',
    revision: 'C',
    revision_date: null,
    scale: '1:100',
    is_current: true,
    previous_version_id: null,
    thumbnail_path: null,
    metadata: {},
    created_by: 'u1',
    created_at: '2026-03-14T10:00:00Z',
    updated_at: '2026-03-14T10:00:00Z',
    ...over,
  };
}

function rows(sheets: SheetRow[]) {
  return buildSheetsInsights(sheets, t).datasets[0]?.rows ?? [];
}

describe('buildSheetsInsights', () => {
  it('counts a current sheet as current and not as superseded', () => {
    const r = rows([sheet({ is_current: true })])[0];
    expect(r?.current).toBe(1);
    expect(r?.superseded).toBe(0);
  });

  it('counts a superseded sheet the other way round', () => {
    const r = rows([sheet({ is_current: false })])[0];
    expect(r?.current).toBe(0);
    expect(r?.superseded).toBe(1);
  });

  it('never exposes page_number as a measure, because summing page numbers is meaningless', () => {
    const ds = buildSheetsInsights([sheet({})], t).datasets[0];
    const measures = ds?.fields.filter((f) => f.kind === 'measure').map((f) => f.key) ?? [];
    expect(measures).not.toContain('page_number');
    expect(measures).not.toContain('page');
    // And the row does not smuggle it in under another name either.
    expect(Object.values(rows([sheet({ page_number: 7 })])[0] ?? {})).not.toContain(7);
  });

  it('buckets the time series on created_at, not the mostly-null revision_date', () => {
    // Indexed in March, revised in December. A month built on revision_date
    // would say 2026-12; the register is asking when the page was indexed.
    const r = rows([
      sheet({ created_at: '2026-03-14T10:00:00Z', revision_date: '2026-12-01T00:00:00Z' }),
    ])[0];
    expect(r?.month).toBe('2026-03');
  });

  it('keeps a sheet with no revision_date in a real month rather than a null bucket', () => {
    expect(rows([sheet({ revision_date: null })])[0]?.month).toBe('2026-03');
  });

  it('files the nullable dimensions under one shared bucket instead of blank slices', () => {
    const r = rows([sheet({ discipline: null, revision: null, scale: '   ' })])[0];
    expect(r?.discipline).toBe('Not set');
    expect(r?.revision).toBe('Not set');
    expect(r?.scale).toBe('Not set');
    expect(r?.revised).toBe(0);
  });

  it('labels a sheet with no number by the page it was lifted from', () => {
    expect(rows([sheet({ sheet_number: null, sheet_title: null, page_number: 4 })])[0]?.sheet).toBe(
      'Page 4',
    );
  });

  it('reuses the table column keys for the status slices so chart and cell agree', () => {
    // Resolve to the key rather than the fallback, so this pins the key the
    // builder asks for against the one the table's Current? column uses.
    const keyOnly = ((key: string) => key) as never;
    const built = buildSheetsInsights([sheet({ is_current: false })], keyOnly);
    expect(built.datasets[0]?.rows[0]?.status).toBe('sheets.is_current_no');
  });

  it('orders rows oldest first so the time series reads chronologically', () => {
    const built = rows([
      sheet({ id: 'b', created_at: '2026-05-01T00:00:00Z' }),
      sheet({ id: 'a', created_at: '2026-01-01T00:00:00Z' }),
    ]);
    expect(built.map((r) => r.month)).toEqual(['2026-01', '2026-05']);
  });

  it('draws nothing at all on an empty register', () => {
    expect(buildSheetsInsights([], t).datasets[0]?.rows).toHaveLength(0);
    expect(buildSheetsInsights([sheet({})], t).datasets[0]?.rows).toHaveLength(1);
  });

  it('exposes no currency-formatted measure, because a drawing sheet carries no money', () => {
    const ds = buildSheetsInsights([sheet({})], t).datasets[0];
    expect(ds?.currency).toBe('');
    expect(ds?.fields.some((f) => f.format === 'currency')).toBe(false);
    const kpis = buildSheetsInsights([sheet({})], t).builtins.filter((b) => b.chart === 'kpi');
    expect(kpis.length).toBeGreaterThan(0);
    // Every KPI measure resolves to a field this dataset declares as a number.
    for (const k of kpis) {
      if (!k.measure) continue;
      const f = ds?.fields.find((x) => x.key === k.measure);
      expect(f?.format).toBe('number');
    }
  });
});
