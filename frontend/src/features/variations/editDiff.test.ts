// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The variations edit form prefilled from a list row and then PATCHed every
// field back, touched or not. Change a notice title and the description you
// never opened was written back as it stood when your copy of the list was
// loaded, overwriting whatever somebody else had put there in the meantime.
// No error, no warning: from the server's side it is an ordinary write.
//
// The fix sends only the fields that actually changed. These tests hold the
// two halves of that: the initializers produce a baseline identical to the
// form's own starting state (so an untouched field always compares equal),
// and the diff drops untouched fields while still carrying a deliberate clear.

import { describe, it, expect } from 'vitest';

import { onlyChangedFields } from '@/shared/lib/apiHelpers';
import {
  initNoticeForm,
  initVrForm,
  initVoForm,
  initDayworkForm,
  initEotForm,
} from './VariationsPage';
import type {
  Notice,
  VariationRequest,
  VariationOrder,
  DayworkSheet,
  ExtensionOfTimeClaim,
} from './api';

const NOTICE: Notice = {
  id: 'n1',
  project_id: 'p1',
  code: 'NOT-001',
  title: 'Late access to level 3',
  description: 'Access to the east core was not available on the agreed date.',
  raised_at: '2026-07-01T09:00:00',
  raised_by: 'u1',
  recipient_type: 'owner',
  recipient_name: 'Client PM',
  target_response_date: '2026-08-01T00:00:00',
  response_received_at: null,
  response_summary: '',
  status: 'issued',
  reference_change_order_id: null,
  metadata: {},
  created_at: '2026-07-01T09:00:00',
  updated_at: '2026-07-01T09:00:00',
};

/** Builds the payload exactly as the notices branch of `submit` does. */
function noticePayload(form: ReturnType<typeof initNoticeForm>) {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    recipient_type: form.recipient_type,
    recipient_name: form.recipient_name.trim(),
    target_response_date: form.target_response_date || null,
  };
}

describe('the untouched-form baseline', () => {
  it('reports no change at all when the user opens a form and saves it', () => {
    const base = initNoticeForm(NOTICE);
    const patch = onlyChangedFields(noticePayload(base), base, base);

    expect(patch).toEqual({});
  });

  it('holds for every sub-entity, not just notices', () => {
    const vr = initVrForm(
      {
        id: 'v1',
        project_id: 'p1',
        notice_id: null,
        code: 'VR-001',
        title: 'Additional ductwork',
        description: 'Extra runs to level 3.',
        requested_by: null,
        requested_at: null,
        classification: 'scope_change',
        urgency: 'med',
        // Money arrives as a string with trailing zeros; the form keeps it
        // verbatim, so it has to compare equal to itself.
        estimated_cost_impact: '12500.00',
        estimated_schedule_days: 5,
        currency: 'GBP',
        status: 'draft',
        submitted_at: null,
        decision_at: null,
        decision_notes: '',
        decided_by: null,
        metadata: {},
        created_at: '2026-07-01T09:00:00',
        updated_at: '2026-07-01T09:00:00',
      } as VariationRequest,
      'EUR',
    );
    expect(onlyChangedFields({ title: vr.title, currency: vr.currency }, vr, vr)).toEqual({});

    const vo = initVoForm(
      {
        id: 'o1',
        project_id: 'p1',
        variation_request_id: null,
        code: 'VO-001',
        title: 'Ductwork order',
        final_cost_impact: '12500.00',
        final_schedule_days: 5,
        currency: 'GBP',
        agreed_at: null,
        signed_by: null,
        status: 'issued',
        reference_change_order_id: null,
        affected_contract_id: null,
        implementation_started_at: null,
        implementation_completed_at: null,
        metadata: {},
        created_at: '2026-07-01T09:00:00',
        updated_at: '2026-07-01T09:00:00',
      } as VariationOrder,
      'EUR',
    );
    expect(onlyChangedFields({ title: vo.title }, vo, vo)).toEqual({});

    const dw = initDayworkForm(
      {
        id: 'd1',
        project_id: 'p1',
        sheet_number: 'DW-001',
        work_date: '2026-07-02T00:00:00',
        description: 'Standby crew.',
        total_amount: '0.00',
        currency: 'GBP',
        status: 'draft',
        signed_by: null,
        signed_at: null,
        owner_signature_ref: '',
        supplied_via_contract_id: null,
        created_at: '2026-07-01T09:00:00',
        updated_at: '2026-07-01T09:00:00',
      } as DayworkSheet,
      'EUR',
    );
    expect(onlyChangedFields({ work_date: dw.work_date || null }, dw, dw)).toEqual({});

    const eot = initEotForm({
      id: 'e1',
      project_id: 'p1',
      raised_at: null,
      raised_by: null,
      claim_period_start: '2026-07-01T00:00:00',
      claim_period_end: '2026-07-14T00:00:00',
      description: 'Access delay.',
      root_cause_category: 'employer_caused',
      requested_days: 10,
      granted_days: null,
      critical_path_impact: true,
      status: 'draft',
      decision_at: null,
      decision_notes: '',
      created_at: '2026-07-01T09:00:00',
      updated_at: '2026-07-01T09:00:00',
    } as ExtensionOfTimeClaim);
    expect(onlyChangedFields({ description: eot.description }, eot, eot)).toEqual({});
  });

  it('does not write the project currency onto a record that has none', () => {
    // The form falls back to the project's currency for display. That fallback
    // must not be mistaken for something the user chose, or opening and saving
    // a record silently stamps a currency on it.
    const base = initVrForm({ ...({} as VariationRequest), currency: '' }, 'EUR');
    expect(base.currency).toBe('EUR');
    expect(onlyChangedFields({ currency: base.currency }, base, base)).toEqual({});
  });
});

describe('the change diff', () => {
  it('sends the edited field and nothing else', () => {
    const base = initNoticeForm(NOTICE);
    const form = { ...base, title: 'Late access to level 3 and 4' };

    const patch = onlyChangedFields(noticePayload(form), form, base);

    expect(patch).toEqual({ title: 'Late access to level 3 and 4' });
    // The point of the whole exercise: the description the user never opened
    // must not be in the body, so a concurrent edit to it survives.
    expect(patch).not.toHaveProperty('description');
    expect(Object.keys(patch)).toHaveLength(1);
  });

  it('leaves a date alone when the user does not touch it', () => {
    // The row carries a full timestamp, the date input carries ten characters.
    // Comparing the form against the raw row would call this changed forever
    // and put the field straight back into every PATCH.
    const base = initNoticeForm(NOTICE);
    expect(base.target_response_date).toBe('2026-08-01');

    const form = { ...base, recipient_name: 'Client PM (interim)' };
    const patch = onlyChangedFields(noticePayload(form), form, base);

    expect(patch).not.toHaveProperty('target_response_date');
  });

  it('sends null when the user clears a date that had a value', () => {
    const base = initNoticeForm(NOTICE);
    const form = { ...base, target_response_date: '' };

    const patch = onlyChangedFields(noticePayload(form), form, base);

    expect(patch).toEqual({ target_response_date: null });
  });

  it('stays quiet when an already-empty date is left empty', () => {
    const base = initNoticeForm({ ...NOTICE, target_response_date: null });
    const form = { ...base, title: 'Renamed' };

    const patch = onlyChangedFields(noticePayload(form), form, base);

    expect(patch).toEqual({ title: 'Renamed' });
  });

  it('treats a re-typed identical value as no change', () => {
    const base = initNoticeForm(NOTICE);
    const form = { ...base, title: NOTICE.title };

    expect(onlyChangedFields(noticePayload(form), form, base)).toEqual({});
  });

  it('carries a cleared text field rather than dropping it', () => {
    // Emptying a field is an edit. Only an untouched field may be omitted.
    const base = initNoticeForm(NOTICE);
    const form = { ...base, description: '' };

    expect(onlyChangedFields(noticePayload(form), form, base)).toEqual({ description: '' });
  });

  it('carries a false boolean, which a truthiness check would have dropped', () => {
    const base = initEotForm({
      ...({} as ExtensionOfTimeClaim),
      critical_path_impact: true,
      requested_days: 10,
      description: 'Access delay.',
      root_cause_category: 'employer_caused',
      claim_period_start: null,
      claim_period_end: null,
    });
    const form = { ...base, critical_path_impact: false };

    const patch = onlyChangedFields(
      {
        description: form.description.trim(),
        root_cause_category: form.root_cause_category,
        requested_days: Number(form.requested_days) || 0,
        critical_path_impact: form.critical_path_impact,
      },
      form,
      base,
    );

    expect(patch).toEqual({ critical_path_impact: false });
  });
});
