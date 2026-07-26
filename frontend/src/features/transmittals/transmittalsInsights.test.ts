// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The chase list is only trustworthy if three things hold: a draft never
// reaches it, waiting time is billed from the issue date rather than from
// creation, and a purpose that asks for nothing back never shows up as a
// response owed. Each of those fails silently and in the flattering direction.
import { describe, it, expect } from 'vitest';
import { buildTransmittalsInsights } from './transmittalsInsights';
import type { Transmittal, TransmittalRecipient } from './api';

/** Mirrors i18next's defaultValue behaviour without pulling in the runtime. */
const t = ((key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key) as never;

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

function recipient(over: Partial<TransmittalRecipient> = {}): TransmittalRecipient {
  return {
    id: 'rc1',
    name: 'Marta Feld',
    company: 'Nordbau Facades',
    email: null,
    acknowledged: false,
    acknowledged_at: null,
    response: null,
    ...over,
  };
}

function transmittal(over: Partial<Transmittal> = {}): Transmittal {
  return {
    id: 'tr1',
    project_id: 'pr1',
    transmittal_number: 'TR-0018',
    subject: 'Facade shop drawings',
    purpose: 'for_approval',
    status: 'issued',
    cover_note: null,
    issued_date: daysAgo(20),
    response_due: null,
    locked: false,
    recipients: [recipient()],
    items: [],
    metadata: {},
    created_by: null,
    created_at: daysAgo(40),
    updated_at: daysAgo(2),
    ...over,
  } as Transmittal;
}

const build = (list: Transmittal[]) => buildTransmittalsInsights(list, t);
const rowsOf = (list: Transmittal[]) => build(list).datasets[0]?.rows ?? [];
const row = (over: Partial<Transmittal> = {}) => rowsOf([transmittal(over)])[0];

describe('buildTransmittalsInsights', () => {
  it('gives one row per recipient, not one per transmittal', () => {
    const rows = rowsOf([
      transmittal({
        recipients: [
          recipient({ id: 'a', name: 'Marta Feld' }),
          recipient({ id: 'b', name: 'Piotr Lange' }),
          recipient({ id: 'c', name: 'Site engineer' }),
        ],
      }),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.recipient)).toEqual(['Marta Feld', 'Piotr Lange', 'Site engineer']);
  });

  // A record that contributes nothing leaves the dataset with no live rows at
  // all, which flips it to the sample. So the observable proof that a record
  // was excluded is that its own number appears nowhere in the result.
  const contributes = (over: Partial<Transmittal>) =>
    rowsOf([transmittal({ transmittal_number: 'TR-UNIQUE-1', ...over })]).some(
      (r) => r.transmittal === 'TR-UNIQUE-1',
    );

  it('keeps drafts out entirely, because nothing was sent', () => {
    expect(contributes({ status: 'draft' })).toBe(false);
    expect(contributes({ status: 'issued' })).toBe(true);
  });

  it('skips an issued record with no issue date rather than guessing one', () => {
    expect(contributes({ issued_date: null })).toBe(false);
  });

  it('mixes measurable lines in while dropping the drafts beside them', () => {
    // The draft must not suppress the real record, and must not appear in it.
    const rows = rowsOf([
      transmittal({ id: 'a', transmittal_number: 'TR-DRAFT', status: 'draft' }),
      transmittal({ id: 'b', transmittal_number: 'TR-LIVE' }),
    ]);
    expect(rows.map((r) => r.transmittal)).toEqual(['TR-LIVE']);
  });

  it('bills waiting time from the issue date, not from creation', () => {
    // Drafted 90 days ago, issued 12 days ago. The recipient has owed a
    // receipt for 12 days, not 90.
    expect(row({ created_at: daysAgo(90), issued_date: daysAgo(12) })?.days_waiting).toBe(12);
  });

  it('stops the clock at the receipt instead of running it to today', () => {
    const r = row({
      issued_date: daysAgo(30),
      recipients: [recipient({ acknowledged: true, acknowledged_at: daysAgo(26) })],
    });
    expect(r?.days_waiting).toBe(4);
    expect(r?.outstanding).toBe(0);
  });

  it('keeps counting an unacknowledged line as outstanding', () => {
    expect(row()?.outstanding).toBe(1);
  });

  it.each(['for_approval', 'for_review'] as const)('treats %s as owing a response', (purpose) => {
    expect(row({ purpose })?.awaiting_response).toBe(1);
  });

  it.each(['for_information', 'for_record', 'for_construction', 'for_tender'] as const)(
    'does not invent a response owed for %s',
    (purpose) => {
      expect(row({ purpose })?.awaiting_response).toBe(0);
    },
  );

  it('lets an explicit due date outrank the purpose category', () => {
    // Nobody owes a reply to a for_information issue, unless someone set a
    // date on this particular record, which is a decision about this record.
    const r = row({ purpose: 'for_information', response_due: daysAgo(-5) });
    expect(r?.awaiting_response).toBe(1);
    expect(r?.overdue).toBe(0);
  });

  it('marks a response overdue only once the due date has passed', () => {
    expect(row({ response_due: daysAgo(4) })?.overdue).toBe(1);
    expect(row({ response_due: daysAgo(-4) })?.overdue).toBe(0);
    expect(row({ response_due: null })?.overdue).toBe(0);
  });

  it('clears both response measures once the recipient has answered', () => {
    const r = row({
      response_due: daysAgo(4),
      recipients: [recipient({ response: 'Approved with comments' })],
    });
    expect(r?.awaiting_response).toBe(0);
    expect(r?.overdue).toBe(0);
  });

  it('ignores a whitespace-only response, which is not an answer', () => {
    expect(row({ recipients: [recipient({ response: '   ' })] })?.awaiting_response).toBe(1);
  });

  it('acknowledges receipt regardless of purpose, unlike a response', () => {
    // Proving delivery is the reason the module exists, so it is never gated.
    const r = row({ purpose: 'for_information' });
    expect(r?.outstanding).toBe(1);
    expect(r?.awaiting_response).toBe(0);
  });

  it('names a recipient with no company rather than grouping under blank', () => {
    expect(row({ recipients: [recipient({ company: '   ' })] })?.company).toBe('No company recorded');
  });

  it('labels purpose and status with the same keys the page badges use', () => {
    const keyOnly = ((key: string) => key) as never;
    const r = buildTransmittalsInsights([transmittal({})], keyOnly).datasets[0]?.rows[0];
    expect(r?.purpose).toBe('transmittals.purpose_for_approval');
    expect(r?.status).toBe('transmittals.status_issued');
  });

  it('falls back to a clearly-marked sample when nothing is measurable', () => {
    expect(build([]).datasets[0]?.sample).toBe(true);
    // A register holding only drafts has no measurable line either.
    expect(build([transmittal({ status: 'draft' })]).datasets[0]?.sample).toBe(true);
    expect(build([transmittal({})]).datasets[0]?.sample).toBe(false);
  });

  it('exposes no currency-formatted measure, because a transmittal carries no money', () => {
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

  it('draws every builtin from the sample, so an empty register is not a blank panel', () => {
    const rows = build([]).datasets[0]?.rows ?? [];
    expect(rows.length).toBeGreaterThan(0);
    for (const measure of ['outstanding', 'awaiting_response', 'overdue', 'days_waiting']) {
      const total = rows.reduce((sum, r) => sum + Number(r[measure] ?? 0), 0);
      expect(total, measure).toBeGreaterThan(0);
    }
  });
});
