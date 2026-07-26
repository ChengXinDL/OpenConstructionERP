// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * ProjectFilePicker - open a file that is ALREADY in the project's Files
 * area, instead of re-uploading the same drawing from disk.
 *
 * Every viewer/takeoff module used to offer a local upload only. If the
 * drawing had already been filed in the project, the user had to find it on
 * their own machine again, and the project ended up with two copies of it.
 * This picker lists the stored files the calling module can actually open,
 * filtered by the module's own declared formats.
 *
 * The module declares what it opens; the pure matcher in
 * ``shared/lib/projectFileFormats`` decides what qualifies. Formats that only
 * become viewable after the DDC cad2data conversion (RVT, IFC) are shown with
 * a "needs conversion" note rather than being offered as an instant open, and
 * formats that another module handles (DWG in the BIM viewer) say so. Nothing
 * is offered that would silently fail to load.
 *
 * This ADDS a way to open a file. Every caller keeps its local-upload path.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText, FolderOpen, Loader2, Search, Wand2 } from 'lucide-react';

import {
  downloadDocumentBlob,
  fetchDocuments,
  type DocumentItem,
} from '@/features/documents/api';
import { formatFileSize } from '@/shared/lib/formatters';
import {
  acceptedFormatLabel,
  filterProjectFiles,
  type AcceptedFormat,
} from '@/shared/lib/projectFileFormats';

import { WideModal } from './WideModal';

/**
 * Download a stored project document and wrap it in a ``File``, so a picked
 * file can be handed to the exact same handler a local upload uses.
 *
 * Every viewer module already has a working "here is a File, open it" path
 * (validated, instrumented, with its own error handling). Reusing it is what
 * keeps this feature additive: the picker becomes another way to produce a
 * File rather than a second, divergent loading pipeline. ``fetchDocuments``
 * is auth-aware and so is ``downloadDocumentBlob`` - a bare URL handed to a
 * loader would 401.
 */
export async function projectDocumentToFile(doc: DocumentItem): Promise<File> {
  const blob = await downloadDocumentBlob(doc.id);
  return new File([blob], doc.name, {
    // Prefer the blob's own type; the stored mime_type is nullable and is
    // frequently wrong for CAD payloads (see projectFileFormats).
    type: blob.type || doc.mime_type || 'application/octet-stream',
  });
}

export interface ProjectFilePickerProps {
  open: boolean;
  onClose: () => void;
  /** Project whose Files area is listed. */
  projectId: string;
  /**
   * Formats the calling module can open. Use one of the exported per-module
   * sets in ``shared/lib/projectFileFormats`` rather than an inline literal,
   * so the list stays tied to what the module's loader really handles.
   */
  accepted: readonly AcceptedFormat[];
  /**
   * Fired with the chosen stored document. The caller decides how to open it
   * - most callers download the bytes and feed their existing upload/open
   * path, which keeps one code path for local and stored files alike.
   */
  onPick: (doc: DocumentItem) => void;
  /** Optional override for the modal title. */
  title?: string;
  /** Id of the file currently being opened, so its row can show a spinner. */
  busyId?: string | null;
}

export function ProjectFilePicker({
  open,
  onClose,
  projectId,
  accepted,
  onPick,
  title,
  busyId = null,
}: ProjectFilePickerProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');

  const documentsQuery = useQuery({
    queryKey: ['documents', projectId],
    queryFn: () => fetchDocuments(projectId),
    enabled: open && Boolean(projectId),
    staleTime: 15_000,
  });

  // Newest first: the drawing a user wants to open is almost always the one
  // just filed. Sorting here (not in the matcher) keeps the filter pure.
  const matches = useMemo(() => {
    const sorted = [...(documentsQuery.data ?? [])].sort((a, b) =>
      (b.created_at ?? '').localeCompare(a.created_at ?? ''),
    );
    return filterProjectFiles(sorted, accepted, search);
  }, [documentsQuery.data, accepted, search]);

  // Distinguishes "the project has nothing this module opens" from "your
  // search matched nothing", which need different wording and different fixes.
  const totalOpenable = useMemo(
    () => filterProjectFiles(documentsQuery.data ?? [], accepted).length,
    [documentsQuery.data, accepted],
  );

  const formatList = useMemo(() => acceptedFormatLabel(accepted), [accepted]);
  const loading = documentsQuery.isLoading;

  return (
    <WideModal
      open={open}
      onClose={onClose}
      size="lg"
      title={title ?? t('project_files.picker_title', { defaultValue: 'Open from project files' })}
      subtitle={t('project_files.picker_subtitle', {
        defaultValue:
          'Files already stored in this project that this module can open. Formats: {{formats}}',
        formats: formatList,
      })}
    >
      <div className="flex flex-col gap-3">
        {/* Search */}
        <div className="relative">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-content-quaternary"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label={t('project_files.picker_search_aria', {
              defaultValue: 'Search project files by name',
            })}
            placeholder={t('project_files.picker_search_placeholder', {
              defaultValue: 'Search by file name...',
            })}
            className="w-full rounded-lg border border-border-medium bg-surface-primary py-2 pl-9 pr-3 text-sm text-content-primary placeholder:text-content-quaternary focus:border-oe-blue focus:outline-none focus:ring-2 focus:ring-oe-blue/20"
          />
        </div>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-content-tertiary">
            <Loader2 size={16} className="animate-spin" />
            {t('project_files.picker_loading', { defaultValue: 'Loading project files...' })}
          </div>
        )}

        {!loading && matches.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-medium px-6 py-10 text-center">
            <FolderOpen size={24} className="text-content-quaternary" />
            {totalOpenable === 0 ? (
              <>
                <p className="text-sm font-semibold text-content-primary">
                  {t('project_files.picker_empty_title', {
                    defaultValue: 'No compatible file in this project yet',
                  })}
                </p>
                <p className="max-w-md text-xs leading-relaxed text-content-tertiary">
                  {t('project_files.picker_empty_body', {
                    defaultValue:
                      'This project has no {{formats}} file stored yet. Add one in Files, or upload it here from your computer.',
                    formats: formatList,
                  })}
                </p>
                <Link
                  to="/files"
                  onClick={onClose}
                  className="mt-1 text-xs font-semibold text-oe-blue hover:underline"
                >
                  {t('project_files.picker_go_to_files', { defaultValue: 'Go to Files' })}
                </Link>
              </>
            ) : (
              <p className="text-sm text-content-tertiary">
                {t('project_files.picker_no_search_match', {
                  defaultValue: 'No file matches your search.',
                })}
              </p>
            )}
          </div>
        )}

        {!loading && matches.length > 0 && (
          <ul className="max-h-[22rem] space-y-1.5 overflow-y-auto pr-1">
            {matches.map(({ doc, match }) => (
              <li key={doc.id}>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => onPick(doc)}
                  data-testid="project-file-picker-row"
                  className="group flex w-full items-center gap-3 rounded-lg border border-border-light bg-surface-primary px-3 py-2.5 text-left transition-all hover:border-oe-blue/40 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-oe-blue/40 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-light bg-surface-secondary text-content-tertiary group-hover:text-oe-blue">
                    {busyId === doc.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <FileText size={14} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-content-primary">
                      {doc.name}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-content-tertiary">
                      <span className="font-mono uppercase">{match.ext.replace(/^\./, '')}</span>
                      <span>·</span>
                      <span>{formatFileSize(doc.file_size ?? 0)}</span>
                      {doc.drawing_number ? (
                        <>
                          <span>·</span>
                          <span className="truncate">{doc.drawing_number}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {/* Honest labelling: say what will really happen rather than
                      implying every format opens instantly in this module. */}
                  {match.handoff ? (
                    <span className="shrink-0 rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      {t('project_files.picker_opens_elsewhere', {
                        defaultValue: 'Opens in another module',
                      })}
                    </span>
                  ) : match.needsConversion ? (
                    <span className="flex shrink-0 items-center gap-1 rounded-md border border-violet-500/20 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400">
                      <Wand2 size={10} />
                      {t('project_files.picker_needs_conversion', {
                        defaultValue: 'Converts first',
                      })}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </WideModal>
  );
}
