// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Two derivations decide whether "average days with each authority type" is
// honest: a settled cycle must stop ageing at its decision, and a cycle that
// is not yet due must contribute no slip. Both are easy to get wrong in a way
// that flatters the authority.
import { describe, it, expect } from 'vitest';
import { buildReviewAuthorityInsights } from './reviewAuthorityInsights';
import type { ReviewCycle } from './api';

/** Mirrors i18next's defaultValue behaviour without pulling in the runtime. */
const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function cycle(over: Partial<ReviewCycle>): ReviewCycle {
  return {
    id: 'abcdef1234',
    project_id: 'pr1',
    authority_name: 'State expertise board',
    authority_kind: 'state_expertise',
    submission_ref: 'EXP-2026-014',
    pinned_document_version: 'v3',
    current_document_version: 'v3',
    status: 'under_review',
    opened_at: daysAgo(30),
    due_at: daysAgo(-10),
    sla_days: 40,
    jurisdiction: 'Region North',
    notes: '',
    metadata: {},
    created_by: null,
    created_at: daysAgo(30),
    updated_at: daysAgo(2),
    days_remaining: 10,
    overdue: false,
    ...over,
  } as ReviewCycle;
}

function row(c: ReviewCycle) {
  return buildReviewAuthorityInsights([c], t).datasets[0]?.rows[0];
}

describe('buildReviewAuthorityInsights', () => {
  it('keeps a live cycle ageing to today', () => {
    expect(row(cycle({ opened_at: daysAgo(71) }))?.days_open).toBe(71);
  });

  it('stops a settled cycle ageing at its decision, not today', () => {
    const r = row(
      cycle({ status: 'approved', opened_at: daysAgo(120), updated_at: daysAgo(66) }),
    );
    // 120 - 66, not 120. Otherwise every historic approval inflates the
    // authority's average forever.
    expect(r?.days_open).toBe(54);
    expect(r?.open).toBe(0);
  });

  it.each(['approved', 'rejected', 'withdrawn'] as const)(
    'treats %s as no longer chaseable',
    (status) => {
      expect(row(cycle({ status }))?.open).toBe(0);
    },
  );

  it('counts an undecided cycle as still open', () => {
    expect(row(cycle({ status: 'remarks_issued' }))?.open).toBe(1);
  });

  it('records slip only for a cycle the backend marked overdue', () => {
    expect(row(cycle({ overdue: true, days_remaining: -26 }))?.days_late).toBe(26);
  });

  it('contributes no slip for a cycle that is not due yet', () => {
    const r = row(cycle({ overdue: false, days_remaining: 10 }));
    expect(r?.days_late).toBe(0);
    expect(r?.overdue).toBe(0);
  });

  it('flags a cycle being reviewed against a superseded document', () => {
    expect(row(cycle({ pinned_document_version: 'v3', current_document_version: 'v5' }))?.drift).toBe(1);
    expect(row(cycle({ pinned_document_version: 'v5', current_document_version: 'v5' }))?.drift).toBe(0);
  });

  it('does not flag drift when nothing was pinned at submission', () => {
    expect(row(cycle({ pinned_document_version: null, current_document_version: 'v5' }))?.drift).toBe(0);
  });

  it('falls back to the authority type when the body has no name', () => {
    expect(row(cycle({ authority_name: '   ' }))?.authority).toBe('State expertise');
  });

  it('labels status and kind with the same keys the list row badges use', () => {
    const keyOnly = ((key: string) => key) as never;
    const built = buildReviewAuthorityInsights([cycle({})], keyOnly);
    const r = built.datasets[0]?.rows[0];
    expect(r?.status).toBe('review_authority.cycle_status_under_review');
    expect(r?.kind).toBe('review_authority.authority_kind_state_expertise');
  });

  it('names a submission with no reference rather than leaving the bar blank', () => {
    expect(row(cycle({ submission_ref: null }))?.submission).toBe('abcdef12');
  });

  it('draws nothing at all on an empty project', () => {
    expect(buildReviewAuthorityInsights([], t).datasets[0]?.rows).toHaveLength(0);
    expect(buildReviewAuthorityInsights([cycle({})], t).datasets[0]?.rows).toHaveLength(1);
  });

  it('exposes no currency-formatted measure, because a review cycle carries no money', () => {
    const ds = buildReviewAuthorityInsights([], t).datasets[0];
    expect(ds?.currency).toBe('');
    expect(ds?.fields.some((f) => f.format === 'currency')).toBe(false);
  });
});
