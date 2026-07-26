// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Breach has to be derived exactly the way the table's countdown chip derives
// it, or a bar and a chip will disagree about the same ticket. The other trap
// is ageing: a finished ticket that keeps ageing to today would make every
// historic ticket look slower forever.
import { describe, it, expect } from 'vitest';
import { buildServiceInsights } from './serviceInsights';
import type { ServiceTicket } from './api';

/** Mirrors i18next's defaultValue behaviour without pulling in the runtime. */
const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;

const HOUR = 60 * 60 * 1000;
const hoursAgo = (n: number) => new Date(Date.now() - n * HOUR).toISOString();

function ticket(over: Partial<ServiceTicket> = {}): ServiceTicket {
  return {
    id: 'tk1',
    contract_id: 'ct1',
    asset_id: null,
    ticket_number: 'SV-1042',
    title: 'Chiller alarm',
    description: '',
    priority: 'high',
    reported_at: hoursAgo(10),
    sla_due_at: null,
    status: 'in_progress',
    reported_by: null,
    assigned_to: 'user-1',
    resolved_at: null,
    closed_at: null,
    sla_breach_notified_at: null,
    sla_breached_at: null,
    recurring_schedule_id: null,
    metadata: {},
    created_at: hoursAgo(10),
    updated_at: hoursAgo(1),
    ...over,
  } as ServiceTicket;
}

const build = (list: ServiceTicket[]) => buildServiceInsights(list, t);
const row = (over: Partial<ServiceTicket> = {}) => build([ticket(over)]).datasets[0]?.rows[0];

describe('buildServiceInsights', () => {
  it('counts an explicit backend breach stamp', () => {
    expect(row({ sla_breached_at: hoursAgo(2) })?.breached).toBe(1);
  });

  it('counts a live ticket whose SLA date has passed', () => {
    expect(row({ status: 'assigned', sla_due_at: hoursAgo(3) })?.breached).toBe(1);
  });

  it('does not count a live ticket still inside its SLA', () => {
    expect(row({ status: 'assigned', sla_due_at: hoursAgo(-3) })?.breached).toBe(0);
  });

  it.each(['resolved', 'closed', 'cancelled'] as const)(
    'stops a %s ticket flashing overdue forever',
    (status) => {
      // Matches the table chip, which returns null for terminal states. A
      // finished ticket cannot go on missing an SLA it already stopped chasing.
      expect(row({ status, sla_due_at: hoursAgo(50) })?.breached).toBe(0);
    },
  );

  it('still counts a stamped breach on a ticket that later closed', () => {
    // The stamp is a fact about what happened, not about the current state.
    expect(row({ status: 'closed', sla_breached_at: hoursAgo(80) })?.breached).toBe(1);
  });

  it('does not invent a breach for a ticket with no SLA at all', () => {
    expect(row({ sla_due_at: null, sla_breached_at: null })?.breached).toBe(0);
  });

  it('keeps a live ticket ageing to now', () => {
    expect(row({ reported_at: hoursAgo(30), status: 'new' })?.hours_open).toBe(30);
  });

  it('stops a resolved ticket ageing at its resolution', () => {
    const r = row({ status: 'resolved', reported_at: hoursAgo(48), resolved_at: hoursAgo(41) });
    expect(r?.hours_open).toBe(7);
    expect(r?.open).toBe(0);
  });

  it('falls back to the closing time when nothing recorded a resolution', () => {
    const r = row({
      status: 'closed',
      reported_at: hoursAgo(20),
      resolved_at: null,
      closed_at: hoursAgo(12),
    });
    expect(r?.hours_open).toBe(8);
  });

  it('stops a cancelled ticket at cancellation instead of counting it as instant', () => {
    const r = row({
      status: 'cancelled',
      reported_at: hoursAgo(30),
      resolved_at: null,
      closed_at: null,
      updated_at: hoursAgo(25),
    });
    expect(r?.hours_open).toBe(5);
  });

  it('separates planned maintenance from a reactive callout', () => {
    expect(row({ recurring_schedule_id: 'rs1' })?.origin).toBe('Planned maintenance');
    expect(row({ recurring_schedule_id: 'rs1' })?.planned).toBe(1);
    expect(row({ recurring_schedule_id: null })?.origin).toBe('Reactive callout');
    expect(row({ recurring_schedule_id: null })?.planned).toBe(0);
  });

  it('counts an unowned ticket only while it is still live', () => {
    expect(row({ status: 'new', assigned_to: null })?.unassigned).toBe(1);
    // A closed ticket with no assignee is history, not a queue to clear.
    expect(row({ status: 'closed', assigned_to: null })?.unassigned).toBe(0);
    expect(row({ status: 'new', assigned_to: 'user-1' })?.unassigned).toBe(0);
  });

  it.each(['new', 'assigned', 'in_progress'] as const)('treats %s as open', (status) => {
    expect(row({ status })?.open).toBe(1);
  });

  it('labels status and priority with the same keys the table badges use', () => {
    const keyOnly = ((key: string) => key) as never;
    const r = buildServiceInsights([ticket({})], keyOnly).datasets[0]?.rows[0];
    expect(r?.status).toBe('service.ticket_status_in_progress');
    expect(r?.priority).toBe('service.priority_high');
  });

  it('carries no money measure at all', () => {
    // Contracts and work orders hold the money. Mixing a contract value into a
    // per-ticket count would read like revenue and would not be.
    const ds = build([]).datasets[0];
    expect(ds?.currency).toBe('');
    expect(ds?.fields.some((f) => f.format === 'currency')).toBe(false);
    expect(ds?.fields.some((f) => /value|amount|billed|cost/i.test(f.key))).toBe(false);
  });

  it('falls back to a clearly-marked sample on an empty desk', () => {
    expect(build([]).datasets[0]?.sample).toBe(true);
    expect(build([ticket({})]).datasets[0]?.sample).toBe(false);
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

  it('draws every builtin from the sample, so an empty desk is not a blank panel', () => {
    const rows = build([]).datasets[0]?.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const measure of ['open', 'breached', 'unassigned', 'planned', 'hours_open']) {
      const total = rows.reduce((sum, r) => sum + Number(r[measure] ?? 0), 0);
      expect(total, measure).toBeGreaterThan(0);
    }
    // The origin donut needs both slices or it is a circle with one colour.
    expect(new Set(rows.map((r) => r.origin)).size).toBe(2);
    // Breaches must land on more than one priority, or the bar chart says
    // nothing the KPI above it did not already say.
    const hit = new Set(rows.filter((r) => Number(r.breached) > 0).map((r) => r.priority));
    expect(hit.size).toBeGreaterThan(1);
  });
});
