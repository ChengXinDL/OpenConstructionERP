// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The chip is tested through computeSlaChip rather than through the span helper
// it calls. The helper was always right; the bug was that the overdue branch
// never called it and printed the raw minute count instead. A test on the helper
// alone would have passed both before and after the fix and gated nothing.
import { describe, it, expect } from 'vitest';
import { computeSlaChip } from './ServicePage';
import type { ServiceTicket } from './api';

const NOW = Date.parse('2026-03-01T12:00:00.000Z');

function ticket(over: Partial<ServiceTicket> = {}): ServiceTicket {
  return {
    id: 'tk1',
    ticket_number: 'SV-1042',
    title: 'Chiller alarm',
    status: 'in_progress',
    priority: 'high',
    sla_due_at: null,
    sla_breached_at: null,
    ...over,
  } as ServiceTicket;
}

/** Positive minutes are headroom, negative are how far past due the ticket is. */
function chip(minutes: number, over: Partial<ServiceTicket> = {}) {
  const due = new Date(NOW + minutes * 60000).toISOString();
  return computeSlaChip(ticket({ sla_due_at: due, ...over }), NOW);
}

// The value that started this: a ticket this far past due announced itself on a
// dispatcher's screen as "34610m late".
const LONG_BREACH = -34610;

const OVERDUE: Array<[number, string]> = [
  [LONG_BREACH, '24d late'],
  [-100000, '69d late'],
  [-1440, '1d late'],
  [-1439, '24h late'],
  [-60, '1h late'],
  [-59, '59m late'],
  [-1, '1m late'],
  // Exactly on the deadline takes the overdue branch, as it always has.
  [0, '0m late'],
];

const HEADROOM: Array<[number, string, string]> = [
  [1, '1m', 'warning'],
  [59, '59m', 'warning'],
  [60, '1h', 'success'],
  // 1439 reads as 24h and 1440 as 1d, which is odd read side by side but is
  // what this branch has always done. Pinned so a later tidy-up is a decision
  // rather than an accident.
  [1439, '24h', 'success'],
  [1440, '1d', 'success'],
];

describe('computeSlaChip', () => {
  it('states a long breach in a unit someone would say out loud', () => {
    expect(chip(LONG_BREACH)?.label).toBe('24d late');
  });

  for (const [minutes, expected] of OVERDUE) {
    it(`labels ${-minutes} minutes past due as ${expected}`, () => {
      const c = chip(minutes);
      expect(c?.label).toBe(expected);
      expect(c?.variant).toBe('error');
      expect(c?.minutes).toBe(minutes);
    });
  }

  it('never prints a raw minute count once a breach passes an hour', () => {
    for (const [minutes] of OVERDUE) {
      if (minutes > -60) continue;
      expect(chip(minutes)?.label, `${minutes} minutes`).not.toMatch(/\d{3,}m/);
    }
  });

  for (const [minutes, expected, variant] of HEADROOM) {
    it(`labels ${minutes} minutes of headroom as ${expected}`, () => {
      const c = chip(minutes);
      expect(c?.label).toBe(expected);
      expect(c?.variant).toBe(variant);
    });
  }

  it('reads a stamped breach ahead of any remaining headroom', () => {
    const c = chip(600, { sla_breached_at: '2026-02-27T09:00:00.000Z' });
    expect(c?.label).toBe('Breached');
    expect(c?.variant).toBe('error');
  });

  it('draws no chip for a ticket that was never given an SLA', () => {
    expect(computeSlaChip(ticket(), NOW)).toBeNull();
  });

  it('draws no chip when the stored due date cannot be parsed', () => {
    expect(computeSlaChip(ticket({ sla_due_at: 'not a date' }), NOW)).toBeNull();
  });

  for (const status of ['resolved', 'closed', 'cancelled'] as const) {
    it(`stops a ${status} ticket flashing overdue forever`, () => {
      expect(chip(LONG_BREACH, { status })).toBeNull();
    });
  }
});
