// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The work order edit form seeded itself from a record and then PATCHed every
// field back on save. Change the scheduled date and the technician's work
// summary went back with it, exactly as it stood when the modal was opened,
// overwriting whatever the technician had written in the meantime. Nobody sees
// an error, because from the server's side it is an ordinary write.
//
// These tests pin the baseline the save compares against. The baseline and the
// form seed come from one function precisely so they cannot drift: if the two
// were derived separately, a field nobody touched could still read as changed
// and get written back, which is the bug all over again.

import { describe, it, expect } from 'vitest';

import { workOrderFormBase, buildWorkOrderPatch } from './WorkOrderFormModal';
import type { MaintenanceWorkOrder } from '../api';

const ORDER: MaintenanceWorkOrder = {
  id: 'w1',
  equipment_id: 'e1',
  schedule_id: null,
  scheduled_for: '2026-08-14',
  completed_at: null,
  status: 'scheduled',
  technician_id: 'tech-7',
  work_summary: 'Replace the hydraulic seal on the boom.',
  cost: 480.5,
  currency: 'GBP',
} as MaintenanceWorkOrder;

describe('the work order edit baseline', () => {
  it('round-trips an untouched record to itself', () => {
    const base = workOrderFormBase(ORDER);

    expect(base).toEqual({
      scheduledFor: '2026-08-14',
      status: 'scheduled',
      technicianId: 'tech-7',
      workSummary: 'Replace the hydraulic seal on the boom.',
      cost: '480.5',
      currency: 'GBP',
    });
  });

  it('turns every absent field into the empty string the inputs hold', () => {
    // A null on the wire against an '' in the input would read as a change on
    // every save and put the field straight back into the body.
    const base = workOrderFormBase({
      ...ORDER,
      scheduled_for: null,
      technician_id: null,
      work_summary: null,
      cost: null,
      currency: null,
    } as unknown as MaintenanceWorkOrder);

    expect(base.scheduledFor).toBe('');
    expect(base.technicianId).toBe('');
    expect(base.workSummary).toBe('');
    expect(base.cost).toBe('');
    expect(base.currency).toBe('');
  });

  it('keeps a zero cost as a real value rather than an empty field', () => {
    // `num()` guards against a falsy check swallowing 0. A work order done at
    // no cost is a normal outcome and must not read as "no cost recorded".
    expect(workOrderFormBase({ ...ORDER, cost: 0 }).cost).toBe('0');
  });

  it('defaults a new work order to scheduled with everything else blank', () => {
    expect(workOrderFormBase()).toEqual({
      scheduledFor: '',
      status: 'scheduled',
      technicianId: '',
      workSummary: '',
      cost: '',
      currency: '',
    });
  });
});

describe('the work order edit payload', () => {
  it('is empty when the user opens the form and saves without touching it', () => {
    const base = workOrderFormBase(ORDER);
    expect(buildWorkOrderPatch(base, base)).toEqual({});
  });

  it('carries the rescheduled date and leaves the work summary alone', () => {
    const base = workOrderFormBase(ORDER);
    const form = { ...base, scheduledFor: '2026-08-21' };

    const patch = buildWorkOrderPatch(form, base);

    expect(patch).toEqual({ scheduled_for: '2026-08-21' });
    // The whole point: the technician's summary is not in the body, so what
    // they wrote while this modal sat open survives the save.
    expect(patch).not.toHaveProperty('work_summary');
  });

  it('clears a date with null rather than dropping the key', () => {
    const base = workOrderFormBase(ORDER);
    const patch = buildWorkOrderPatch({ ...base, scheduledFor: '' }, base);

    expect(patch.scheduled_for).toBeNull();
  });

  it('leaves an unparseable cost out instead of sending NaN', () => {
    // NaN serialises to null, which would wipe a figure the user never meant
    // to clear. Leaving the key out keeps the stored value.
    const base = workOrderFormBase(ORDER);
    const patch = buildWorkOrderPatch({ ...base, cost: 'about four hundred' }, base);

    expect(patch).not.toHaveProperty('cost');
  });

  it('accepts a comma decimal separator', () => {
    const base = workOrderFormBase(ORDER);
    expect(buildWorkOrderPatch({ ...base, cost: '512,25' }, base)).toEqual({ cost: 512.25 });
  });

  it('sends a cost of zero, which a truthiness check would have dropped', () => {
    const base = workOrderFormBase(ORDER);
    expect(buildWorkOrderPatch({ ...base, cost: '0' }, base)).toEqual({ cost: 0 });
  });

  it('does not resend a cost that only differs in formatting', () => {
    const base = workOrderFormBase(ORDER);
    expect(base.cost).toBe('480.5');
    expect(buildWorkOrderPatch({ ...base, cost: '480.5' }, base)).toEqual({});
  });

  it('sends several fields when several were edited', () => {
    const base = workOrderFormBase(ORDER);
    const patch = buildWorkOrderPatch(
      { ...base, status: 'completed', workSummary: 'Seal replaced, boom tested.' },
      base,
    );

    expect(patch).toEqual({
      status: 'completed',
      work_summary: 'Seal replaced, boom tested.',
    });
  });
});
