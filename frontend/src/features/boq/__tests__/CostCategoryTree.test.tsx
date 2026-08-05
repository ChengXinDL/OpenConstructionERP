// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// CostCategoryTree contract tests:
//   • Renders root nodes with their counts
//   • Children stay hidden until the parent is expanded
//   • Clicking a node emits the slash-joined path on onSelect
//   • Search-within-tree filters by node name AND keeps ancestors visible
//     for matched descendants
//   • Sentinel "__unspecified__" is rendered via the boq.uncategorized i18n key
//     as "(Not specified)"

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { CostCategoryTree } from '../CostCategoryTree';
import type { CategoryTreeNode } from '../api';

// Minimal t() that honours `defaultValue` — matches what the test setup mocks
// for `useTranslation` so behaviour stays consistent across the suite.
const t = ((key: string, opts?: Record<string, unknown>) => {
  if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
    let str = String(opts.defaultValue);
    for (const k of Object.keys(opts)) {
      if (k === 'defaultValue') continue;
      str = str.replace(new RegExp(`{{${k}}}`, 'g'), String(opts[k]));
    }
    return str;
  }
  return key;
}) as unknown as TFunction;

const SAMPLE_TREE: CategoryTreeNode[] = [
  {
    name: 'Buildings',
    count: 12044,
    children: [
      {
        name: 'Concrete',
        count: 3200,
        children: [
          { name: 'C25/30', count: 850, children: [] },
          { name: 'C30/37', count: 1100, children: [] },
        ],
      },
      { name: 'Masonry', count: 2400, children: [] },
    ],
  },
  {
    name: 'Infrastructure',
    count: 5000,
    children: [{ name: '__unspecified__', count: 100, children: [] }],
  },
];

describe('CostCategoryTree', () => {
  it('renders root nodes with their counts', () => {
    render(
      <CostCategoryTree
        tree={SAMPLE_TREE}
        selectedPath=""
        onSelect={vi.fn()}
        t={t}
      />,
    );
    expect(screen.getByText('Buildings')).toBeInTheDocument();
    expect(screen.getByText('Infrastructure')).toBeInTheDocument();
    // Counts use locale formatting; assert on the raw digits.
    expect(screen.getByText('12,044')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument();
  });

  it('keeps children hidden until the parent is expanded', () => {
    render(
      <CostCategoryTree
        tree={SAMPLE_TREE}
        selectedPath=""
        onSelect={vi.fn()}
        t={t}
      />,
    );
    expect(screen.queryByText('Concrete')).toBeNull();
    expect(screen.queryByText('Masonry')).toBeNull();
  });

  it('expands a node when its chevron button is clicked', () => {
    render(
      <CostCategoryTree
        tree={SAMPLE_TREE}
        selectedPath=""
        onSelect={vi.fn()}
        t={t}
      />,
    );
    const expandBtn = screen
      .getAllByRole('button', { name: /Expand|Collapse/i })
      .find((b) => b.getAttribute('aria-label')?.includes('Expand'));
    expect(expandBtn).toBeTruthy();
    fireEvent.click(expandBtn!);
    expect(screen.getByText('Concrete')).toBeInTheDocument();
    expect(screen.getByText('Masonry')).toBeInTheDocument();
  });

  it('emits the slash-joined path when a node is clicked', () => {
    const onSelect = vi.fn();
    render(
      <CostCategoryTree
        tree={SAMPLE_TREE}
        selectedPath=""
        onSelect={onSelect}
        t={t}
      />,
    );

    // Top-level click → just the segment.
    fireEvent.click(screen.getByText('Buildings'));
    expect(onSelect).toHaveBeenLastCalledWith('Buildings');

    // After clicking Buildings the node auto-expands; click into the child.
    fireEvent.click(screen.getByText('Concrete'));
    expect(onSelect).toHaveBeenLastCalledWith('Buildings/Concrete');
  });

  it('filters node names recursively and keeps ancestors visible', () => {
    render(
      <CostCategoryTree
        tree={SAMPLE_TREE}
        selectedPath=""
        onSelect={vi.fn()}
        t={t}
      />,
    );
    const filter = screen.getByPlaceholderText(/^Filter categories\.\.\./);
    fireEvent.change(filter, { target: { value: 'C30' } });

    // The matching descendant + its ancestors are visible …
    expect(screen.getByText('C30/37')).toBeInTheDocument();
    expect(screen.getByText('Buildings')).toBeInTheDocument();
    expect(screen.getByText('Concrete')).toBeInTheDocument();

    // … and unrelated branches are hidden.
    expect(screen.queryByText('Infrastructure')).toBeNull();
    expect(screen.queryByText('Masonry')).toBeNull();
  });

  it('renders the __unspecified__ sentinel as the localized "(Not specified)" label', () => {
    render(
      <CostCategoryTree
        tree={SAMPLE_TREE}
        selectedPath=""
        onSelect={vi.fn()}
        t={t}
      />,
    );
    // Expand the Infrastructure branch.
    const infraExpand = screen
      .getAllByRole('button', { name: /Expand/i })
      .at(-1);
    fireEvent.click(infraExpand!);

    expect(screen.getByText(/^\(Not specified\)/)).toBeInTheDocument();
    // The literal sentinel token must NOT leak to the UI.
    expect(screen.queryByText('__unspecified__')).toBeNull();
  });

  it('marks the selected path as aria-selected', () => {
    render(
      <CostCategoryTree
        tree={SAMPLE_TREE}
        selectedPath="Buildings"
        onSelect={vi.fn()}
        t={t}
      />,
    );
    const buildingsRow = screen.getByText('Buildings').closest('[role="treeitem"]');
    expect(buildingsRow?.getAttribute('aria-selected')).toBe('true');
  });

  // ── A sentinel that is its parent's only child ──────────────────────────
  //
  // On the shipped catalogue this is not an edge case. Every one of the five
  // top-level categories has exactly one child, the sentinel, holding 100% of
  // the parent count, because that data carries no department level at all:
  // 129 such nodes standing in front of 14967 rows. Rendering one puts a row
  // on screen that repeats its parent's number and costs a click to get past.
  //
  // What must not break while removing that row: the slash-joined path is
  // positional, so segment N is filtered at classification depth N. Dropping
  // the sentinel from the path as well as from the screen would shift every
  // deeper segment up one level and match section names against the
  // department column.

  const node = (name: string, count: number, children: CategoryTreeNode[] = []): CategoryTreeNode => ({
    name,
    count,
    children,
  });

  it('does not render a sentinel that is its parent only child', () => {
    const tree = [
      node('Elektrikinstallation', 4580, [
        node('__unspecified__', 4580, [node('Fernmodul', 5), node('Mikrofon', 3)]),
      ]),
    ];
    render(<CostCategoryTree tree={tree} selectedPath="" onSelect={vi.fn()} t={t} />);

    fireEvent.click(screen.getByText('Elektrikinstallation'));

    expect(screen.queryByText(/^\(Not specified\)/)).not.toBeInTheDocument();
    expect(screen.getByText('Fernmodul')).toBeInTheDocument();
    expect(screen.getByText('Mikrofon')).toBeInTheDocument();
  });

  it('keeps the skipped sentinel in the emitted path so depths stay aligned', () => {
    const onSelect = vi.fn();
    const tree = [
      node('Elektrikinstallation', 4580, [node('__unspecified__', 4580, [node('Fernmodul', 5)])]),
    ];
    render(<CostCategoryTree tree={tree} selectedPath="" onSelect={onSelect} t={t} />);

    fireEvent.click(screen.getByText('Elektrikinstallation'));
    fireEvent.click(screen.getByText('Fernmodul'));

    // Not "Elektrikinstallation/Fernmodul": that would ask the backend to match
    // a section name against the department column.
    expect(onSelect).toHaveBeenLastCalledWith('Elektrikinstallation/__unspecified__/Fernmodul');
  });

  it('still renders a sentinel that has siblings', () => {
    const tree = [
      node('Buildings', 6, [
        node('Concrete', 4, [node('Walls', 4)]),
        node('__unspecified__', 2, [node('Walls', 2)]),
      ]),
    ];
    render(<CostCategoryTree tree={tree} selectedPath="" onSelect={vi.fn()} t={t} />);

    fireEvent.click(screen.getByText('Buildings'));

    // Two real branches here, so the sentinel carries information rather than noise.
    expect(screen.getByText(/^\(Not specified\)/)).toBeInTheDocument();
    expect(screen.getByText('Concrete')).toBeInTheDocument();
  });
});
