import { describe, expect, it } from 'vitest';

import {
  moduleDisplayNameKey,
  resolveModuleDisplayName,
  type TranslatableModule,
} from './moduleDisplayName';

/**
 * A stand-in for i18next's `t`: it knows a fixed set of keys and, like the real
 * one, returns `defaultValue` for anything it does not know. That last part is
 * the whole reason this resolver cannot just call `t` and stop, so the fake has
 * to reproduce it faithfully.
 */
function translator(known: Record<string, string>) {
  return (key: string, options: { defaultValue: string }) => known[key] ?? options.defaultValue;
}

const usPack: TranslatableModule = {
  name: 'oe_us_pack',
  display_name: 'Regional Pack - United States',
  display_name_i18n: {
    de: 'Regionalpaket - Vereinigte Staaten',
    ru: 'Региональный пакет - США',
  },
};

const boq: TranslatableModule = {
  name: 'oe_boq',
  display_name: 'Bill of Quantities',
};

describe('moduleDisplayNameKey', () => {
  it('drops the oe_ prefix that means nothing to a reader', () => {
    expect(moduleDisplayNameKey('oe_dwg_takeoff')).toBe('modules.catalog.dwg_takeoff');
  });

  it('leaves a name that does not carry the prefix alone', () => {
    expect(moduleDisplayNameKey('custom_register')).toBe('modules.catalog.custom_register');
  });

  it('strips only a leading prefix, not one in the middle', () => {
    expect(moduleDisplayNameKey('oe_cost_oe_match')).toBe('modules.catalog.cost_oe_match');
  });
});

describe('resolveModuleDisplayName', () => {
  it('prefers the locale file over the manifest, because it is the curated source', () => {
    const t = translator({ 'modules.catalog.us_pack': 'US-Regionalpaket' });
    expect(resolveModuleDisplayName(usPack, t, 'de')).toBe('US-Regionalpaket');
  });

  it('uses the manifest when the locale has no key for it', () => {
    // This is the regional-pack case: German exists in the manifest and the
    // locale files have not caught up. Without this branch the reader gets
    // English while a real translation sits unread in the manifest.
    const t = translator({});
    expect(resolveModuleDisplayName(usPack, t, 'de')).toBe('Regionalpaket - Vereinigte Staaten');
  });

  it('does not let an English fallback shadow a manifest translation', () => {
    // i18next answers a missing German key with the English value, so a naive
    // "did t() return something" check would stop here and never reach the
    // manifest. The resolver has to notice that what came back IS the English.
    const t = translator({ 'modules.catalog.us_pack': 'Regional Pack - United States' });
    expect(resolveModuleDisplayName(usPack, t, 'ru')).toBe('Региональный пакет - США');
  });

  it('accepts a regional tag against a bare manifest entry', () => {
    const t = translator({});
    expect(resolveModuleDisplayName(usPack, t, 'de-AT')).toBe('Regionalpaket - Vereinigte Staaten');
  });

  it('does not widen a bare tag into itself twice', () => {
    const t = translator({});
    expect(resolveModuleDisplayName(usPack, t, 'fr')).toBe('Regional Pack - United States');
  });

  it('falls back to English when nothing translates the module', () => {
    const t = translator({});
    expect(resolveModuleDisplayName(boq, t, 'ja')).toBe('Bill of Quantities');
  });

  it('translates a module that has no manifest dict at all', () => {
    const t = translator({ 'modules.catalog.boq': 'Ведомость объёмов работ' });
    expect(resolveModuleDisplayName(boq, t, 'ru')).toBe('Ведомость объёмов работ');
  });

  it('ignores a blank manifest entry rather than rendering an empty name', () => {
    const blank: TranslatableModule = {
      name: 'oe_x',
      display_name: 'Something',
      display_name_i18n: { de: '   ' },
    };
    expect(resolveModuleDisplayName(blank, translator({}), 'de')).toBe('Something');
  });

  it('returns English for an English reader', () => {
    const t = translator({ 'modules.catalog.boq': 'Bill of Quantities' });
    expect(resolveModuleDisplayName(boq, t, 'en')).toBe('Bill of Quantities');
  });
});
