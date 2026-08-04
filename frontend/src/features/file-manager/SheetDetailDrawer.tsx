// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Detail panel for one indexed drawing sheet.
 *
 * The register used to be a dead end: every row carried a `document_id` and a
 * `page_number` and nothing was clickable, so the only thing a user could do
 * after finding a drawing was read its number back off the screen. This panel
 * is the way out of the table - it names the sheet, shows the revision chain
 * the backend has always tracked but never surfaced, and links into the two
 * places a found drawing is actually used.
 *
 * Both links are deep-links that already exist, not new endpoints:
 *
 *   * Plan room takes `?doc=<document id>&page=<n>` and reads its drawing list
 *     straight off `/v1/documents/`, which is the same table `Sheet.document_id`
 *     points at, so the id needs no translation.
 *   * Takeoff takes `?doc=<document id>&source=document`, which asks the
 *     backend to find-or-create the matching takeoff document (idempotent, so
 *     re-opening reuses the row), plus `?page=<n>` to land on the sheet's own
 *     page rather than page 1.
 *
 * There is deliberately no drawing preview here. A sheet's rendered PNG is
 * stored as a server filesystem path and no route serves it to an authenticated
 * client - the only reader is the HMAC share-token flow, which mints a public
 * link and is the wrong shape for this. Rather than point an `<AuthImage>` at a
 * URL that 404s, the panel says plainly that the preview is not available and
 * leaves the user the two links that do work.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowRight, FileText, History, ImageOff, Ruler } from 'lucide-react';
import { Badge, DateDisplay, SideDrawer } from '@/shared/ui';
import { apiGet } from '@/shared/lib/api';
import type { SheetRow } from './types';

/** Mirrors `SheetVersionHistory` from the documents module. `current` is the
 *  sheet that was asked about, NOT necessarily the newest one; `history` is
 *  every other sheet on the chain, oldest first. */
interface SheetVersionHistory {
  current: SheetRow;
  history: SheetRow[];
}

export interface SheetDetailDrawerProps {
  /** The sheet to describe. `null` closes the drawer. */
  sheet: SheetRow | null;
  onClose: () => void;
}

/** One label/value line. Renders an em dash when the field is not set, so the
 *  panel keeps the same shape whether or not the PDF carried a title block. */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-2xs uppercase tracking-wider text-content-tertiary">{label}</dt>
      <dd className="min-w-0 truncate text-end text-sm text-content-primary">
        {value ?? <span className="text-content-quaternary">&mdash;</span>}
      </dd>
    </div>
  );
}

export function SheetDetailDrawer({ sheet, onClose }: SheetDetailDrawerProps) {
  const { t } = useTranslation();

  const { data: versions, isLoading: versionsLoading } = useQuery({
    queryKey: ['sheet-versions', sheet?.id],
    queryFn: () => apiGet<SheetVersionHistory>(`/v1/documents/sheets/${sheet?.id}/versions/`),
    enabled: !!sheet?.id,
  });

  /* The whole chain in one list, oldest first, so the panel can render it as a
     single sequence instead of "this one" plus "some others". The backend hands
     back the asked-for sheet separately from the rest of the chain. */
  const chain = useMemo(() => {
    if (!versions) return [];
    const all = [versions.current, ...versions.history];
    return all.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }, [versions]);

  /* What replaced this sheet. Only meaningful for a superseded row, and only
     when the chain actually holds a current one - a chain whose head was
     deleted has no answer, and inventing one would be worse than the gap. */
  const supersededBy = useMemo(() => {
    if (!sheet || sheet.is_current) return null;
    return chain.find((s) => s.is_current && s.id !== sheet.id) ?? null;
  }, [chain, sheet]);

  if (!sheet) return null;

  const sheetName = sheet.sheet_number ?? `p.${sheet.page_number}`;
  const planRoomTo = `/plan-room?doc=${encodeURIComponent(sheet.document_id)}&page=${sheet.page_number}`;
  const takeoffTo =
    `/takeoff?tab=measurements&source=document&doc=${encodeURIComponent(sheet.document_id)}` +
    `&page=${sheet.page_number}`;
  const filesTo = `/files?file=${encodeURIComponent(sheet.document_id)}`;

  const actionCls =
    'inline-flex items-center justify-between gap-2 rounded-lg border border-border-light px-3 py-2.5 text-sm font-medium text-content-primary transition-colors hover:border-oe-blue hover:bg-surface-secondary';

  return (
    <SideDrawer
      open
      onClose={onClose}
      title={sheetName}
      subtitle={sheet.sheet_title ?? undefined}
      widthClass="max-w-md"
    >
      <div className="p-5">
        {/* Preview slot. Honest about why it is empty - see the file header. */}
        <div className="mb-5 flex h-32 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-light bg-surface-secondary/40 text-content-tertiary">
          <ImageOff size={20} strokeWidth={1.5} />
          <p className="px-4 text-center text-2xs">
            {t('sheets.preview_unavailable', {
              defaultValue: 'No preview available for this sheet yet.',
            })}
          </p>
        </div>

        {/* Metadata */}
        <dl className="divide-y divide-border-light">
          <Field
            label={t('sheets.col_number', { defaultValue: 'Sheet #' })}
            value={sheet.sheet_number}
          />
          <Field
            label={t('sheets.col_title', { defaultValue: 'Title' })}
            value={sheet.sheet_title}
          />
          <Field
            label={t('sheets.col_discipline', { defaultValue: 'Discipline' })}
            value={sheet.discipline}
          />
          <Field
            label={t('sheets.col_revision', { defaultValue: 'Rev' })}
            value={sheet.revision}
          />
          <Field
            label={t('sheets.col_scale', { defaultValue: 'Scale' })}
            value={sheet.scale}
          />
          <Field
            label={t('sheets.col_page', { defaultValue: 'Page' })}
            value={String(sheet.page_number)}
          />
        </dl>

        {/* Revision standing */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge variant={sheet.is_current ? 'success' : 'warning'} size="sm">
            {sheet.is_current
              ? t('sheets.is_current_yes', { defaultValue: 'Current revision' })
              : t('sheets.is_current_no', { defaultValue: 'Superseded' })}
          </Badge>
          {supersededBy && (
            <span className="text-xs text-content-secondary">
              {t('sheets.superseded_by', {
                defaultValue: 'Replaced by revision {{revision}}',
                revision:
                  supersededBy.revision ??
                  supersededBy.sheet_number ??
                  `p.${supersededBy.page_number}`,
              })}
            </span>
          )}
        </div>

        {/* Version chain. Present whenever the sheet has more than itself on
            the chain - a one-entry chain says nothing a badge has not said. */}
        {(versionsLoading || chain.length > 1) && (
          <section className="mt-6">
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-content-primary">
              <History size={14} className="text-oe-blue" />
              {t('sheets.version_history', { defaultValue: 'Revision history' })}
            </h3>
            {versionsLoading ? (
              <p className="text-xs text-content-tertiary">
                {t('sheets.version_loading', { defaultValue: 'Loading revisions…' })}
              </p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {chain.map((v) => (
                  <li
                    key={v.id}
                    className={clsx(
                      'flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs',
                      v.id === sheet.id
                        ? 'border-oe-blue bg-oe-blue-subtle'
                        : 'border-border-light bg-surface-secondary/40',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge variant={v.is_current ? 'success' : 'neutral'} size="sm">
                        {v.revision ??
                          t('sheets.revision_unset', { defaultValue: 'No rev' })}
                      </Badge>
                      <span className="truncate text-content-secondary">
                        {v.sheet_title ?? v.sheet_number ?? `p.${v.page_number}`}
                      </span>
                    </span>
                    <span className="shrink-0 text-content-tertiary">
                      <DateDisplay value={v.revision_date ?? v.created_at} format="relative" />
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        {/* Where this sheet goes next */}
        <section className="mt-6">
          <h3 className="mb-2 text-xs font-semibold text-content-primary">
            {t('sheets.open_in', { defaultValue: 'Open this sheet in' })}
          </h3>
          <div className="flex flex-col gap-2">
            <Link to={planRoomTo} className={actionCls}>
              <span className="flex items-center gap-2">
                <FileText size={15} className="text-oe-blue" />
                {t('sheets.open_plan_room', { defaultValue: 'Plan room' })}
              </span>
              <ArrowRight size={14} className="text-content-tertiary" />
            </Link>
            <Link to={takeoffTo} className={actionCls}>
              <span className="flex items-center gap-2">
                <Ruler size={15} className="text-oe-blue" />
                {t('sheets.open_takeoff', { defaultValue: 'PDF takeoff, to measure it' })}
              </span>
              <ArrowRight size={14} className="text-content-tertiary" />
            </Link>
            <Link to={filesTo} className={actionCls}>
              <span className="flex items-center gap-2">
                <FileText size={15} className="text-oe-blue" />
                {t('sheets.open_source_document', { defaultValue: 'The drawing set it came from' })}
              </span>
              <ArrowRight size={14} className="text-content-tertiary" />
            </Link>
          </div>
        </section>
      </div>
    </SideDrawer>
  );
}
