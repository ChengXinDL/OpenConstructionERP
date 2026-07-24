// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// FileApprovalsRegisterPage — a project-wide register of every file
// submitted for approval, with a one-click "Export to Excel" action that
// produces the compliance artifact (backend: GET /v1/file-approvals/export/).
//
// The list is the same data the per-file ApprovalDrawer shows, rolled up to
// the project so the whole approval trail is auditable in one place. The
// export trigger mirrors the RFI log export (authenticated binary GET +
// client-side save + success/error toast).

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { ClipboardCheck, Download, Loader2 } from 'lucide-react';

import {
  Badge,
  Breadcrumb,
  Button,
  Card,
  EmptyState,
  RecoveryCard,
  SkeletonTable,
} from '@/shared/ui';
import { PageHeader } from '@/shared/ui/PageHeader';
import { DateDisplay } from '@/shared/ui/DateDisplay';
import { RequiresProject } from '@/shared/auth/RequiresProject';
import { apiGet } from '@/shared/lib/api';
import { useProjectContextStore } from '@/stores/useProjectContextStore';
import { useToastStore } from '@/stores/useToastStore';

import { downloadApprovalRegister } from './api';
import { useApprovals } from './hooks';
import type { ApprovalWorkflow, WorkflowStatus } from './types';

const WORKFLOW_STATUSES: WorkflowStatus[] = [
  'in_review',
  'approved',
  'rejected',
  'withdrawn',
];

const STATUS_VARIANT: Record<
  string,
  'neutral' | 'blue' | 'success' | 'warning' | 'error'
> = {
  in_review: 'blue',
  approved: 'success',
  rejected: 'error',
  withdrawn: 'neutral',
};

/** First still-pending step = the actionable "ball in court", derived the
 *  same way the drawer highlights it. Empty for terminal workflows. */
function currentStepLabel(w: ApprovalWorkflow): string {
  const pending = [...w.steps]
    .sort((a, b) => a.sort_order - b.sort_order)
    .find((s) => s.decision === 'pending');
  if (!pending) return '';
  const who = pending.role_label || pending.approver_id.slice(0, 8);
  return `#${pending.sort_order + 1}: ${who}`;
}

export function FileApprovalsRegisterPage() {
  return (
    <RequiresProject>
      <RegisterInner />
    </RequiresProject>
  );
}

function RegisterInner() {
  const { t } = useTranslation();
  const { projectId: routeProjectId } = useParams<{ projectId?: string }>();
  const activeProjectId = useProjectContextStore((s) => s.activeProjectId);
  const addToast = useToastStore((s) => s.addToast);

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiGet<{ id: string; name: string }[]>('/v1/projects/'),
    staleTime: 5 * 60_000,
  });
  const projectId = routeProjectId || activeProjectId || projects[0]?.id || '';
  const projectName = projects.find((p) => p.id === projectId)?.name || '';

  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | ''>('');

  const {
    data: workflows = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useApprovals(projectId, statusFilter || undefined);

  const exportMut = useMutation({
    mutationFn: () => downloadApprovalRegister(projectId),
    onSuccess: () =>
      addToast({
        type: 'success',
        title: t('files.approvals.export_success', {
          defaultValue: 'Approvals register exported',
        }),
      }),
    onError: (e: Error) =>
      addToast({
        type: 'error',
        title: t('files.approvals.export_failed', {
          defaultValue: 'Failed to export approvals register',
        }),
        message: e.message,
      }),
  });

  return (
    <div className="space-y-5 animate-fade-in">
      <Breadcrumb
        items={[
          ...(projectId && projectName
            ? [{ label: projectName, to: `/projects/${projectId}` }]
            : []),
          {
            label: t('files.approvals.register_title', {
              defaultValue: 'Approvals register',
            }),
          },
        ]}
      />

      <PageHeader
        srTitle={t('files.approvals.register_title', {
          defaultValue: 'Approvals register',
        })}
        subtitle={t('files.approvals.register_subtitle', {
          defaultValue:
            'Every file submitted for approval, with its current approver, status and decision trail.',
        })}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={
              exportMut.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )
            }
            onClick={() => exportMut.mutate()}
            disabled={exportMut.isPending || !projectId || workflows.length === 0}
            data-guide="file-approvals-export"
          >
            {t('files.approvals.export', { defaultValue: 'Export to Excel' })}
          </Button>
        }
      />

      <div className="flex items-center gap-2">
        <label className="text-xs text-content-secondary">
          {t('files.approvals.filter_status', { defaultValue: 'Status' })}
        </label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as WorkflowStatus | '')}
          className="h-8 rounded-md border border-border bg-surface-primary px-2 text-xs focus:outline-none focus:ring-2 focus:ring-oe-blue/30 focus:border-oe-blue cursor-pointer"
          aria-label={t('files.approvals.filter_status', { defaultValue: 'Status' })}
        >
          <option value="">
            {t('files.approvals.all_statuses', { defaultValue: 'All statuses' })}
          </option>
          {WORKFLOW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`files.approvals.status.${s}`, {
                defaultValue:
                  s.charAt(0).toUpperCase() + s.slice(1).replace('_', ' '),
              })}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <SkeletonTable rows={5} columns={4} />
      ) : isError ? (
        <RecoveryCard error={error as Error} onRetry={() => void refetch()} />
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={28} strokeWidth={1.5} />}
          title={t('files.approvals.empty_register_title', {
            defaultValue: 'No approvals yet',
          })}
          description={t('files.approvals.empty_register_desc', {
            defaultValue:
              'Files submitted for approval from the Files module appear here. Submit one to start the register.',
          })}
        />
      ) : (
        <Card padding="none" className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-border-light bg-surface-secondary/40">
                  <th className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
                    {t('files.approvals.col_file', { defaultValue: 'File' })}
                  </th>
                  <th className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-content-tertiary w-[140px]">
                    {t('files.approvals.col_submitted', {
                      defaultValue: 'Submitted',
                    })}
                  </th>
                  <th className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-content-tertiary w-[120px]">
                    {t('files.approvals.col_status', { defaultValue: 'Status' })}
                  </th>
                  <th className="px-3 py-2 text-left text-2xs font-semibold uppercase tracking-wider text-content-tertiary">
                    {t('files.approvals.col_current_step', {
                      defaultValue: 'Current step',
                    })}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {workflows.map((w) => {
                  const step = currentStepLabel(w);
                  return (
                    <tr
                      key={w.id}
                      className="hover:bg-surface-secondary/30 transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium text-content-primary break-all">
                            {w.file_id}
                          </span>
                          <span className="text-2xs uppercase tracking-wide text-content-tertiary">
                            {w.file_kind}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-content-tertiary">
                        <DateDisplay value={w.submitted_at} />
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge
                          variant={STATUS_VARIANT[w.status] ?? 'neutral'}
                          size="sm"
                        >
                          {t(`files.approvals.status.${w.status}`, {
                            defaultValue:
                              w.status.charAt(0).toUpperCase() +
                              w.status.slice(1).replace('_', ' '),
                          })}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-content-secondary">
                        {step || (
                          <span className="text-content-tertiary">
                            {t('files.approvals.no_current_step', {
                              defaultValue: 'Complete',
                            })}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
