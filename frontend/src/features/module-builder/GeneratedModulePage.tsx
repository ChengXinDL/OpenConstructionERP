// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The screen for a module that was built on this instance.
 *
 * The frontend is a compiled bundle. A module installed at runtime cannot ship
 * a screen of its own, so it ships a description of one - the specification it
 * serves at `{base_path}/ui-spec` - and this page renders the list, the detail
 * and the form from it. One component serves every module ever built here.
 *
 * Where `base_path` comes from is the part worth being careful about. The
 * loader mounts a module at the hyphenated form of its key, and that rule lives
 * in the loader. Rebuilding it here from the route parameter would be a second
 * copy of it, so the page looks the module up in the installed list the server
 * returns and uses the `base_path` it was given. The route carries the key,
 * which is stable and readable; the URL the key resolves to is the server's
 * business.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, FolderOpen, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';

import {
  Button,
  CollapsibleSection,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonTable,
} from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { useProjectContextStore } from '@/stores/useProjectContextStore';

import {
  deleteModuleRecord,
  fetchInstalledModules,
  fetchModuleRecords,
  fetchModuleUiSpec,
  type GeneratedRecord,
} from './api';
import { formatValue, listColumns } from './fields';
import { RecordFormModal } from './RecordFormModal';

/** Shared by every query on this page so an install or a save invalidates them together. */
export const RUNTIME_MODULE_QUERY_KEY = 'runtime-module';

export function GeneratedModulePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const { moduleKey, projectId: routeProjectId } = useParams<{
    moduleKey?: string;
    projectId?: string;
  }>();
  const activeProjectId = useProjectContextStore((s) => s.activeProjectId);
  const projectId = routeProjectId || activeProjectId || '';

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<GeneratedRecord | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GeneratedRecord | null>(null);

  const installedQuery = useQuery({
    queryKey: ['module-builder', 'installed'],
    queryFn: fetchInstalledModules,
    staleTime: 5 * 60_000,
  });
  const installed = installedQuery.data?.items.find((m) => m.key === moduleKey);
  const basePath = installed?.base_path ?? '';

  const specQuery = useQuery({
    queryKey: [RUNTIME_MODULE_QUERY_KEY, 'ui-spec', basePath],
    queryFn: () => fetchModuleUiSpec(basePath),
    enabled: basePath !== '',
    // The spec only changes when the module is reinstalled, and the install
    // invalidates this key itself.
    staleTime: 30 * 60_000,
  });
  const spec = specQuery.data;

  const scoped = spec?.entity.project_scoped ?? false;
  const missingProject = scoped && !projectId;

  const recordsQuery = useQuery({
    queryKey: [RUNTIME_MODULE_QUERY_KEY, 'records', basePath, scoped ? projectId : null],
    queryFn: () => fetchModuleRecords(basePath, { projectId: scoped ? projectId : null, limit: 200 }),
    enabled: basePath !== '' && spec !== undefined && !missingProject,
  });

  const columns = useMemo(() => (spec ? listColumns(spec) : []), [spec]);

  const removal = useMutation({
    mutationFn: (record: GeneratedRecord) => deleteModuleRecord(basePath, record.id),
    onSuccess: () => {
      addToast({ type: 'success', title: t('runtime_module.deleted', { defaultValue: 'Deleted' }) });
      void qc.invalidateQueries({ queryKey: [RUNTIME_MODULE_QUERY_KEY, 'records', basePath] });
      setPendingDelete(null);
    },
    onError: (err) => {
      addToast({ type: 'error', title: getErrorMessage(err) });
      setPendingDelete(null);
    },
  });

  const labels = {
    yes: t('common.yes', { defaultValue: 'Yes' }),
    no: t('common.no', { defaultValue: 'No' }),
    empty: '—',
  };

  if (installedQuery.isLoading) {
    return <SkeletonTable rows={6} columns={5} />;
  }

  if (installedQuery.isError) {
    return (
      <ErrorState
        title={t('runtime_module.load_failed', { defaultValue: 'This module could not be loaded' })}
        hint={getErrorMessage(installedQuery.error)}
        onRetry={() => void installedQuery.refetch()}
      />
    );
  }

  if (!installed) {
    return (
      <EmptyState
        icon={<Boxes size={28} strokeWidth={1.5} />}
        title={t('runtime_module.not_installed', { defaultValue: 'No such module on this instance' })}
        description={t('runtime_module.not_installed_hint', {
          defaultValue:
            'It may have been removed. The modules built here are listed on the module builder page.',
        })}
        action={
          <Link
            to="/module-builder"
            className="text-sm font-medium text-oe-blue-text hover:text-oe-blue-hover"
          >
            {t('module_builder.title', { defaultValue: 'Module builder' })}
          </Link>
        }
      />
    );
  }

  if (specQuery.isError) {
    return (
      <ErrorState
        title={t('runtime_module.no_spec', { defaultValue: 'This module did not describe its screen' })}
        hint={getErrorMessage(specQuery.error)}
        onRetry={() => void specQuery.refetch()}
      />
    );
  }

  if (!spec) {
    return <SkeletonTable rows={6} columns={5} />;
  }

  const records = recordsQuery.data?.items ?? [];

  return (
    <div className="space-y-4" data-testid="runtime-module-page">
      <PageHeader
        srTitle={spec.display_name}
        subtitle={spec.description || undefined}
        actions={
          <Button
            variant="primary"
            size="sm"
            icon={<Plus size={14} />}
            disabled={missingProject}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
            data-testid="runtime-module-new"
          >
            {t('runtime_module.new_record', {
              entity: spec.entity.display_name,
              defaultValue: 'New {{entity}}',
            })}
          </Button>
        }
      />

      {/* What this module is and what it checks. The rules are the module's own
          promise about its data, so they belong on the screen rather than only
          in whatever the author typed into the wizard. */}
      <CollapsibleSection
        storageKey={`runtime_module.${spec.key}.how`}
        title={spec.display_name}
        icon={<Boxes size={15} strokeWidth={1.9} />}
        subtitle={t('runtime_module.built_here', {
          defaultValue: 'Built on this instance from a description of it.',
        })}
      >
        <div className="space-y-3 text-sm text-content-secondary">
          {spec.description && <p>{spec.description}</p>}
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
              <ShieldCheck size={13} strokeWidth={2} />
              {t('runtime_module.rules_heading', { defaultValue: 'What this module checks' })}
            </p>
            <ul className="space-y-1">
              {spec.rules.map((rule) => (
                <li key={rule.code} className="text-xs text-content-tertiary">
                  {/* The author's own wording, shown as written. */}
                  {rule.message}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </CollapsibleSection>

      {missingProject ? (
        <EmptyState
          icon={<FolderOpen size={28} strokeWidth={1.5} />}
          title={t('requiresProject.title', { defaultValue: 'No project selected' })}
          description={t('runtime_module.needs_project', {
            defaultValue: 'These records belong to a project. Choose one before saving.',
          })}
        />
      ) : recordsQuery.isLoading ? (
        <SkeletonTable rows={6} columns={Math.max(columns.length, 3)} />
      ) : recordsQuery.isError ? (
        <ErrorState
          title={t('runtime_module.records_failed', { defaultValue: 'The records could not be read' })}
          hint={getErrorMessage(recordsQuery.error)}
          onRetry={() => void recordsQuery.refetch()}
        />
      ) : records.length === 0 ? (
        <EmptyState
          icon={<Boxes size={28} strokeWidth={1.5} />}
          title={t('runtime_module.empty_title', {
            entity: spec.entity.plural_name,
            defaultValue: 'No {{entity}} yet',
          })}
          description={t('runtime_module.empty_hint', {
            defaultValue: 'Nothing has been recorded here yet.',
          })}
          action={{
            label: t('runtime_module.new_record', {
              entity: spec.entity.display_name,
              defaultValue: 'New {{entity}}',
            }),
            onClick: () => {
              setEditing(null);
              setFormOpen(true);
            },
          }}
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border-light bg-surface-primary">
          <table className="w-full text-sm" data-testid="runtime-module-table">
            <thead>
              <tr className="border-b border-border-light text-left text-xs uppercase tracking-wide text-content-tertiary">
                {columns.map((column) => (
                  <th key={column.name} scope="col" className="px-3 py-2 font-medium">
                    {/* The author's label. Not translated: it is their data. */}
                    {column.label}
                    {column.unit && <span className="ml-1 normal-case">({column.unit})</span>}
                  </th>
                ))}
                <th scope="col" className="w-20 px-3 py-2 text-right font-medium">
                  {t('common.actions', { defaultValue: 'Actions' })}
                </th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr
                  key={record.id}
                  className="border-b border-border-light/60 last:border-0 hover:bg-surface-secondary/60"
                >
                  {columns.map((column) => (
                    <td key={column.name} className="px-3 py-2 text-content-primary">
                      {formatValue(column, record[column.name], labels)}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(record);
                          setFormOpen(true);
                        }}
                        aria-label={t('common.edit', { defaultValue: 'Edit' })}
                        className="rounded-md p-1.5 text-content-tertiary transition-colors hover:bg-surface-secondary hover:text-content-primary"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(record)}
                        aria-label={t('common.delete', { defaultValue: 'Delete' })}
                        className="rounded-md p-1.5 text-content-tertiary transition-colors hover:bg-semantic-error-subtle hover:text-semantic-error"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RecordFormModal
        open={formOpen}
        spec={spec}
        basePath={basePath}
        projectId={scoped ? projectId || null : null}
        record={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          setFormOpen(false);
          void qc.invalidateQueries({ queryKey: [RUNTIME_MODULE_QUERY_KEY, 'records', basePath] });
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('runtime_module.confirm_delete_title', {
          entity: spec.entity.display_name,
          defaultValue: 'Delete this {{entity}}?',
        })}
        message={t('runtime_module.confirm_delete_message', {
          defaultValue: 'The record is removed for everyone. This cannot be undone.',
        })}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        loading={removal.isPending}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) removal.mutate(pendingDelete);
        }}
      />
    </div>
  );
}

export default GeneratedModulePage;
