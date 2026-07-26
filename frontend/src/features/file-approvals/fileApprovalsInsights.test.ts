// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The "waiting on which approver" chart is the one people act on, so the two
// derivations behind it are pinned here: who the ball is with, and how long a
// submission has been sitting.
import { describe, it, expect } from 'vitest';
import { buildFileApprovalsInsights } from './fileApprovalsInsights';
import type { ApprovalWorkflow } from './types';

/** Mirrors i18next's defaultValue behaviour without pulling in the runtime. */
const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function workflow(over: Partial<ApprovalWorkflow>): ApprovalWorkflow {
  return {
    id: 'w1',
    file_id: 'f1',
    file_kind: 'sheet',
    status: 'in_review',
    submitted_at: daysAgo(10),
    final_decision_at: null,
    steps: [],
    ...over,
  } as ApprovalWorkflow;
}

function step(sort_order: number, decision: string, role_label?: string) {
  return { id: `s${sort_order}`, sort_order, decision, role_label, approver_id: 'abcdef1234' };
}

/** Pull one row's cell out of the single dataset the builder returns. */
function cell(w: ApprovalWorkflow[], key: string) {
  const { datasets } = buildFileApprovalsInsights(w, t);
  return datasets[0]?.rows[0]?.[key];
}

describe('buildFileApprovalsInsights', () => {
  it('attributes an open workflow to the lowest-sort-order pending step', () => {
    const w = workflow({
      steps: [
        step(2, 'pending', 'Structural engineer'),
        step(0, 'approved', 'Design manager'),
        step(1, 'pending', 'Lead architect'),
      ],
    } as Partial<ApprovalWorkflow>);
    // Not the first in array order and not the last pending: the earliest
    // still-open step is who the file is actually waiting on.
    expect(cell([w], 'approver')).toBe('Lead architect');
  });

  it('falls back to a short approver id when the step carries no role label', () => {
    const w = workflow({ steps: [step(0, 'pending', '   ')] } as Partial<ApprovalWorkflow>);
    expect(cell([w], 'approver')).toBe('abcdef12');
  });

  it('does not blame an approver for a workflow that is already decided', () => {
    const w = workflow({
      status: 'approved',
      final_decision_at: daysAgo(8),
      steps: [step(0, 'pending', 'Lead architect')],
    } as Partial<ApprovalWorkflow>);
    expect(cell([w], 'approver')).toBe('Decided');
    expect(cell([w], 'open')).toBe(0);
  });

  it('measures a settled workflow to its decision, not to today', () => {
    const w = workflow({
      status: 'approved',
      submitted_at: daysAgo(30),
      final_decision_at: daysAgo(28),
    });
    expect(cell([w], 'days')).toBe(2);
  });

  it('keeps an open workflow ageing so a stale submission looks worse each week', () => {
    expect(cell([workflow({ submitted_at: daysAgo(23) })], 'days')).toBe(23);
  });

  it('marks the dataset as sample only when there is nothing real to show', () => {
    expect(buildFileApprovalsInsights([], t).datasets[0]?.sample).toBe(true);
    expect(buildFileApprovalsInsights([workflow({})], t).datasets[0]?.sample).toBe(false);
  });

  it('exposes no currency-formatted measure, because an approval carries no money', () => {
    const ds = buildFileApprovalsInsights([], t).datasets[0];
    expect(ds?.currency).toBe('');
    expect(ds?.fields.some((f) => f.format === 'currency')).toBe(false);
  });
});
