// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The modules built on this instance: what is installed, and how to remove one.
 *
 * Separate from the header button on purpose. The button is the action - build
 * something - and this is the register: anyone signed in can read it, because
 * knowing which modules an instance carries is part of knowing the instance.
 * Only an administrator sees the build and remove controls, and the server
 * enforces that on the call rather than trusting this page.
 *
 * Removal offers to drop the data as a second, explicit choice. Uninstalling a
 * module someone regrets installing should not also lose what was recorded with
 * it, so the records stay unless the box is ticked, and the table can still be
 * dropped later by uninstalling again.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, ExternalLink, Trash2, Wand2 } from 'lucide-react';

import {
  Badge,
  Button,
  CollapsibleSection,
  EmptyState,
  ErrorState,
  PageHeader,
  SkeletonTable,
  WideModal,
} from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';
import { useAuthStore } from '@/stores/useAuthStore';

import { fetchInstalledModules, uninstallModule, type InstalledModule } from './api';
import { ModuleBuilderWizard } from './ModuleBuilderWizard';
import { RUNTIME_MODULE_QUERY_KEY } from './GeneratedModulePage';

export function ModuleBuilderPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin';

  const [wizardOpen, setWizardOpen] = useState(false);
  const [pending, setPending] = useState<InstalledModule | null>(null);
  const [dropData, setDropData] = useState(false);

  const installedQuery = useQuery({
    queryKey: ['module-builder', 'installed'],
    queryFn: fetchInstalledModules,
    staleTime: 5 * 60_000,
  });

  const removal = useMutation({
    mutationFn: (module: InstalledModule) => uninstallModule(module.key, dropData),
    onSuccess: (result) => {
      addToast({
        type: 'success',
        title: result.data_dropped
          ? t('module_builder.removed_with_data', {
              defaultValue: 'Removed, and its records were dropped',
            })
          : t('module_builder.removed', { defaultValue: 'Removed. Its records are still there.' }),
      });
      void qc.invalidateQueries({ queryKey: ['module-builder', 'installed'] });
      void qc.invalidateQueries({ queryKey: [RUNTIME_MODULE_QUERY_KEY] });
      setPending(null);
      setDropData(false);
    },
    onError: (err) => {
      addToast({ type: 'error', title: getErrorMessage(err) });
      setPending(null);
    },
  });

  const modules = installedQuery.data?.items ?? [];

  const closeRemoval = () => {
    setPending(null);
    setDropData(false);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        srTitle={t('module_builder.title', { defaultValue: 'Module builder' })}
        subtitle={t('module_builder.page_subtitle', {
          defaultValue: 'Modules built on this instance, and where they live.',
        })}
        actions={
          isAdmin ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Wand2 size={14} />}
              onClick={() => setWizardOpen(true)}
              data-testid="module-builder-page-build"
            >
              {t('module_builder.header_button', { defaultValue: 'Build a module' })}
            </Button>
          ) : undefined
        }
      />

      <CollapsibleSection
        storageKey="module_builder.how"
        title={t('module_builder.title', { defaultValue: 'Module builder' })}
        icon={<Boxes size={15} strokeWidth={1.9} />}
        subtitle={t('module_builder.page_subtitle', {
          defaultValue: 'Modules built on this instance, and where they live.',
        })}
      >
        <ol className="list-decimal space-y-1 pl-4 text-sm text-content-secondary">
          <li>
            {t('module_builder.how_1', {
              defaultValue: 'Describe the register you need, in a sentence or by hand.',
            })}
          </li>
          <li>
            {t('module_builder.how_2', {
              defaultValue: 'Say what one record holds and what the module must check.',
            })}
          </li>
          <li>
            {t('module_builder.how_3', {
              defaultValue: 'Read every file it would write, then install it. No restart.',
            })}
          </li>
          <li>
            {t('module_builder.how_4', {
              defaultValue:
                'The module lives in this instance data directory, so a platform upgrade leaves it alone.',
            })}
          </li>
        </ol>
        {installedQuery.data?.runtime_root && (
          <p className="mt-2 font-mono text-xs text-content-tertiary">
            {installedQuery.data.runtime_root}
          </p>
        )}
      </CollapsibleSection>

      {installedQuery.isLoading ? (
        <SkeletonTable rows={4} columns={4} />
      ) : installedQuery.isError ? (
        <ErrorState
          title={t('module_builder.list_failed', { defaultValue: 'The list could not be read' })}
          hint={getErrorMessage(installedQuery.error)}
          onRetry={() => void installedQuery.refetch()}
        />
      ) : modules.length === 0 ? (
        <EmptyState
          icon={<Boxes size={28} strokeWidth={1.5} />}
          title={t('module_builder.empty_title', { defaultValue: 'Nothing has been built here yet' })}
          description={t('module_builder.empty_hint', {
            defaultValue:
              'A module built here is a register the platform did not ship: whatever this project actually records.',
          })}
          action={
            isAdmin
              ? {
                  label: t('module_builder.header_button', { defaultValue: 'Build a module' }),
                  onClick: () => setWizardOpen(true),
                }
              : undefined
          }
        />
      ) : (
        <ul className="space-y-2" data-testid="module-builder-list">
          {modules.map((module) => (
            <li
              key={module.key}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-light bg-surface-primary p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-content-primary">
                  {module.display_name}
                  <Badge variant="neutral" size="sm">
                    v{module.version}
                  </Badge>
                </p>
                <p className="mt-0.5 text-xs text-content-tertiary">
                  {t('module_builder.module_summary', {
                    entity: module.entity,
                    fields: module.field_count,
                    rules: module.rule_count,
                    defaultValue: '{{entity}} · {{fields}} fields · {{rules}} rules',
                  })}
                </p>
                <p className="mt-0.5 font-mono text-[11px] text-content-quaternary">{module.base_path}</p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to={`/modules/${module.key}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border-light px-2.5 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:bg-surface-secondary hover:text-content-primary"
                  data-testid={`module-builder-open-${module.key}`}
                >
                  <ExternalLink size={12} />
                  {t('module_builder.open_module', { defaultValue: 'Open the module' })}
                </Link>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setDropData(false);
                      setPending(module);
                    }}
                    aria-label={t('module_builder.uninstall', { defaultValue: 'Remove this module' })}
                    className="rounded-lg p-1.5 text-content-tertiary transition-colors hover:bg-semantic-error-subtle hover:text-semantic-error"
                    data-testid={`module-builder-remove-${module.key}`}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Its own dialog rather than the shared ConfirmDialog: whether the data
          goes too is a choice that has to be made before confirming, and the
          shared one takes a message rather than a body to put it in. */}
      <WideModal
        open={pending !== null}
        onClose={closeRemoval}
        size="sm"
        title={t('module_builder.confirm_uninstall_title', {
          name: pending?.display_name ?? '',
          defaultValue: 'Remove {{name}}?',
        })}
        busy={removal.isPending}
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={closeRemoval} disabled={removal.isPending}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              variant="danger"
              loading={removal.isPending}
              onClick={() => {
                if (pending) removal.mutate(pending);
              }}
              data-testid="module-builder-confirm-remove"
            >
              {t('module_builder.uninstall', { defaultValue: 'Remove this module' })}
            </Button>
          </div>
        }
      >
        <div className="space-y-3 text-sm text-content-secondary">
          <p>
            {t('module_builder.confirm_uninstall', {
              defaultValue:
                'The module stops serving straight away. Its records stay, and reinstalling it brings them back.',
            })}
          </p>
          <label className="flex items-start gap-2.5" data-testid="module-builder-drop-data">
            <input
              type="checkbox"
              checked={dropData}
              onChange={(e) => setDropData(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border-light text-oe-blue focus:ring-oe-blue/40"
            />
            <span>
              <span className="block text-content-primary">
                {t('module_builder.drop_data', {
                  defaultValue: 'Also delete everything recorded with it',
                })}
              </span>
              {dropData && (
                <span className="block text-xs text-semantic-error">
                  {t('module_builder.confirm_uninstall_with_data', {
                    defaultValue:
                      'The module and everything recorded with it are removed. This cannot be undone.',
                  })}
                </span>
              )}
            </span>
          </label>
        </div>
      </WideModal>

      <ModuleBuilderWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}

export default ModuleBuilderPage;
