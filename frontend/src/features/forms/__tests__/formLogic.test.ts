// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Tests for the client-side form logic mirror (fieldTypes.ts): the safe formula
// parser/evaluator, the conditional-visibility resolver and the template
// integrity checks. These mirror the backend engines so the builder and filler
// agree with the server; the safe evaluator never uses eval.
import { describe, expect, it } from 'vitest';

import {
  parseFormula,
  computeFormulas,
  resolveVisibility,
  validateTemplateFields,
  missingRequiredKeys,
} from '../fieldTypes';
import type { FormFieldDef } from '../api';

function f(partial: Partial<FormFieldDef> & { key: string; type: FormFieldDef['type'] }): FormFieldDef {
  return { label: partial.key, required: false, ...partial };
}

describe('parseFormula (safe parser)', () => {
  it('parses arithmetic and lists referenced variables', () => {
    const p = parseFormula('length * width');
    expect(p.ok).toBe(true);
    expect(p.vars.sort()).toEqual(['length', 'width']);
  });

  it('accepts the allow-listed functions', () => {
    expect(parseFormula('round(area * 1.15, 2)').ok).toBe(true);
    expect(parseFormula('min(a, b)').ok).toBe(true);
    expect(parseFormula('max(a, b, c)').ok).toBe(true);
  });

  it('rejects anything outside the grammar (no eval surface)', () => {
    for (const expr of ['a ** 2', 'a.b', 'foo(a)', 'a && b', '__import__("os")', 'a % 2']) {
      expect(parseFormula(expr).ok, expr).toBe(false);
    }
  });
});

describe('computeFormulas', () => {
  const fields: FormFieldDef[] = [
    f({ key: 'length', type: 'number' }),
    f({ key: 'width', type: 'number' }),
    f({ key: 'area', type: 'formula', formula: 'length * width' }),
  ];

  it('computes a value from other fields', () => {
    expect(computeFormulas(fields, { length: 4, width: 3 }).area).toBe(12);
  });

  it('treats a blank operand as zero for a running total', () => {
    expect(computeFormulas(fields, { length: 4 }).area).toBe(0);
  });

  it('resolves chained formulas in dependency order', () => {
    const chained: FormFieldDef[] = [
      f({ key: 'base', type: 'number' }),
      f({ key: 'doubled', type: 'formula', formula: 'base * 2' }),
      f({ key: 'plus_ten', type: 'formula', formula: 'doubled + 10' }),
    ];
    const out = computeFormulas(chained, { base: 5 });
    expect(out.doubled).toBe(10);
    expect(out.plus_ten).toBe(20);
  });

  it('yields null on division by zero instead of throwing', () => {
    const ratio: FormFieldDef[] = [
      f({ key: 'a', type: 'number' }),
      f({ key: 'b', type: 'number' }),
      f({ key: 'r', type: 'formula', formula: 'a / b' }),
    ];
    expect(computeFormulas(ratio, { a: 1, b: 0 }).r).toBeNull();
  });
});

describe('resolveVisibility (conditional logic)', () => {
  const fields: FormFieldDef[] = [
    f({ key: 'has_defect', type: 'single_choice', options: ['Yes', 'No'] }),
    f({
      key: 'defect_notes',
      type: 'long_text',
      required: true,
      visible_if: { field: 'has_defect', op: 'eq', value: 'Yes' },
    }),
  ];

  it('hides a field whose visible_if rule does not hold', () => {
    const state = resolveVisibility(fields, { has_defect: 'No' });
    expect(state.defect_notes!.visible).toBe(false);
    expect(state.defect_notes!.required).toBe(false);
  });

  it('shows and requires the field when the rule holds', () => {
    const state = resolveVisibility(fields, { has_defect: 'Yes' });
    expect(state.defect_notes!.visible).toBe(true);
    expect(state.defect_notes!.required).toBe(true);
  });

  it('does not count a hidden required field as missing', () => {
    expect(missingRequiredKeys(fields, { has_defect: 'No' })).toEqual([]);
    expect(missingRequiredKeys(fields, { has_defect: 'Yes' })).toEqual(['defect_notes']);
  });

  it('applies required_if to switch a field on', () => {
    const reqIf: FormFieldDef[] = [
      f({ key: 'temp', type: 'number' }),
      f({ key: 'reason', type: 'short_text', required_if: { field: 'temp', op: 'gt', value: 30 } }),
    ];
    expect(resolveVisibility(reqIf, { temp: 35 }).reason!.required).toBe(true);
    expect(resolveVisibility(reqIf, { temp: 20 }).reason!.required).toBe(false);
  });
});

describe('validateTemplateFields', () => {
  it('flags a formula that references an unknown field', () => {
    const issues = validateTemplateFields([
      f({ key: 'length', type: 'number', label: 'Length' }),
      f({ key: 'area', type: 'formula', label: 'Area', formula: 'length * missing' }),
    ]);
    expect(issues.some((i) => /unknown field/i.test(i.message))).toBe(true);
  });

  it('flags a number field whose min is greater than its max', () => {
    const issues = validateTemplateFields([
      f({ key: 'n', type: 'number', label: 'N', min: 10, max: 5 }),
    ]);
    expect(issues.some((i) => /minimum cannot be greater/i.test(i.message))).toBe(true);
  });

  it('flags an invalid regex pattern', () => {
    const issues = validateTemplateFields([
      f({ key: 'code', type: 'short_text', label: 'Code', pattern: '(' }),
    ]);
    expect(issues.some((i) => /pattern/i.test(i.message))).toBe(true);
  });

  it('accepts a coherent template', () => {
    expect(
      validateTemplateFields([
        f({ key: 'length', type: 'number', label: 'Length' }),
        f({ key: 'width', type: 'number', label: 'Width' }),
        f({ key: 'area', type: 'formula', label: 'Area', formula: 'length * width' }),
      ]),
    ).toEqual([]);
  });
});
