import type { ICellRendererParams } from 'ag-grid-community';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ExpandCellRenderer } from './cellRenderers';

/**
 * Regression: expanding a position's resources required TWO clicks on the
 * chevron. When a cell was being edited, the first click's mousedown blurred +
 * committed the edit, the rows re-rendered, the chevron button unmounted between
 * mousedown and mouseup, and the native click was swallowed. The fix toggles on
 * mousedown (fires before that re-render) and keeps onClick only for keyboard
 * activation (detail === 0) so a mouse click never double-toggles.
 */
function renderExpand(opts?: { expanded?: boolean; resources?: unknown[] }) {
  const onToggleResources = vi.fn();
  const params = {
    data: { id: 'p1', metadata: { resources: opts?.resources ?? [{}, {}] } },
    context: {
      t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? k,
      expandedPositions: opts?.expanded ? new Set(['p1']) : new Set<string>(),
      onToggleResources,
    },
  } as unknown as ICellRendererParams;
  return { ...render(<ExpandCellRenderer {...params} />), onToggleResources };
}

describe('ExpandCellRenderer one-click expand', () => {
  it('toggles on primary-button mousedown exactly once', () => {
    const { container, onToggleResources } = renderExpand();
    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    fireEvent.mouseDown(btn as HTMLButtonElement, { button: 0 });
    expect(onToggleResources).toHaveBeenCalledTimes(1);
    expect(onToggleResources).toHaveBeenCalledWith('p1');
  });

  it('does not double-toggle on a full mouse click (mousedown then click detail>=1)', () => {
    const { container, onToggleResources } = renderExpand();
    const btn = container.querySelector('button') as HTMLButtonElement;
    fireEvent.mouseDown(btn, { button: 0 });
    fireEvent.click(btn, { detail: 1 });
    expect(onToggleResources).toHaveBeenCalledTimes(1);
  });

  it('toggles once on keyboard activation (click with detail 0)', () => {
    const { container, onToggleResources } = renderExpand();
    const btn = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(btn, { detail: 0 });
    expect(onToggleResources).toHaveBeenCalledTimes(1);
  });

  it('ignores a non-primary mousedown', () => {
    const { container, onToggleResources } = renderExpand();
    const btn = container.querySelector('button') as HTMLButtonElement;
    fireEvent.mouseDown(btn, { button: 2 });
    expect(onToggleResources).not.toHaveBeenCalled();
  });

  it('renders nothing when the position has no resources', () => {
    const { container } = renderExpand({ resources: [] });
    expect(container.querySelector('button')).toBeNull();
  });
});
