// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Cases - the authoring screen.
//
// Writing a case used to mean adding a `.playbook.ts` file and rebuilding the
// frontend, which makes it a build step rather than a feature. This is the
// screen that makes it a feature.
//
// Two decisions drive the layout.
//
// Starting from one of the 144 shipped cases is offered first, and prominently.
// A blank form is the hardest way to write a walkthrough, and the product
// already ships 144 worked examples of the format; "this, but how we actually
// do it" is the normal case and should be one click.
//
// The step target is picked from a list, not typed. A case whose steps go
// nowhere is worse than no case, and the catalogue in ./stepTargets is built
// from screens the shipped cases already walk, so everything on it works. Free
// text stays possible for screens no shipped case visits, and the same guard
// the backend applies runs here so the editor can say no before a round trip.
//
// All display text is a translation key with an English default; nothing in
// this file is a hardcoded user-facing string.

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Copy,
  FilePlus2,
  Info,
  Loader2,
  Plus,
  Save,
  Search,
  Share2,
  Trash2,
} from 'lucide-react';
import clsx from 'clsx';
import { Badge, Button, Card, Input } from '@/shared/ui';
import { useToastStore } from '@/stores/useToastStore';
import type { CaseBody, CaseFinding, CaseStepWire } from './api';
import { caseIdFromPlaybookId } from './api';
import { useAuthoredCase, useCaseMutations } from './useCustomCases';
import { PLAYBOOKS } from './playbooks';
import { CATEGORY_META } from './categories';
import { COMPANY_TYPE_META } from './companyTypes';
import { STEP_TARGETS, findTarget, isValidTarget } from './stepTargets';
import type { CaseCategory, CompanyType } from './types';
import type { CaseDraft, DraftStep } from './caseDraft';
import {
  blockersForSharing,
  canSave,
  draftFromPlaybook,
  emptyDraft,
  emptyStep,
  formatList,
  moveStep,
  parseList,
  removeStep as removeDraftStep,
  updateStep,
} from './caseDraft';

const FIELD_LABEL = 'block text-sm font-medium text-content-primary mb-1.5';
const SECTION = 'rounded-lg border border-border-light bg-surface-primary p-5';

function toWireStep(step: DraftStep): CaseStepWire {
  return {
    id: step.id,
    title: step.title.trim(),
    what: step.what.trim(),
    why: step.why.trim(),
    module_label: step.moduleLabel.trim(),
    to: step.to.trim(),
    icon: '',
    inputs: step.inputs,
    outputs: step.outputs,
    inputs_hint: '',
    outputs_hint: '',
  };
}

function toBody(draft: CaseDraft): CaseBody {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    long_description: draft.longDescription.trim(),
    category: draft.category,
    company_types: draft.companyTypes,
    roles: draft.roles,
    est_minutes: draft.estMinutes,
    steps: draft.steps.map(toWireStep),
    source_playbook_id: draft.sourcePlaybookId,
    is_shared: draft.isShared,
  };
}

export function CaseEditorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { playbookId } = useParams<{ playbookId?: string }>();
  const addToast = useToastStore((s) => s.addToast);

  const caseId = playbookId ? caseIdFromPlaybookId(playbookId) : null;
  const existing = useAuthoredCase(caseId);
  const { create, update, remove } = useCaseMutations();

  const [draft, setDraft] = useState<CaseDraft>(emptyDraft());
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [findings, setFindings] = useState<CaseFinding[]>([]);
  const [startSearch, setStartSearch] = useState('');
  const [showStart, setShowStart] = useState(!caseId);

  // Resolve a shipped playbook's key to the reader's own language. A copy has
  // to be text the author can edit, and a translation key is not that.
  const resolve = useCallback(
    (key: string | undefined, fallback: string) =>
      key ? t(key, { defaultValue: fallback }) : fallback,
    [t],
  );

  // Load the stored case into the draft exactly once per id. Doing this in
  // render rather than an effect keeps the first paint correct; the id guard
  // is what stops it clobbering edits on every re-render.
  if (caseId && existing.data && loadedId !== caseId) {
    const row = existing.data;
    setLoadedId(caseId);
    setDraft({
      title: row.title,
      description: row.description,
      longDescription: row.long_description,
      category: row.category as CaseCategory,
      companyTypes: row.company_types as CompanyType[],
      roles: row.roles as CaseDraft['roles'],
      estMinutes: row.est_minutes,
      sourcePlaybookId: row.source_playbook_id,
      isShared: row.is_shared,
      steps: (row.steps ?? []).map((step) => ({
        id: step.id,
        title: step.title,
        what: step.what,
        why: step.why,
        moduleLabel: step.module_label,
        to: step.to,
        inputs: step.inputs ?? [],
        outputs: step.outputs ?? [],
      })),
    });
  }

  const blockers = useMemo(() => blockersForSharing(draft), [draft]);
  // The first blocker is what the footer shows. Held as its own binding so the
  // strict index check is done once rather than at each of the two call sites.
  const firstBlocker: string | undefined = blockers[0];
  const saving = create.isPending || update.isPending;

  const startPoints = useMemo(() => {
    const needle = startSearch.trim().toLowerCase();
    const all = PLAYBOOKS.map((pb) => ({
      playbook: pb,
      label: resolve(pb.titleKey, pb.titleDefault),
      summary: resolve(pb.descKey, pb.descDefault),
    }));
    if (!needle) return all.slice(0, 12);
    return all
      .filter(
        (entry) =>
          entry.label.toLowerCase().includes(needle) ||
          entry.summary.toLowerCase().includes(needle),
      )
      .slice(0, 24);
  }, [startSearch, resolve]);

  const patch = useCallback((next: Partial<CaseDraft>) => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  const patchStep = useCallback((index: number, next: Partial<DraftStep>) => {
    setDraft((current) => ({ ...current, steps: updateStep(current.steps, index, next) }));
  }, []);

  const save = useCallback(
    async (share: boolean) => {
      const body = toBody({ ...draft, isShared: share });
      try {
        const result = caseId
          ? await update.mutateAsync({ caseId, body })
          : await create.mutateAsync(body);
        setFindings(result.findings);
        patch({ isShared: share });
        addToast({
          type: 'success',
          title: t('cases.editor.saved', { defaultValue: 'Case saved' }),
        });
        if (!caseId) {
          navigate(`/cases/custom-${result.case.id}/edit`, { replace: true });
        }
      } catch (error) {
        addToast({
          type: 'error',
          title: t('cases.editor.save_failed', { defaultValue: 'Could not save the case' }),
          ...(error instanceof Error ? { message: error.message } : {}),
        });
      }
    },
    [draft, caseId, update, create, patch, addToast, t, navigate],
  );

  const destroy = useCallback(async () => {
    if (!caseId) return;
    try {
      await remove.mutateAsync(caseId);
      addToast({
        type: 'success',
        title: t('cases.editor.deleted', { defaultValue: 'Case deleted' }),
      });
      navigate('/cases');
    } catch (error) {
      addToast({
        type: 'error',
        title: t('cases.editor.delete_failed', { defaultValue: 'Could not delete the case' }),
        ...(error instanceof Error ? { message: error.message } : {}),
      });
    }
  }, [caseId, remove, addToast, t, navigate]);

  if (caseId && existing.isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-content-tertiary">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 pb-28">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/cases')}>
          <ArrowLeft className="h-4 w-4" />
          {t('cases.back_to_list', { defaultValue: 'All cases' })}
        </Button>
        <h1 className="text-xl font-semibold text-content-primary">
          {caseId
            ? t('cases.editor.title_edit', { defaultValue: 'Edit case' })
            : t('cases.editor.title_new', { defaultValue: 'Write a case' })}
        </h1>
        {draft.isShared && (
          <Badge variant="success">
            {t('cases.editor.badge_shared', { defaultValue: 'Shared with the team' })}
          </Badge>
        )}
      </div>

      <p className="text-sm text-content-secondary">
        {t('cases.editor.intro', {
          defaultValue:
            'A case is a short walkthrough: why you would do this, and the screens you pass through to do it. Write down how your team actually works, so a new starter can follow it.',
        })}
      </p>

      {/* Start from a shipped case. Offered first because a blank form is the
          hardest way to write a walkthrough and 144 worked examples exist. */}
      {showStart && (
        <Card className={SECTION}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Copy className="h-4 w-4 text-content-tertiary" />
              <h2 className="text-sm font-semibold text-content-primary">
                {t('cases.editor.start_from', { defaultValue: 'Start from one of ours' })}
              </h2>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowStart(false)}>
              <FilePlus2 className="h-4 w-4" />
              {t('cases.editor.start_blank', { defaultValue: 'Start from blank' })}
            </Button>
          </div>
          <p className="mb-3 text-sm text-content-secondary">
            {t('cases.editor.start_from_hint', {
              defaultValue:
                'Pick the case closest to what you do, then change the steps and the wording to match your process. Nothing you change affects the original.',
            })}
          </p>
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-tertiary" />
            <Input
              className="pl-9"
              value={startSearch}
              onChange={(e) => setStartSearch(e.target.value)}
              placeholder={t('cases.editor.start_search', {
                defaultValue: 'Search all shipped cases',
              })}
            />
          </div>
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {startPoints.map((entry) => (
              <button
                key={entry.playbook.id}
                type="button"
                className="w-full rounded-md border border-border-light p-3 text-left hover:border-accent-primary hover:bg-surface-secondary"
                onClick={() => {
                  setDraft(draftFromPlaybook(entry.playbook, resolve));
                  setShowStart(false);
                }}
              >
                <div className="text-sm font-medium text-content-primary">{entry.label}</div>
                <div className="line-clamp-2 text-xs text-content-tertiary">{entry.summary}</div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* What the case is */}
      <Card className={SECTION}>
        <h2 className="mb-4 text-sm font-semibold text-content-primary">
          {t('cases.editor.section_about', { defaultValue: 'What this case is' })}
        </h2>
        <div className="space-y-4">
          <div>
            <label className={FIELD_LABEL} htmlFor="case-title">
              {t('cases.editor.field_title', { defaultValue: 'Title' })}
            </label>
            <Input
              id="case-title"
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder={t('cases.editor.field_title_ph', {
                defaultValue: 'How we price a variation',
              })}
            />
          </div>
          <div>
            <label className={FIELD_LABEL} htmlFor="case-desc">
              {t('cases.editor.field_summary', { defaultValue: 'One-line summary' })}
            </label>
            <Input
              id="case-desc"
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder={t('cases.editor.field_summary_ph', {
                defaultValue: 'What the reader will have done by the end',
              })}
            />
          </div>
          <div>
            <label className={FIELD_LABEL} htmlFor="case-long">
              {t('cases.editor.field_detail', { defaultValue: 'Why it matters (optional)' })}
            </label>
            <textarea
              id="case-long"
              rows={3}
              className="w-full rounded-md border border-border-light bg-surface-primary p-2.5 text-sm text-content-primary"
              value={draft.longDescription}
              onChange={(e) => patch({ longDescription: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={FIELD_LABEL} htmlFor="case-category">
                {t('cases.editor.field_discipline', { defaultValue: 'Discipline' })}
              </label>
              <select
                id="case-category"
                className="w-full rounded-md border border-border-light bg-surface-primary p-2.5 text-sm text-content-primary"
                value={draft.category}
                onChange={(e) => patch({ category: e.target.value as CaseCategory })}
              >
                {CATEGORY_META.map((meta) => (
                  <option key={meta.id} value={meta.id}>
                    {t(meta.labelKey, { defaultValue: meta.labelDefault })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={FIELD_LABEL} htmlFor="case-minutes">
                {t('cases.editor.field_minutes', { defaultValue: 'Minutes to follow' })}
              </label>
              <Input
                id="case-minutes"
                type="number"
                min={1}
                max={600}
                value={String(draft.estMinutes)}
                onChange={(e) => patch({ estMinutes: Number(e.target.value) || 1 })}
              />
            </div>
          </div>
          <div>
            <span className={FIELD_LABEL}>
              {t('cases.editor.field_audience', { defaultValue: 'Who it is for' })}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {COMPANY_TYPE_META.map((meta) => {
                const on = draft.companyTypes.includes(meta.id);
                return (
                  <button
                    key={meta.id}
                    type="button"
                    aria-pressed={on}
                    className={clsx(
                      'rounded-full border px-3 py-1 text-xs',
                      on
                        ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                        : 'border-border-light text-content-secondary hover:bg-surface-secondary',
                    )}
                    onClick={() =>
                      patch({
                        companyTypes: on
                          ? draft.companyTypes.filter((id) => id !== meta.id)
                          : [...draft.companyTypes, meta.id],
                      })
                    }
                  >
                    {t(meta.labelKey, { defaultValue: meta.labelDefault })}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* Steps */}
      <Card className={SECTION}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-content-primary">
            {t('cases.editor.section_steps', { defaultValue: 'Steps' })}
            <span className="ml-2 font-normal text-content-tertiary">{draft.steps.length}</span>
          </h2>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => patch({ steps: [...draft.steps, emptyStep(draft.steps)] })}
          >
            <Plus className="h-4 w-4" />
            {t('cases.editor.add_step', { defaultValue: 'Add a step' })}
          </Button>
        </div>

        {draft.steps.length === 0 ? (
          <p className="rounded-md border border-dashed border-border-light p-6 text-center text-sm text-content-tertiary">
            {t('cases.editor.no_steps', {
              defaultValue:
                'No steps yet. A step names one screen to open and says what to do there and why.',
            })}
          </p>
        ) : (
          <div className="space-y-3">
            {draft.steps.map((step, index) => {
              const target = findTarget(step.to);
              const targetBad = Boolean(step.to.trim()) && !isValidTarget(step.to.trim());
              return (
                <div key={step.id} className="rounded-md border border-border-light p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-secondary text-xs font-medium text-content-secondary">
                      {index + 1}
                    </span>
                    <Input
                      className="flex-1"
                      value={step.title}
                      onChange={(e) => patchStep(index, { title: e.target.value })}
                      placeholder={t('cases.editor.step_title_ph', {
                        defaultValue: 'What happens in this step',
                      })}
                    />
                    <button
                      type="button"
                      aria-label={t('cases.editor.step_up', { defaultValue: 'Move step up' })}
                      className="flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:bg-surface-secondary disabled:pointer-events-none disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => patch({ steps: moveStep(draft.steps, index, -1) })}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('cases.editor.step_down', { defaultValue: 'Move step down' })}
                      className="flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:bg-surface-secondary disabled:pointer-events-none disabled:opacity-30"
                      disabled={index === draft.steps.length - 1}
                      onClick={() => patch({ steps: moveStep(draft.steps, index, 1) })}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('cases.editor.step_remove', { defaultValue: 'Remove step' })}
                      className="flex h-7 w-7 items-center justify-center rounded text-content-tertiary hover:bg-surface-secondary hover:text-status-error"
                      onClick={() => patch({ steps: removeDraftStep(draft.steps, index) })}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs text-content-tertiary">
                        {t('cases.editor.step_screen', { defaultValue: 'Screen it opens' })}
                      </label>
                      <Input
                        list="case-step-targets"
                        value={step.to}
                        onChange={(e) => {
                          const to = e.target.value;
                          const match = findTarget(to);
                          patchStep(index, {
                            to,
                            // Fill the module label from the catalogue, but only
                            // when the author has not written their own.
                            moduleLabel:
                              match && !step.moduleLabel ? match.label : step.moduleLabel,
                          });
                        }}
                        placeholder="/boq"
                      />
                      {targetBad ? (
                        <p className="mt-1 flex items-center gap-1 text-xs text-status-error">
                          <AlertTriangle className="h-3 w-3" />
                          {t('cases.editor.step_screen_invalid', {
                            defaultValue:
                              'This has to be a screen inside the app, such as /boq. Links to other sites are not accepted.',
                          })}
                        </p>
                      ) : target ? (
                        <p className="mt-1 text-xs text-content-tertiary">{target.label}</p>
                      ) : null}
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-content-tertiary">
                        {t('cases.editor.step_module', { defaultValue: 'Label for that screen' })}
                      </label>
                      <Input
                        value={step.moduleLabel}
                        onChange={(e) => patchStep(index, { moduleLabel: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs text-content-tertiary">
                        {t('cases.editor.step_what', { defaultValue: 'What you do here' })}
                      </label>
                      <textarea
                        rows={2}
                        className="w-full rounded-md border border-border-light bg-surface-primary p-2 text-sm text-content-primary"
                        value={step.what}
                        onChange={(e) => patchStep(index, { what: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-content-tertiary">
                        {t('cases.editor.step_why', { defaultValue: 'Why it matters' })}
                      </label>
                      <textarea
                        rows={2}
                        className="w-full rounded-md border border-border-light bg-surface-primary p-2 text-sm text-content-primary"
                        value={step.why}
                        onChange={(e) => patchStep(index, { why: e.target.value })}
                        placeholder={t('cases.editor.step_why_ph', {
                          defaultValue: 'The part a new starter needs',
                        })}
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs text-content-tertiary">
                        {t('cases.flow.in', { defaultValue: 'Goes in' })}
                      </label>
                      <Input
                        value={formatList(step.inputs)}
                        onChange={(e) => patchStep(index, { inputs: parseList(e.target.value) })}
                        placeholder={t('cases.editor.list_ph', {
                          defaultValue: 'Separate with commas',
                        })}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-content-tertiary">
                        {t('cases.flow.out', { defaultValue: 'Comes out' })}
                      </label>
                      <Input
                        value={formatList(step.outputs)}
                        onChange={(e) => patchStep(index, { outputs: parseList(e.target.value) })}
                        placeholder={t('cases.editor.list_ph', {
                          defaultValue: 'Separate with commas',
                        })}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* One datalist for every step input. The catalogue is built from the
            screens the shipped cases already walk, so everything on it works. */}
        <datalist id="case-step-targets">
          {STEP_TARGETS.map((entry) => (
            <option key={entry.to} value={entry.to}>
              {entry.label}
            </option>
          ))}
        </datalist>
      </Card>

      {/* What validation made of it */}
      {findings.length > 0 && (
        <Card className={SECTION}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-content-primary">
            <Info className="h-4 w-4 text-content-tertiary" />
            {t('cases.editor.section_review', { defaultValue: 'Worth a look' })}
          </h2>
          <ul className="space-y-2">
            {findings.map((finding) => (
              <li key={finding.rule_id} className="flex items-start gap-2 text-sm">
                <Badge variant={finding.severity === 'error' ? 'error' : 'warning'}>
                  {finding.severity}
                </Badge>
                <div>
                  <p className="text-content-primary">
                    {t(finding.key, { defaultValue: finding.message })}
                  </p>
                  {finding.suggestion && (
                    <p className="text-xs text-content-tertiary">{finding.suggestion}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Actions */}
      <div className="sticky bottom-0 -mx-4 border-t border-border-light bg-surface-primary/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save(draft.isShared)} disabled={!canSave(draft) || saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {t('cases.editor.save', { defaultValue: 'Save' })}
          </Button>
          <Button
            variant="secondary"
            onClick={() => void save(true)}
            disabled={!canSave(draft) || saving || blockers.length > 0}
            title={
              blockers.length
                ? blockers.map((key) => t(key, { defaultValue: key })).join(' ')
                : undefined
            }
          >
            <Share2 className="h-4 w-4" />
            {t('cases.editor.share', { defaultValue: 'Share with the team' })}
          </Button>
          {caseId && (
            <Button variant="ghost" onClick={() => void destroy()} disabled={remove.isPending}>
              <Trash2 className="h-4 w-4" />
              {t('cases.editor.delete', { defaultValue: 'Delete' })}
            </Button>
          )}
          <div className="ml-auto text-xs text-content-tertiary">
            {firstBlocker ? (
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {t(firstBlocker, { defaultValue: firstBlocker })}
              </span>
            ) : (
              t('cases.editor.share_hint', {
                defaultValue: 'A shared case is readable by everyone and editable only by you.',
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default CaseEditorPage;
