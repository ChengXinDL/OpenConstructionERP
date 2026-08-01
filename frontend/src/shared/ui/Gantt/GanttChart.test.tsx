// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Tests for the Gantt header rendering.
 *
 * Scope note: jsdom does not paint, so nothing here can prove a clipped label
 * actually stops at the clip. That was verified separately in Chromium by
 * rasterising the two labels and reading the rightmost inked pixel. What these
 * tests defend is the wiring, which is what a later edit is likely to drop: the
 * clip has to be attached to every top-row label, sized to that label's own
 * cell, and scoped to the chart instance.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { GanttChart } from './GanttChart';
import type { GanttActivity } from './ganttUtils';

// Opens mid-January, which is what gives the leading month a cell narrower than
// its own label. A range starting on the 1st does not reproduce the bug.
const ACTIVITIES: GanttActivity[] = [
  { id: 'a', name: 'Groundworks', start: '2026-01-25', end: '2026-02-20', progress: 40 },
  { id: 'b', name: 'Frame', start: '2026-02-21', end: '2026-03-28', progress: 0 },
];

function renderChart() {
  return render(
    <GanttChart activities={ACTIVITIES} startDate="2026-01-25" endDate="2026-03-31" />,
  );
}

/** The top row is the first header row: the month labels. */
function topRowLabels(container: HTMLElement): SVGTextElement[] {
  const texts = [...container.querySelectorAll<SVGTextElement>('.gantt-header text')];
  // Top row sits in the upper half of the 48px header, bottom row below it.
  return texts.filter((el) => Number(el.getAttribute('y')) < 24);
}

describe('GanttChart header', () => {
  it('clips every top-row month label', () => {
    const { container } = renderChart();
    const labels = topRowLabels(container);

    expect(labels.length).toBeGreaterThan(1);
    for (const label of labels) {
      expect(
        label.getAttribute('clip-path'),
        `"${label.textContent}" is unclipped and can paint over its neighbour`,
      ).toMatch(/^url\(#.+\)$/);
    }
  });

  it('sizes each clip to its own cell, not to a shared width', () => {
    const { container } = renderChart();
    const labels = topRowLabels(container);

    const widths = labels.map((label) => {
      const ref = label.getAttribute('clip-path');
      expect(ref, `"${label.textContent}" has no clip-path to size`).not.toBeNull();
      const id = ref!.slice(5, -1);
      const rect = container.querySelector(`clipPath[id="${CSS.escape(id)}"] rect`);
      expect(rect, `clip-path points at #${id}, which is not defined`).not.toBeNull();
      return Number(rect!.getAttribute('width'));
    });

    // The partial leading month must get a visibly smaller clip than the whole
    // months after it. One shared width would defeat the fix while still
    // satisfying the previous test.
    const [leading, ...rest] = widths;
    expect(leading!).toBeGreaterThan(0);
    for (const w of rest.slice(0, -1)) {
      expect(w).toBeGreaterThan(leading! * 2);
    }
  });

  it('scopes clip ids per chart so two charts on a page do not share them', () => {
    // Both charts render the same months, so a hardcoded id would collide and
    // one chart would clip its labels against the other's column positions.
    const { container } = render(
      <div>
        <GanttChart activities={ACTIVITIES} startDate="2026-01-25" endDate="2026-03-31" />
        <GanttChart activities={ACTIVITIES} startDate="2026-01-25" endDate="2026-03-31" />
      </div>,
    );

    const ids = [...container.querySelectorAll('clipPath')].map((n) => n.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size, 'two charts emitted colliding clipPath ids').toBe(ids.length);
  });
});
