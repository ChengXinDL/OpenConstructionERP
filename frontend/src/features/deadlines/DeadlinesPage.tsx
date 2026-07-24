// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * DeadlinesPage - the cross-module deadline register (item #18).
 *
 * Aggregates overdue + approaching work from across modules (correspondence
 * response deadlines, NCR corrective actions, punch items) into one read-only
 * register, grouped by module and filterable by all / overdue / approaching.
 * Server state lives entirely in React Query - no new Zustand store.
 */
import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlarmClock, ArrowRight, CalendarClock, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { Button } from '@/shared/ui';
import { useProjectContextStore } from '@/stores/useProjectContextStore';
import { fetchDeadlines, type DeadlineItem, type DeadlineStatusFilter } from './api';

const FILTERS: DeadlineStatusFilter[] = ['all', 'overdue', 'approaching'];

const MODULE_LABELS: Record<string, { key: string; def: string }> = {
  correspondence: { key: 'deadlines.module.correspondence', def: 'Correspondence' },
  qms_ncr_action: { key: 'deadlines.module.qms_ncr_action', def: 'NCR actions' },
  punchlist: { key: 'deadlines.module.punchlist', def: 'Punch list' },
};

/** Humanise a source-native status string ("awaiting_response" -> "Awaiting response"). */
function humaniseStatus(status: string): string {
  const s = status.replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export function DeadlinesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const projectId = useProjectContextStore((s) => s.activeProjectId) ?? '';
  const [statusFilter, setStatusFilter] = useState<DeadlineStatusFilter>('all');

  const query = useQuery({
    queryKey: ['deadlines', projectId, statusFilter],
    queryFn: () => fetchDeadlines({ project_id: projectId, status: statusFilter }),
    enabled: !!projectId,
  });

  // Group items by module, preserving the backend's overdue-first ordering.
  const groups = useMemo(() => {
    const items = query.data?.items ?? [];
    const byModule = new Map<string, DeadlineItem[]>();
    for (const it of items) {
      const arr = byModule.get(it.module) ?? [];
      arr.push(it);
      byModule.set(it.module, arr);
    }
    return Array.from(byModule.entries());
  }, [query.data]);

  const overdueCount = query.data?.overdue_count ?? 0;
  const approachingCount = query.data?.approaching_count ?? 0;

  function daysChip(it: DeadlineItem): { text: string; overdue: boolean } {
    if (it.days_overdue > 0) {
      return {
        text: t('deadlines.overdue_by', { count: it.days_overdue, defaultValue: '{{count}}d overdue' }),
        overdue: true,
      };
    }
    if (it.days_overdue === 0) {
      return { text: t('deadlines.due_today', { defaultValue: 'Due today' }), overdue: false };
    }
    return {
      text: t('deadlines.due_in', { count: -it.days_overdue, defaultValue: 'in {{count}}d' }),
      overdue: false,
    };
  }

  function filterLabel(f: DeadlineStatusFilter): string {
    if (f === 'overdue') {
      return t('deadlines.filter.overdue', { defaultValue: 'Overdue' });
    }
    if (f === 'approaching') {
      return t('deadlines.filter.approaching', { defaultValue: 'Approaching' });
    }
    return t('deadlines.filter.all', { defaultValue: 'All' });
  }

  function filterCount(f: DeadlineStatusFilter): number | null {
    if (f === 'overdue') return overdueCount;
    if (f === 'approaching') return approachingCount;
    return null;
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <CalendarClock size={22} className="mt-0.5 shrink-0 text-oe-blue" />
          <div>
            <h1 className="text-xl font-semibold text-content-primary">
              {t('deadlines.register_title', { defaultValue: 'Deadline register' })}
            </h1>
            <p className="mt-0.5 text-sm text-content-secondary">
              {t('deadlines.subtitle', {
                defaultValue: 'Overdue and upcoming items across every module, in one place.',
              })}
            </p>
          </div>
        </div>
        <Link
          to="/notifications"
          className="inline-flex items-center gap-1 text-sm font-medium text-oe-blue hover:underline"
        >
          {t('deadlines.settings_link', { defaultValue: 'Notification settings' })}
          <ArrowRight size={14} />
        </Link>
      </div>

      {/* Filter segmented control */}
      <div className="mb-4 inline-flex rounded-lg border border-border-light bg-surface-secondary p-0.5">
        {FILTERS.map((f) => {
          const count = filterCount(f);
          const active = statusFilter === f;
          return (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                active
                  ? 'bg-surface-elevated text-content-primary shadow-sm'
                  : 'text-content-secondary hover:text-content-primary',
              )}
            >
              {filterLabel(f)}
              {count !== null && count > 0 && (
                <span
                  className={clsx(
                    'ms-1.5 rounded-full px-1.5 py-0.5 text-xs font-semibold',
                    f === 'overdue'
                      ? 'bg-semantic-error/10 text-semantic-error'
                      : 'bg-semantic-warning/10 text-semantic-warning',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Body states */}
      {!projectId ? (
        <div className="p-12 text-center">
          <CalendarClock size={28} strokeWidth={1.5} className="mx-auto mb-2 text-content-tertiary" />
          <p className="text-sm text-content-secondary">
            {t('deadlines.no_project', { defaultValue: 'Select a project to see its deadlines.' })}
          </p>
        </div>
      ) : query.isLoading ? (
        <div className="flex items-center justify-center p-8 text-content-tertiary">
          <Loader2 className="me-2 animate-spin" size={16} />
          {t('common.loading', { defaultValue: 'Loading...' })}
        </div>
      ) : query.isError ? (
        <div className="p-8 text-center">
          <XCircle size={24} className="mx-auto mb-2 text-semantic-error" />
          <p className="mb-3 text-sm text-content-secondary">
            {t('deadlines.load_error', { defaultValue: "Couldn't load the deadline register" })}
          </p>
          <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
            {t('common.retry', { defaultValue: 'Try again' })}
          </Button>
        </div>
      ) : groups.length === 0 ? (
        <div className="p-12 text-center">
          <CheckCircle2 size={28} strokeWidth={1.5} className="mx-auto mb-2 text-semantic-success" />
          <p className="text-sm text-content-secondary">
            {t('deadlines.empty', {
              defaultValue: "Nothing overdue or approaching. You're on top of it.",
            })}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-elevated">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border-light text-start text-xs uppercase tracking-wide text-content-tertiary">
                <th className="px-4 py-2.5 text-start font-medium">
                  {t('deadlines.col.title', { defaultValue: 'Item' })}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {t('deadlines.col.due', { defaultValue: 'Due' })}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {t('deadlines.col.days', { defaultValue: 'Days' })}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {t('deadlines.col.owner', { defaultValue: 'Owner' })}
                </th>
                <th className="px-4 py-2.5 text-start font-medium">
                  {t('deadlines.col.status', { defaultValue: 'Status' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map(([moduleKey, items]) => {
                const label = MODULE_LABELS[moduleKey] ?? { key: `deadlines.module.${moduleKey}`, def: moduleKey };
                return (
                  <Fragment key={`grp-${moduleKey}`}>
                    <tr className="bg-surface-secondary/60">
                      <td
                        colSpan={5}
                        className="px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-content-secondary"
                      >
                        {t(label.key, { defaultValue: label.def })}
                        <span className="ms-2 font-normal text-content-tertiary">({items.length})</span>
                      </td>
                    </tr>
                    {items.map((it) => {
                      const chip = daysChip(it);
                      return (
                        <tr
                          key={it.id}
                          onClick={() => navigate(it.action_url)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') navigate(it.action_url);
                          }}
                          tabIndex={0}
                          className="cursor-pointer border-b border-border-light/60 last:border-0 hover:bg-surface-secondary/40 focus:bg-surface-secondary/40 focus:outline-none"
                        >
                          <td className="px-4 py-2.5 text-content-primary">{it.title}</td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-content-secondary">
                            {it.due_date ? it.due_date.slice(0, 10) : '-'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5">
                            <span
                              className={clsx(
                                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                                chip.overdue
                                  ? 'bg-semantic-error/10 text-semantic-error'
                                  : 'bg-semantic-warning/10 text-semantic-warning',
                              )}
                            >
                              <AlarmClock size={11} />
                              {chip.text}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-content-secondary">
                            {it.owner_name ?? (
                              <span className="italic text-content-tertiary">
                                {t('deadlines.no_owner', { defaultValue: 'Unassigned' })}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-content-secondary">
                            {humaniseStatus(it.status)}
                          </td>
                        </tr>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
