// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Render-level coverage for the "Open from project files" picker.
 *
 * The pure matcher is tested exhaustively in
 * ``shared/lib/projectFileFormats.test.ts``. These tests cover what that one
 * cannot: that the component actually applies the matcher to the API payload,
 * distinguishes its two empty states, and labels a conversion-gated format
 * honestly on screen. A regression in any of those is invisible to the pure
 * tests but very visible to the user.
 *
 * The documents API is stubbed so the test runs fully offline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const fetchDocumentsMock = vi.fn();

vi.mock('@/features/documents/api', () => ({
  fetchDocuments: (projectId: string) => fetchDocumentsMock(projectId),
  downloadDocumentBlob: vi.fn(),
}));

import { ProjectFilePicker } from './ProjectFilePicker';
import { BIM_VIEWER_FORMATS, DWG_TAKEOFF_FORMATS } from '@/shared/lib/projectFileFormats';

/** Minimal stored-document row in the shape the CDE API really returns:
 *  the original filename lives in ``name``, and ``mime_type`` is nullable. */
function makeDoc(id: string, name: string, mime: string | null = null) {
  return {
    id,
    project_id: 'p1',
    name,
    description: null,
    category: 'drawing',
    file_size: 2048,
    mime_type: mime,
    version: 1,
    is_current_revision: true,
    parent_document_id: null,
    uploaded_by: null,
    created_at: '2026-07-20T10:00:00Z',
    updated_at: '2026-07-20T10:00:00Z',
  };
}

function renderPicker(props: Partial<Parameters<typeof ProjectFilePicker>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectFilePicker
          open
          onClose={vi.fn()}
          projectId="p1"
          accepted={DWG_TAKEOFF_FORMATS}
          onPick={vi.fn()}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectFilePicker', () => {
  beforeEach(() => {
    fetchDocumentsMock.mockReset();
  });

  it('lists only the stored files the calling module can open', async () => {
    /* The whole point of the feature: a DWG module must show the project's
     * drawings and hide its PDFs and spreadsheets, so the user is never
     * offered a file that would fail to load. */
    fetchDocumentsMock.mockResolvedValue([
      makeDoc('1', 'A-101.rev2.dwg'),
      makeDoc('2', 'Specification.pdf'),
      makeDoc('3', 'Costs.xlsx'),
      makeDoc('4', 'Site-plan.DXF'),
    ]);
    renderPicker();

    await waitFor(() => expect(screen.getByText('A-101.rev2.dwg')).toBeTruthy());
    // Uppercase extension still matches - the row is there.
    expect(screen.getByText('Site-plan.DXF')).toBeTruthy();
    expect(screen.queryByText('Specification.pdf')).toBeNull();
    expect(screen.queryByText('Costs.xlsx')).toBeNull();
  });

  it('hands the picked document back to the caller', async () => {
    /* The picker itself never opens anything - it reports the choice and the
     * module decides. If this stopped firing, every wired module would look
     * fine and quietly do nothing on click. */
    const onPick = vi.fn();
    fetchDocumentsMock.mockResolvedValue([makeDoc('1', 'A-101.dwg')]);
    renderPicker({ onPick });

    await waitFor(() => expect(screen.getByText('A-101.dwg')).toBeTruthy());
    fireEvent.click(screen.getByText('A-101.dwg'));
    expect(onPick).toHaveBeenCalledTimes(1);
    // Indexing is checked (`noUncheckedIndexedAccess`), and the assertion above
    // already pins that the call happened, so read the argument defensively
    // rather than asserting non-null.
    expect(onPick.mock.calls[0]?.[0]?.id).toBe('1');
  });

  it('shows the "nothing compatible" empty state, not the search one', async () => {
    /* Two different dead ends need two different messages. A project holding
     * only PDFs must be told to add a DWG in Files - telling it "no match for
     * your search" when the search box is empty would be nonsense. */
    fetchDocumentsMock.mockResolvedValue([makeDoc('1', 'Specification.pdf')]);
    renderPicker();

    await waitFor(() =>
      expect(screen.getByText('No compatible file in this project yet')).toBeTruthy(),
    );
    // And it points the user at where to fix it.
    expect(screen.getByText('Go to Files')).toBeTruthy();
    expect(screen.queryByText('No file matches your search.')).toBeNull();
  });

  it('shows the search empty state when a compatible file exists but is filtered out', async () => {
    /* The mirror case. Here the project DOES hold an openable file, so the
     * fix is to clear the search - not to go and upload something. */
    fetchDocumentsMock.mockResolvedValue([makeDoc('1', 'A-101.dwg')]);
    renderPicker();

    await waitFor(() => expect(screen.getByText('A-101.dwg')).toBeTruthy());
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });

    await waitFor(() => expect(screen.getByText('No file matches your search.')).toBeTruthy());
    expect(screen.queryByText('No compatible file in this project yet')).toBeNull();
  });

  it('labels a conversion-gated format instead of implying an instant open', async () => {
    /* Project rule: IFC is never parsed natively, it is viewable only after
     * the DDC cad2data conversion. The row must say so. A silent offer here
     * would be the exact "do not offer a file that will fail to open"
     * failure the feature was asked to avoid. */
    fetchDocumentsMock.mockResolvedValue([makeDoc('1', 'Tower.ifc')]);
    renderPicker({ accepted: BIM_VIEWER_FORMATS });

    await waitFor(() => expect(screen.getByText('Tower.ifc')).toBeTruthy());
    expect(screen.getByText('Converts first')).toBeTruthy();
  });

  it('labels a format that another module handles as a handoff', async () => {
    /* The BIM viewer forwards DWG to DWG takeoff rather than opening it as a
     * 3D model. Saying so is more honest than a bare row that appears to
     * promise a 3D view. */
    fetchDocumentsMock.mockResolvedValue([makeDoc('1', 'Level-02.dwg')]);
    renderPicker({ accepted: BIM_VIEWER_FORMATS });

    await waitFor(() => expect(screen.getByText('Level-02.dwg')).toBeTruthy());
    expect(screen.getByText('Opens in another module')).toBeTruthy();
  });

  it('does not query the documents API while closed', async () => {
    /* The picker is mounted permanently by its callers, so an unconditional
     * query would fire a documents request on every viewer page load. */
    fetchDocumentsMock.mockResolvedValue([]);
    renderPicker({ open: false });
    expect(fetchDocumentsMock).not.toHaveBeenCalled();
  });
});
