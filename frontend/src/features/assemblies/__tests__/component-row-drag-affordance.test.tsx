// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Issue #408 — the assembly editor's row drag handle rested at
// `text-content-quaternary` and stepped up to `text-content-tertiary` on hover.
// Those two tokens are three hex units apart per channel in both themes
// (#696c78 vs #666b78 light, #8b8e9d vs #9499a8 dark), so the handle was a
// faint grey that never visibly changed. Estimators rebuilt assemblies from
// scratch rather than reorder them, because they never saw the affordance.
//
// The guard below pins the resting token to `secondary` and pins the presence
// of a tooltip. It deliberately asserts that the resting colour is NOT
// quaternary or tertiary, so the "bump it one step" non-fix cannot pass.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComponentRow } from '../AssemblyEditorPage';
import type { AssemblyComponent } from '../api';

function makeComponent(overrides: Partial<AssemblyComponent> = {}): AssemblyComponent {
  return {
    id: 'cmp-1',
    assembly_id: 'asm-1',
    cost_item_id: null,
    catalog_resource_id: null,
    description: 'Concrete C30/37',
    resource_type: 'material',
    factor: 1,
    quantity: 1,
    quantity_formula: null,
    unit: 'm3',
    unit_cost: 120,
    total: 120,
    sort_order: 0,
    metadata: {},
    ...overrides,
  };
}

function renderRow() {
  return render(
    <table>
      <tbody>
        <ComponentRow
          component={makeComponent()}
          isDragOver={false}
          onDragStart={vi.fn()}
          onDragOver={vi.fn()}
          onDragEnd={vi.fn()}
          onDragLeave={vi.fn()}
          onUpdate={vi.fn()}
          onDelete={vi.fn()}
          fmt={(n: number) => String(n)}
        />
      </tbody>
    </table>,
  );
}

describe('ComponentRow drag handle (#408)', () => {
  it('rests at a contrast step a user can actually see', () => {
    renderRow();

    const handle = screen.getByTitle('Drag to reorder');
    expect(handle).toHaveClass('text-content-secondary');
    // The two tokens that were indistinguishable from each other.
    expect(handle).not.toHaveClass('text-content-quaternary');
    expect(handle).not.toHaveClass('text-content-tertiary');
  });

  it('labels the handle so the gesture is discoverable on hover', () => {
    renderRow();

    // Sourced from i18n, never a literal in the component.
    expect(screen.getByTitle('Drag to reorder')).toBeInTheDocument();
  });

  it('keeps the grab cursor on the handle cell', () => {
    renderRow();

    const cell = screen.getByTitle('Drag to reorder').closest('td');
    expect(cell).toHaveClass('cursor-grab');
  });
});
