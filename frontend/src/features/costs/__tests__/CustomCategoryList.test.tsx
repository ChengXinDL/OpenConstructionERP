// @ts-nocheck
// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomCategoryList } from '../CustomCategoryList';

// Minimal i18n stub: return the defaultValue so assertions read real copy.
const t = ((_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key) as never;

// The page humanizes raw collection tokens; for the test an identity-ish
// label is enough to assert wiring.
const labelFor = (c: string) => c;

function renderList(props = {}) {
  const defaults = {
    categories: ['Structural Steel', 'Site Logistics'],
    selectedCategory: '',
    onSelect: () => undefined,
    labelFor,
    t,
  };
  return render(<CustomCategoryList {...defaults} {...props} />);
}

describe('CustomCategoryList', () => {
  it('renders the heading and one clickable node per custom category', () => {
    renderList();
    expect(screen.getByText('My categories')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Structural Steel/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Site Logistics/ })).toBeInTheDocument();
  });

  it('renders nothing when there are no custom categories', () => {
    const { container } = renderList({ categories: [] });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('My categories')).not.toBeInTheDocument();
  });

  it('selects a category on click', () => {
    const onSelect = vi.fn();
    renderList({ onSelect });
    fireEvent.click(screen.getByRole('button', { name: /Structural Steel/ }));
    expect(onSelect).toHaveBeenCalledWith('Structural Steel');
  });

  it('clears the selection when the active category is clicked again', () => {
    const onSelect = vi.fn();
    renderList({ selectedCategory: 'Structural Steel', onSelect });
    const active = screen.getByRole('button', { name: /Structural Steel/ });
    // The active node is marked pressed for assistive tech.
    expect(active).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(active);
    expect(onSelect).toHaveBeenCalledWith('');
  });
});
