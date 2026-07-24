// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, expect, it } from 'vitest';

import { safeNextPath } from '../nextPath';

describe('safeNextPath', () => {
  it('honours a valid internal path (with or without the leading ?)', () => {
    expect(safeNextPath('?next=/schedule')).toBe('/schedule');
    expect(safeNextPath('next=/schedule')).toBe('/schedule');
    expect(safeNextPath('?next=/bim/federations')).toBe('/bim/federations');
    expect(safeNextPath('?next=/projects/new')).toBe('/projects/new');
  });

  it('decodes a percent-encoded path', () => {
    expect(safeNextPath('?next=%2Fschedule')).toBe('/schedule');
    expect(safeNextPath('?next=%2Fbim%2Ffederations')).toBe('/bim/federations');
  });

  it('ignores unrelated query params around next', () => {
    expect(safeNextPath('?lang=de&next=/takeoff')).toBe('/takeoff');
    expect(safeNextPath('?next=/reports&project=abc')).toBe('/reports');
  });

  it('falls back to / when next is missing', () => {
    expect(safeNextPath('')).toBe('/');
    expect(safeNextPath('?lang=de')).toBe('/');
    expect(safeNextPath('?next=')).toBe('/');
  });

  it('rejects protocol-relative and external targets (open-redirect guard)', () => {
    expect(safeNextPath('?next=//evil.example.com')).toBe('/');
    expect(safeNextPath('?next=https://evil.example.com')).toBe('/');
    expect(safeNextPath('?next=schedule')).toBe('/'); // not absolute-internal
    expect(safeNextPath('?next=../schedule')).toBe('/');
  });

  it('never bounces back into an auth route', () => {
    expect(safeNextPath('?next=/login')).toBe('/');
    expect(safeNextPath('?next=/register')).toBe('/');
    expect(safeNextPath('?next=/forgot-password')).toBe('/');
    expect(safeNextPath('?next=/reset-password/abc123')).toBe('/');
    expect(safeNextPath('?next=/onboarding')).toBe('/');
  });

  it('does not confuse a lookalike route with an auth route', () => {
    // "/registered-drawings" starts with "register" but is not "/register"
    expect(safeNextPath('?next=/registered-drawings')).toBe('/registered-drawings');
    expect(safeNextPath('?next=/logins-history')).toBe('/logins-history');
  });
});
