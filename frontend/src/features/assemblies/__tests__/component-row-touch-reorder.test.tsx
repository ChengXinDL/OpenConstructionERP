// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The reorder surfaces use HTML5 drag and drop, which does not fire on touch.
// On a tablet on site the grip was visible, the row was draggable, and nothing
// happened: the rows could not be reordered at all. #408 asked for the grip to
// be easier to see, and making an affordance more visible on a device where it
// does nothing arguably makes the situation worse, so the grip needed a path
// that does not go through the drag API.
//
// These tests use clicks rather than drag events on purpose. A test that fired
// dragstart and dragend would pass on the code that was already broken on
// touch, because those events are exactly what a touch device never sends.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function renderRow(
  opts: {
    onMove?: (delta: -1 | 1) => void;
    canMoveUp?: boolean;
    canMoveDown?: boolean;
  } = {},
) {
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
          {...opts}
        />
      </tbody>
    </table>,
  );
}

describe('ComponentRow reorder without the drag API', () => {
  it('offers move up and move down next to the grip', () => {
    renderRow({ onMove: vi.fn(), canMoveUp: true, canMoveDown: true });

    expect(screen.getByTestId('component-move-up')).toBeInTheDocument();
    expect(screen.getByTestId('component-move-down')).toBeInTheDocument();
  });

  it('renders them without waiting for a hover', () => {
    // A touch device never hovers. If these controls were hover-revealed the
    // feature would be invisible on exactly the device it exists for, so the
    // absence of any hover-gating class is the thing being pinned here.
    renderRow({ onMove: vi.fn(), canMoveUp: true, canMoveDown: true });

    for (const id of ['component-move-up', 'component-move-down']) {
      const cls = screen.getByTestId(id).className;
      expect(cls).not.toContain('group-hover:opacity');
      expect(cls).not.toContain('opacity-0');
      expect(cls).not.toContain('hidden');
    }
  });

  it('moves the row up on a plain click', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderRow({ onMove, canMoveUp: true, canMoveDown: true });

    await user.click(screen.getByTestId('component-move-up'));
    expect(onMove).toHaveBeenCalledWith(-1);
  });

  it('moves the row down on a plain click', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderRow({ onMove, canMoveUp: true, canMoveDown: true });

    await user.click(screen.getByTestId('component-move-down'));
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it('disables the direction that would fall off the list', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderRow({ onMove, canMoveUp: false, canMoveDown: true });

    const up = screen.getByTestId('component-move-up');
    expect(up).toBeDisabled();
    await user.click(up);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('reaches both controls with the keyboard', async () => {
    // Same path, no pointer at all. Reordering was previously impossible
    // without a mouse for the same reason it was impossible on touch.
    const user = userEvent.setup();
    const onMove = vi.fn();
    renderRow({ onMove, canMoveUp: true, canMoveDown: true });

    screen.getByTestId('component-move-down').focus();
    await user.keyboard('{Enter}');
    expect(onMove).toHaveBeenCalledWith(1);
  });

  it('keeps the grip, so the mouse path is untouched', () => {
    renderRow({ onMove: vi.fn(), canMoveUp: true, canMoveDown: true });

    const grip = screen.getByTitle('Drag to reorder');
    expect(grip).toBeInTheDocument();
    expect(grip).toHaveClass('text-content-secondary');
  });

  it('shows the buttons inert when the host wires no move handler', () => {
    renderRow();

    expect(screen.getByTestId('component-move-up')).toBeDisabled();
    expect(screen.getByTestId('component-move-down')).toBeDisabled();
  });
});
