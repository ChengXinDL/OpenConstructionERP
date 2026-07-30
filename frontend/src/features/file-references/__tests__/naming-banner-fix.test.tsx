// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// The banner told a user their filename broke the project naming rules and
// then offered exactly two things to do about it: read the rule, or
// acknowledge the violation. Neither renames the file. Its own affordance
// therefore pushed people towards suppressing the warning, which is the one
// outcome the rule set exists to prevent.
//
// The fix action is passed in by the host rather than reached for here. Of the
// eight file kinds this banner covers only `document` is backed by a table
// owning a `name` column, so a banner that renamed on its own would show a
// button that fails when pressed on seven of them. The first test below pins
// that: no callback, no button.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NamingViolationBanner } from '../NamingViolationBanner';
import type { Iso19650Parts, NamingViolationResponse } from '../types';

const VIOLATION: NamingViolationResponse = {
  id: 'v-1',
  project_id: 'p-1',
  rule_set: 'iso19650',
  file_kind: 'document',
  file_id: 'f-1',
  filename: 'site plan final v2.pdf',
  violation_codes: ['not-iso19650'],
  summary: null,
  acknowledged_at: null,
  acknowledged_by_id: null,
  created_at: '2026-07-29T00:00:00Z',
  updated_at: '2026-07-29T00:00:00Z',
};

/** What the validator hands back for the broken name: a best-effort split. */
const PARTS: Iso19650Parts = {
  project: 'PRJ1',
  originator: 'ABC',
  volume: 'ZZ',
  level: '00',
  type: 'DR',
  role: 'A',
  number: '0001',
  status: 'S0',
  revision: 'P01',
};

const validateMutate = vi.fn(
  (
    vars: { filename: string },
    opts?: { onSuccess?: (r: unknown) => void },
  ) => {
    opts?.onSuccess?.({
      filename: vars.filename,
      rule_set: 'iso19650',
      is_valid: false,
      violation_codes: ['not-iso19650'],
      parts: PARTS,
    });
  },
);

// Every export the component reaches for has to be here. A mocked module that
// is missing one hands back undefined at call time, which fails as "not a
// function" somewhere unrelated rather than as a missing mock.
vi.mock('../hooks', () => ({
  useViolations: () => ({
    data: { items: [VIOLATION], total: 1, limit: 500, offset: 0 },
    isLoading: false,
  }),
  useAcknowledgeViolation: () => ({ mutate: vi.fn(), isPending: false }),
  // Two callers, two shapes. The banner reads the onSuccess callback to
  // pre-fill the wizard; the wizard reads `data` to decide whether the name it
  // has assembled is valid yet. Both have to be here or the apply button stays
  // disabled for a reason that has nothing to do with the code under test.
  // Validation itself is covered by the validator's own tests; what this file
  // is about is whether the banner can rename at all.
  useValidateName: () => ({
    mutate: validateMutate,
    isPending: false,
    data: {
      filename: 'PRJ1-ABC-ZZ-00-DR-A-0001-S0-P01.pdf',
      rule_set: 'iso19650',
      is_valid: true,
      violation_codes: [],
      parts: PARTS,
    },
  }),
}));

function renderBanner(onRename?: (n: string) => Promise<unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NamingViolationBanner
        projectId="p-1"
        fileKind="document"
        fileId="f-1"
        onRename={onRename}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  validateMutate.mockClear();
});

describe('NamingViolationBanner fix action', () => {
  it('still reports the violation', () => {
    renderBanner();
    expect(screen.getByTestId('naming-violation-banner')).toBeInTheDocument();
    expect(screen.getByTestId('violation-code-not-iso19650')).toBeInTheDocument();
  });

  it('offers no fix button when the host cannot rename this kind', () => {
    renderBanner();
    expect(screen.queryByTestId('violation-fix-name')).not.toBeInTheDocument();
    // The dismissal is still there, so the absence above is about renaming and
    // not about the banner having lost its buttons.
    expect(screen.getByTestId('violation-acknowledge')).toBeInTheDocument();
  });

  it('offers a fix button when the host can rename', () => {
    renderBanner(vi.fn());
    expect(screen.getByTestId('violation-fix-name')).toBeInTheDocument();
  });

  it('opens the builder pre-filled from the name that failed', async () => {
    const user = userEvent.setup();
    renderBanner(vi.fn());

    expect(screen.queryByTestId('iso-name-builder')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('violation-fix-name'));

    await waitFor(() => {
      expect(screen.getByTestId('iso-name-builder')).toBeInTheDocument();
    });
    // Pre-filling is the point: correcting one wrong field must not mean
    // retyping the eight that were already right.
    expect(validateMutate).toHaveBeenCalledWith(
      { filename: 'site plan final v2.pdf' },
      expect.anything(),
    );
    const project = screen
      .getByTestId('iso-field-project')
      .querySelector('input');
    expect(project).toHaveValue('PRJ1');
  });

  it('renames through the host callback and closes the builder', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn().mockResolvedValue(undefined);
    renderBanner(onRename);

    await user.click(screen.getByTestId('violation-fix-name'));
    await waitFor(() => screen.getByTestId('iso-apply'));

    await user.click(screen.getByTestId('iso-apply'));

    await waitFor(() => {
      expect(onRename).toHaveBeenCalledTimes(1);
    });
    // The extension of the original file is carried over, not dropped.
    expect(String(onRename.mock.calls[0]?.[0])).toMatch(/\.pdf$/);
    await waitFor(() => {
      expect(screen.queryByTestId('iso-name-builder')).not.toBeInTheDocument();
    });
  });

  it('leaves the name alone when the user cancels', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    renderBanner(onRename);

    await user.click(screen.getByTestId('violation-fix-name'));
    await waitFor(() => screen.getByTestId('iso-name-builder'));

    const cancel = screen.getByTestId('iso-name-builder').querySelector('button');
    if (cancel) await user.click(cancel);

    expect(onRename).not.toHaveBeenCalled();
  });
});
