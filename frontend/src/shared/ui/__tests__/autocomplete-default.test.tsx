// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Follow-on to #407, where the browser offered a saved credit card over a BOQ
// chapter name. That fix named one element. The default belongs in the shared
// primitive instead, because 942 of 952 free-text inputs carried no
// autocomplete at all and doing them by hand rots on the next new input.
//
// The half of this that is easy to get wrong is the token itself. A value the
// browser cannot parse is not ignored: the field is treated as `on` and handed
// straight back to the heuristics the attribute was meant to suppress. So the
// validator below is the real subject of these tests, and `section-name` is in
// them by name because it is the value someone reaches for on a field holding a
// section name, and it is malformed.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../Input';
import { isValidAutocomplete, AUTOCOMPLETE_FIELD_NAMES } from '../autocompleteToken';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isValidAutocomplete', () => {
  it('accepts the two bare states', () => {
    expect(isValidAutocomplete('off')).toBe(true);
    expect(isValidAutocomplete('on')).toBe(true);
    expect(isValidAutocomplete('OFF')).toBe(true);
  });

  it('accepts real field names', () => {
    expect(isValidAutocomplete('email')).toBe(true);
    expect(isValidAutocomplete('organization')).toBe(true);
    expect(isValidAutocomplete('new-password')).toBe(true);
    expect(isValidAutocomplete('street-address')).toBe(true);
  });

  it('accepts the qualifiers the grammar allows', () => {
    expect(isValidAutocomplete('shipping street-address')).toBe(true);
    expect(isValidAutocomplete('billing postal-code')).toBe(true);
    expect(isValidAutocomplete('work email')).toBe(true);
    expect(isValidAutocomplete('section-invoice billing cc-number')).toBe(true);
    expect(isValidAutocomplete('username webauthn')).toBe(true);
  });

  it('rejects a section prefix with no field after it', () => {
    // The value that motivated the validator. `section-` is real grammar, so
    // this reads as correct, names a group and no field, and is discarded.
    expect(isValidAutocomplete('section-name')).toBe(false);
    expect(isValidAutocomplete('section-billing')).toBe(false);
    expect(isValidAutocomplete('section-')).toBe(false);
  });

  it('rejects invented names that read like field names', () => {
    expect(isValidAutocomplete('boq-section-name')).toBe(false);
    expect(isValidAutocomplete('project-name')).toBe(false);
    expect(isValidAutocomplete('description')).toBe(false);
    expect(isValidAutocomplete('search')).toBe(false);
  });

  it('rejects a contact qualifier on a field that takes none', () => {
    // `work email` is valid and `work country` is not, which is the distinction
    // a flat word allowlist cannot make.
    expect(isValidAutocomplete('work email')).toBe(true);
    expect(isValidAutocomplete('work country')).toBe(false);
  });

  it('rejects on and off mixed with anything else', () => {
    expect(isValidAutocomplete('off email')).toBe(false);
    expect(isValidAutocomplete('billing off')).toBe(false);
  });

  it('rejects the empty value', () => {
    expect(isValidAutocomplete('')).toBe(false);
    expect(isValidAutocomplete('   ')).toBe(false);
  });

  it('rejects tokens trailing after the field name', () => {
    expect(isValidAutocomplete('email extra')).toBe(false);
  });

  it('exports every field name it accepts, so callers can look one up', () => {
    expect(AUTOCOMPLETE_FIELD_NAMES).toContain('cc-number');
    expect(AUTOCOMPLETE_FIELD_NAMES).toContain('email');
    expect(AUTOCOMPLETE_FIELD_NAMES).not.toContain('section-name');
    for (const name of AUTOCOMPLETE_FIELD_NAMES) {
      expect(isValidAutocomplete(name)).toBe(true);
    }
  });
});

describe('Input autocomplete default', () => {
  it('turns autofill off when the caller says nothing', () => {
    render(<Input label="Section name" />);
    expect(screen.getByLabelText('Section name')).toHaveAttribute('autocomplete', 'off');
  });

  it('gives the field a stable name, which is what defeats the heuristic', () => {
    // `off` alone is routinely overridden on a field the browser has decided is
    // a payment field. An identified field is not grouped page-wide in the
    // first place, so the name matters as much as the attribute.
    render(<Input label="Section name" />);
    const el = screen.getByLabelText('Section name');
    expect(el).toHaveAttribute('name', 'section-name');
    expect(el).toHaveAttribute('id', 'section-name');
  });

  it('does not overwrite a name the caller set', () => {
    render(<Input label="Email" name="user_email" autoComplete="email" />);
    const el = screen.getByLabelText('Email');
    expect(el).toHaveAttribute('name', 'user_email');
    expect(el).toHaveAttribute('autocomplete', 'email');
  });

  it('lets a caller opt into real autofill', () => {
    render(<Input label="Password" type="password" autoComplete="current-password" />);
    expect(screen.getByLabelText('Password')).toHaveAttribute(
      'autocomplete',
      'current-password',
    );
  });

  it('warns in dev when the caller invents a token', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Input label="Section" autoComplete="section-name" />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('section-name');
  });

  it('stays quiet for a token that is actually valid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<Input label="Email" autoComplete="email" />);
    expect(warn).not.toHaveBeenCalled();
  });

  it('applies the same default to the floating-label variant', () => {
    render(<Input label="Company" floatingLabel />);
    expect(screen.getByLabelText('Company')).toHaveAttribute('autocomplete', 'off');
  });
});
