// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Follow-on to #408. That issue was reported against the assembly editor and
// fixed there, but the same hover-revealed grip existed at two more places with
// two more resting weights: the BOQ section header rested at tertiary and the
// markup row at quaternary. One control, three answers to "what does this look
// like when you are not touching it".
//
// The tokens are three hex units apart per channel in both themes (#696c78 vs
// #666b78 light, #8b8e9d vs #9499a8 dark), so neither of the two old resting
// values was distinguishable from the other or from the hover step. `secondary`
// is the one value all three now use.
//
// These tests refuse the two old tokens rather than only checking the new one,
// because "bump it one step" passes an assertion that just looks for a class.
// The section grip is also checked for the absence of a resting opacity: it used
// to dim a token to 40%, which cancels the contrast the token was picked for, so
// a colour-only assertion would have read as fixed while the grip stayed
// invisible on screen.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ICellRendererParams } from 'ag-grid-community';
import { SectionFullWidthRenderer } from '../grid/cellRenderers';
import { MarkupPanel } from '../MarkupPanel';
import type { Markup } from '../api';

/** The one resting weight all three grips share. */
const RESTING = 'text-content-secondary';
/** The two weights that were indistinguishable from each other. */
const REJECTED = ['text-content-tertiary', 'text-content-quaternary'];

function renderSectionRow() {
  const params = {
    data: {
      id: 'sec-1',
      _isSection: true,
      _childCount: 2,
      _subtotal: 1000,
      description: 'Erdarbeiten',
      ordinal: '01',
      _depth: 0,
    },
    context: {
      collapsedSections: new Set<string>(),
      currencyCode: 'EUR',
      locale: 'de-DE',
    },
  } as unknown as ICellRendererParams;

  // Rendered as a component, not called as a function: it uses hooks.
  return render(<SectionFullWidthRenderer {...params} />);
}

function makeMarkup(): Markup {
  return {
    id: 'mk-1',
    boq_id: 'boq-1',
    name: 'Overhead',
    markup_type: 'percentage',
    category: 'overhead',
    percentage: 10,
    fixed_amount: '0.00',
    apply_to: 'direct_cost',
    sort_order: 0,
    is_active: true,
    metadata: {},
    created_at: '2026-07-29T00:00:00Z',
    updated_at: '2026-07-29T00:00:00Z',
  };
}

function renderMarkupPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MarkupPanel
        boqId="boq-1"
        markups={[makeMarkup()]}
        directCost={1000}
        currencySymbol="€"
        currencyCode="EUR"
        locale="de-DE"
        fmt={new Intl.NumberFormat('de-DE')}
        openSignal={0}
      />
    </QueryClientProvider>,
  );
}

describe('drag grip resting contrast', () => {
  it('rests the BOQ section grip at the shared weight', () => {
    renderSectionRow();

    const grip = screen.getByTestId('section-drag-grip');
    expect(grip).toHaveClass(RESTING);
    for (const token of REJECTED) {
      expect(grip).not.toHaveClass(token);
    }
  });

  it('does not dim the section grip back down at rest', () => {
    renderSectionRow();

    // Any resting `opacity-*` undoes the token. The hover step must be colour.
    const classes = screen.getByTestId('section-drag-grip').className.split(/\s+/);
    const restingOpacity = classes.filter((c) => /^opacity-\d+$/.test(c));
    expect(restingOpacity).toEqual([]);
  });

  it('rests the markup row grip at the same weight', () => {
    renderMarkupPanel();

    const grip = screen.getByTestId('markup-drag-grip');
    expect(grip).toHaveClass(RESTING);
    for (const token of REJECTED) {
      expect(grip).not.toHaveClass(token);
    }
  });

  it('gives both grips a hover step, so the affordance still reacts', () => {
    renderSectionRow();
    expect(screen.getByTestId('section-drag-grip').className).toContain(
      'text-content-primary',
    );

    renderMarkupPanel();
    expect(screen.getByTestId('markup-drag-grip').className).toContain(
      'group-hover:text-content-primary',
    );
  });
});
