// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Describing a module, and installing the result.
 *
 * Four steps, and the order is the argument: describe it, say what a record
 * holds, say what the module checks, then read what will be written before any
 * of it is. The assistant, when one is connected, only ever produces a
 * specification - it never writes Python - so the worst a bad draft can do is
 * describe a module that fails validation. Everything after the first step is
 * the same whether a person or an assistant filled it in.
 *
 * The review step is where the confirmation lives. Installing writes files onto
 * the server and loads them into the running process, so the step before it
 * lists every file, its length, and the URL the module will answer on. Nothing
 * about the module is a surprise by the time the button is pressed.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  FileCode,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import clsx from 'clsx';

import { Button, Input, WideModal } from '@/shared/ui';
import { getErrorMessage } from '@/shared/lib/api';
import { useToastStore } from '@/stores/useToastStore';

import {
  draftSpec,
  fetchVocabulary,
  installModule,
  previewModule,
  type InstalledModule,
  type ModuleFieldType,
  type ModuleRuleKind,
  type ModuleSpec,
  type PreviewResponse,
  type Vocabulary,
} from './api';
import {
  addField,
  addOption,
  addRule,
  defaultPlural,
  emptySpec,
  kindsForType,
  moveField,
  normaliseSpec,
  removeField,
  removeOption,
  removeRule,
  setOption,
  specProblems,
  suggestIdentifier,
  updateField,
  updateRule,
  type SpecProblem,
} from './draft';

type Step = 'describe' | 'record' | 'rules' | 'review' | 'done';

const STEP_ORDER: Step[] = ['describe', 'record', 'rules', 'review'];

export interface ModuleBuilderWizardProps {
  open: boolean;
  onClose: () => void;
  /** Called once the module is installed and serving. */
  onInstalled?: (module: InstalledModule) => void;
}

export function ModuleBuilderWizard({ open, onClose, onInstalled }: ModuleBuilderWizardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const addToast = useToastStore((s) => s.addToast);

  const [step, setStep] = useState<Step>('describe');
  const [spec, setSpec] = useState<ModuleSpec>(() => emptySpec());
  const [sentence, setSentence] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState<InstalledModule | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);

  const vocabularyQuery = useQuery({
    queryKey: ['module-builder', 'vocabulary'],
    queryFn: fetchVocabulary,
    enabled: open,
    staleTime: 30 * 60_000,
  });
  const vocabulary = vocabularyQuery.data;

  // A fresh wizard every time it opens. Reusing the last run's spec would be a
  // surprise, and reusing the last run's preview would be a lie.
  useEffect(() => {
    if (!open) return;
    setStep('describe');
    setSpec(emptySpec());
    setSentence('');
    setPreview(null);
    setInstalled(null);
    setRefusal(null);
  }, [open]);

  const problems = useMemo(() => specProblems(spec, vocabulary), [spec, vocabulary]);
  const problemsIn = (prefix: string) =>
    problems.filter((p) => p.where === prefix || p.where.startsWith(`${prefix}:`));

  const stepProblems: Record<Step, SpecProblem[]> = {
    describe: problemsIn('module'),
    record: [...problemsIn('entity'), ...problemsIn('field')],
    rules: problemsIn('rules').concat(problemsIn('rule')),
    review: problems,
    done: [],
  };

  const handleDraft = async () => {
    setDrafting(true);
    setRefusal(null);
    try {
      const result = await draftSpec(sentence);
      setSpec(result.spec);
      setStep('record');
    } catch (err) {
      // A 422 here is the assistant declining to describe the module, which is
      // a real answer and not an error to bury in a toast.
      setRefusal(getErrorMessage(err));
    } finally {
      setDrafting(false);
    }
  };

  const goToReview = async () => {
    setRefusal(null);
    try {
      const result = await previewModule(normaliseSpec(spec));
      setPreview(result);
      setStep('review');
    } catch (err) {
      setRefusal(getErrorMessage(err));
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setRefusal(null);
    try {
      const result = await installModule(normaliseSpec(spec));
      setInstalled(result);
      setStep('done');
      addToast({
        type: 'success',
        title: t('module_builder.installed_toast', {
          name: result.display_name,
          defaultValue: '{{name}} is installed and serving',
        }),
      });
      // The installed list is what every screen resolves a module's URL from.
      void qc.invalidateQueries({ queryKey: ['module-builder', 'installed'] });
      onInstalled?.(result);
    } catch (err) {
      setRefusal(getErrorMessage(err));
    } finally {
      setInstalling(false);
    }
  };

  const openInstalled = () => {
    if (!installed) return;
    onClose();
    navigate(`/modules/${installed.key}`);
  };

  const currentIndex = STEP_ORDER.indexOf(step);
  const blocked = stepProblems[step].length > 0;

  return (
    <WideModal
      open={open}
      onClose={onClose}
      size="xl"
      title={t('module_builder.title', { defaultValue: 'Module builder' })}
      subtitle={t('module_builder.subtitle', {
        defaultValue: 'Describe what you need and the platform builds it.',
      })}
      busy={drafting || installing}
      footer={
        <WizardFooter
          step={step}
          blocked={blocked}
          drafting={drafting}
          installing={installing}
          onBack={() => setStep(STEP_ORDER[Math.max(currentIndex - 1, 0)] ?? 'describe')}
          onNext={() => {
            if (step === 'describe') setStep('record');
            else if (step === 'record') setStep('rules');
            else if (step === 'rules') void goToReview();
          }}
          onInstall={() => void handleInstall()}
          onOpen={openInstalled}
          onClose={onClose}
        />
      }
    >
      <div className="space-y-5" data-testid="module-builder-wizard">
        {step !== 'done' && <StepBar current={step} />}

        {refusal && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-lg bg-semantic-error-subtle px-3 py-2 text-sm text-semantic-error"
          >
            <AlertTriangle size={15} className="mt-px shrink-0" />
            {refusal}
          </p>
        )}

        {step === 'describe' && (
          <DescribeStep
            spec={spec}
            setSpec={setSpec}
            sentence={sentence}
            setSentence={setSentence}
            drafting={drafting}
            assistantAvailable={vocabulary?.assistant_available ?? false}
            onDraft={() => void handleDraft()}
            problems={stepProblems.describe}
          />
        )}

        {step === 'record' && (
          <RecordStep spec={spec} setSpec={setSpec} vocabulary={vocabulary} problems={stepProblems.record} />
        )}

        {step === 'rules' && (
          <RulesStep spec={spec} setSpec={setSpec} vocabulary={vocabulary} problems={stepProblems.rules} />
        )}

        {step === 'review' && preview && <ReviewStep preview={preview} />}

        {step === 'done' && installed && <DoneStep installed={installed} />}
      </div>
    </WideModal>
  );
}

/* ── Step chrome ─────────────────────────────────────────────────────────── */

function StepBar({ current }: { current: Step }) {
  const { t } = useTranslation();
  const labels: Record<Step, string> = {
    describe: t('module_builder.step_describe', { defaultValue: 'Describe' }),
    record: t('module_builder.step_record', { defaultValue: 'What a record holds' }),
    rules: t('module_builder.step_rules', { defaultValue: 'What it checks' }),
    review: t('module_builder.step_review', { defaultValue: 'Review' }),
    done: '',
  };
  const index = STEP_ORDER.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      {STEP_ORDER.map((step, i) => (
        <li key={step} className="flex items-center gap-2">
          <span
            className={clsx(
              'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold',
              i < index && 'bg-oe-blue text-white',
              i === index && 'bg-oe-blue-subtle text-oe-blue-text ring-1 ring-oe-blue',
              i > index && 'bg-surface-secondary text-content-quaternary',
            )}
          >
            {i < index ? <Check size={11} strokeWidth={3} /> : i + 1}
          </span>
          <span className={clsx(i === index ? 'font-medium text-content-primary' : 'text-content-tertiary')}>
            {labels[step]}
          </span>
          {i < STEP_ORDER.length - 1 && <span className="text-content-quaternary">·</span>}
        </li>
      ))}
    </ol>
  );
}

function ProblemList({ problems }: { problems: SpecProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg bg-semantic-warning-subtle px-3 py-2 text-xs text-semantic-warning">
      {problems.map((problem, i) => (
        <li key={`${problem.where}-${i}`} className="flex items-start gap-1.5">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {problem.message}
        </li>
      ))}
    </ul>
  );
}

interface FooterProps {
  step: Step;
  blocked: boolean;
  drafting: boolean;
  installing: boolean;
  onBack: () => void;
  onNext: () => void;
  onInstall: () => void;
  onOpen: () => void;
  onClose: () => void;
}

function WizardFooter({ step, blocked, drafting, installing, onBack, onNext, onInstall, onOpen, onClose }: FooterProps) {
  const { t } = useTranslation();

  if (step === 'done') {
    return (
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          {t('common.close', { defaultValue: 'Close' })}
        </Button>
        <Button variant="primary" onClick={onOpen} data-testid="module-builder-open">
          {t('module_builder.open_module', { defaultValue: 'Open the module' })}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <Button
        variant="ghost"
        icon={<ArrowLeft size={14} />}
        onClick={step === 'describe' ? onClose : onBack}
        disabled={drafting || installing}
      >
        {step === 'describe'
          ? t('common.cancel', { defaultValue: 'Cancel' })
          : t('common.back', { defaultValue: 'Back' })}
      </Button>
      {step === 'review' ? (
        <Button
          variant="primary"
          icon={<Check size={14} />}
          loading={installing}
          disabled={blocked}
          onClick={onInstall}
          data-testid="module-builder-install"
        >
          {t('module_builder.install', { defaultValue: 'Install it' })}
        </Button>
      ) : (
        <Button
          variant="primary"
          icon={<ArrowRight size={14} />}
          iconPosition="right"
          disabled={blocked || drafting}
          onClick={onNext}
          data-testid="module-builder-next"
        >
          {t('common.next', { defaultValue: 'Next' })}
        </Button>
      )}
    </div>
  );
}

/* ── Step 1: describe ────────────────────────────────────────────────────── */

interface DescribeStepProps {
  spec: ModuleSpec;
  setSpec: (spec: ModuleSpec) => void;
  sentence: string;
  setSentence: (text: string) => void;
  drafting: boolean;
  assistantAvailable: boolean;
  onDraft: () => void;
  problems: SpecProblem[];
}

function DescribeStep({
  spec,
  setSpec,
  sentence,
  setSentence,
  drafting,
  assistantAvailable,
  onDraft,
  problems,
}: DescribeStepProps) {
  const { t } = useTranslation();

  /** Naming the module names its key and its record, until the user says otherwise. */
  const setDisplayName = (value: string) => {
    const suggested = suggestIdentifier(value);
    const keyWasSuggested = spec.key === '' || spec.key === suggestIdentifier(spec.display_name);
    setSpec({
      ...spec,
      display_name: value,
      key: keyWasSuggested ? suggested : spec.key,
    });
  };

  return (
    <div className="space-y-4">
      {assistantAvailable ? (
        <div className="rounded-xl border border-border-light bg-surface-secondary/50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-content-primary">
            <Sparkles size={14} className="text-oe-blue-text" />
            {t('module_builder.describe_heading', { defaultValue: 'Say what you need' })}
          </p>
          <textarea
            value={sentence}
            rows={3}
            onChange={(e) => setSentence(e.target.value)}
            placeholder={t('module_builder.describe_placeholder', {
              defaultValue:
                'A register of concrete pours: pour reference, date, volume in cubic metres, the mix, and who signed it off.',
            })}
            className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue/40"
            data-testid="module-builder-description"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-content-tertiary">
              {t('module_builder.describe_note', {
                defaultValue:
                  'The assistant writes a description of the module, never its code. You read it on the next step and can change every part of it.',
              })}
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={<Wand2 size={13} />}
              loading={drafting}
              disabled={sentence.trim().length < 10}
              onClick={onDraft}
              data-testid="module-builder-draft"
            >
              {t('module_builder.draft', { defaultValue: 'Draft it' })}
            </Button>
          </div>
        </div>
      ) : (
        <p className="rounded-lg bg-surface-secondary/60 px-3 py-2 text-xs text-content-tertiary">
          {t('module_builder.no_assistant', {
            defaultValue:
              'No AI provider is connected, so the module is described by hand. Everything below works the same way either way.',
          })}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={t('module_builder.field_display_name', { defaultValue: 'Module name' })}
          value={spec.display_name}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Concrete Pour Register"
          data-testid="module-builder-name"
        />
        <Input
          label={t('module_builder.field_key', { defaultValue: 'Key' })}
          hint={t('module_builder.field_key_hint', {
            defaultValue: 'Used for the folder, the table and the URL. Lower case, underscores.',
          })}
          value={spec.key}
          onChange={(e) => setSpec({ ...spec, key: e.target.value })}
          placeholder="concrete_pours"
          data-testid="module-builder-key"
        />
      </div>

      <div>
        <label
          htmlFor="module-builder-purpose"
          className="mb-1 block text-sm font-medium text-content-secondary"
        >
          {t('common.description', { defaultValue: 'Description' })}
        </label>
        <textarea
          id="module-builder-purpose"
          value={spec.description}
          rows={2}
          onChange={(e) => setSpec({ ...spec, description: e.target.value })}
          className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue/40"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label={t('module_builder.field_version', { defaultValue: 'Version' })}
          value={spec.version}
          onChange={(e) => setSpec({ ...spec, version: e.target.value })}
        />
        <Input
          label={t('module_builder.field_author', { defaultValue: 'Author' })}
          value={spec.author}
          onChange={(e) => setSpec({ ...spec, author: e.target.value })}
        />
      </div>

      <ProblemList problems={problems} />
    </div>
  );
}

/* ── Step 2: the record and its fields ───────────────────────────────────── */

interface EditStepProps {
  spec: ModuleSpec;
  setSpec: (spec: ModuleSpec) => void;
  vocabulary: Vocabulary | undefined;
  problems: SpecProblem[];
}

function RecordStep({ spec, setSpec, vocabulary, problems }: EditStepProps) {
  const { t } = useTranslation();
  const types = vocabulary?.field_types ?? [];
  const atLimit = vocabulary !== undefined && spec.entity.fields.length >= vocabulary.max_fields;

  const setEntityDisplayName = (value: string) => {
    const nameWasSuggested =
      spec.entity.name === '' || spec.entity.name === suggestIdentifier(spec.entity.display_name);
    const pluralWasSuggested =
      spec.entity.plural_name === '' || spec.entity.plural_name === defaultPlural(spec.entity.display_name);
    setSpec({
      ...spec,
      entity: {
        ...spec.entity,
        display_name: value,
        name: nameWasSuggested ? suggestIdentifier(value) : spec.entity.name,
        plural_name: pluralWasSuggested ? defaultPlural(value) : spec.entity.plural_name,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label={t('module_builder.field_record_name', { defaultValue: 'One record is called' })}
          value={spec.entity.display_name}
          onChange={(e) => setEntityDisplayName(e.target.value)}
          placeholder="Pour"
          data-testid="module-builder-entity-name"
        />
        <Input
          label={t('module_builder.field_record_plural', { defaultValue: 'Several are called' })}
          value={spec.entity.plural_name}
          onChange={(e) => setSpec({ ...spec, entity: { ...spec.entity, plural_name: e.target.value } })}
          placeholder="Pours"
        />
        <Input
          label={t('module_builder.field_record_key', { defaultValue: 'Table name' })}
          value={spec.entity.name}
          onChange={(e) => setSpec({ ...spec, entity: { ...spec.entity, name: e.target.value } })}
          placeholder="pour"
        />
      </div>

      <label className="flex items-start gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={spec.entity.project_scoped}
          onChange={(e) => setSpec({ ...spec, entity: { ...spec.entity, project_scoped: e.target.checked } })}
          className="mt-0.5 h-4 w-4 rounded border-border-light text-oe-blue focus:ring-oe-blue/40"
        />
        <span>
          <span className="block text-content-primary">
            {t('module_builder.project_scoped', { defaultValue: 'These records belong to a project' })}
          </span>
          <span className="block text-xs text-content-tertiary">
            {t('module_builder.project_scoped_hint', {
              defaultValue: 'Almost everything on a construction project does. Leave it on unless it does not.',
            })}
          </span>
        </span>
      </label>

      <div className="space-y-3">
        {spec.entity.fields.map((field, index) => (
          <div key={index} className="rounded-xl border border-border-light p-3">
            <div className="grid gap-2 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <Input
                  label={t('module_builder.field_label', { defaultValue: 'Label' })}
                  value={field.label}
                  onChange={(e) => {
                    const nameWasSuggested = field.name === '' || field.name === suggestIdentifier(field.label);
                    setSpec(
                      updateField(spec, index, {
                        label: e.target.value,
                        ...(nameWasSuggested ? { name: suggestIdentifier(e.target.value) } : {}),
                      }),
                    );
                  }}
                  data-testid={`module-builder-field-label-${index}`}
                />
              </div>
              <div className="sm:col-span-3">
                <Input
                  label={t('module_builder.field_name', { defaultValue: 'Column' })}
                  value={field.name}
                  onChange={(e) => setSpec(updateField(spec, index, { name: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-3">
                <label className="mb-1 block text-sm font-medium text-content-secondary">
                  {t('common.type', { defaultValue: 'Type' })}
                </label>
                <select
                  value={field.type}
                  onChange={(e) =>
                    setSpec(updateField(spec, index, { type: e.target.value as ModuleFieldType }))
                  }
                  className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-oe-blue/40"
                  data-testid={`module-builder-field-type-${index}`}
                >
                  {types.map((type) => (
                    <option key={type.type} value={type.type}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <Input
                  label={t('common.unit', { defaultValue: 'Unit' })}
                  value={field.unit}
                  onChange={(e) => setSpec(updateField(spec, index, { unit: e.target.value }))}
                  placeholder="m3"
                />
              </div>
            </div>

            {field.type === 'select' && (
              <div className="mt-2 space-y-1.5">
                <p className="text-xs font-medium text-content-secondary">
                  {t('module_builder.field_options', { defaultValue: 'The choices' })}
                </p>
                {field.options.map((option, optionIndex) => (
                  <div key={optionIndex} className="flex items-center gap-2">
                    <input
                      value={option}
                      onChange={(e) => setSpec(setOption(spec, index, optionIndex, e.target.value))}
                      className="flex-1 rounded-lg border border-border-light bg-surface-primary px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setSpec(removeOption(spec, index, optionIndex))}
                      aria-label={t('common.remove', { defaultValue: 'Remove' })}
                      className="rounded-md p-1 text-content-tertiary hover:text-semantic-error"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setSpec(addOption(spec, index))}
                  className="text-xs font-medium text-oe-blue-text hover:text-oe-blue-hover"
                >
                  {t('module_builder.add_option', { defaultValue: 'Add a choice' })}
                </button>
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => setSpec(updateField(spec, index, { required: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded border-border-light text-oe-blue"
                  />
                  {t('module_builder.field_required', { defaultValue: 'Must be filled in' })}
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={field.in_list}
                    onChange={(e) => setSpec(updateField(spec, index, { in_list: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded border-border-light text-oe-blue"
                  />
                  {t('module_builder.field_in_list', { defaultValue: 'Show in the table' })}
                </label>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSpec(moveField(spec, index, -1))}
                  aria-label={t('common.move_up', { defaultValue: 'Move up' })}
                  disabled={index === 0}
                  className="rounded-md p-1 text-content-tertiary hover:text-content-primary disabled:opacity-30"
                >
                  <ArrowUp size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setSpec(moveField(spec, index, 1))}
                  aria-label={t('common.move_down', { defaultValue: 'Move down' })}
                  disabled={index === spec.entity.fields.length - 1}
                  className="rounded-md p-1 text-content-tertiary hover:text-content-primary disabled:opacity-30"
                >
                  <ArrowDown size={13} />
                </button>
                <button
                  type="button"
                  onClick={() => setSpec(removeField(spec, index))}
                  aria-label={t('module_builder.remove_field', { defaultValue: 'Remove this field' })}
                  disabled={spec.entity.fields.length === 1}
                  className="rounded-md p-1 text-content-tertiary hover:text-semantic-error disabled:opacity-30"
                  data-testid={`module-builder-remove-field-${index}`}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button
        variant="secondary"
        size="sm"
        icon={<Plus size={13} />}
        disabled={atLimit}
        onClick={() => setSpec(addField(spec))}
        data-testid="module-builder-add-field"
      >
        {t('module_builder.add_field', { defaultValue: 'Add a field' })}
      </Button>

      <ProblemList problems={problems} />
    </div>
  );
}

/* ── Step 3: the rules ───────────────────────────────────────────────────── */

function RulesStep({ spec, setSpec, vocabulary, problems }: EditStepProps) {
  const { t } = useTranslation();
  const [pendingField, setPendingField] = useState('');
  const named = spec.entity.fields.filter((f) => f.name.trim() !== '');
  const chosen = named.find((f) => f.name === pendingField) ?? named[0];
  const available = chosen ? kindsForType(vocabulary, chosen.type) : [];
  const dateFields = spec.entity.fields.filter((f) => f.type === 'date' || f.type === 'datetime');

  return (
    <div className="space-y-4">
      <p className="text-xs text-content-tertiary">
        {t('module_builder.rules_intro', {
          defaultValue:
            'Every module here ships rules; a module with none is refused. They run on every write and their findings travel with the answer.',
        })}
      </p>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border-light p-3">
        <div className="min-w-[10rem] flex-1">
          <label className="mb-1 block text-xs font-medium text-content-secondary">
            {t('module_builder.rule_on_field', { defaultValue: 'About which field' })}
          </label>
          <select
            value={chosen?.name ?? ''}
            onChange={(e) => setPendingField(e.target.value)}
            className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm"
            data-testid="module-builder-rule-field"
          >
            {named.map((field) => (
              <option key={field.name} value={field.name}>
                {field.label || field.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {available.map((kind) => (
            <Button
              key={kind.kind}
              variant="secondary"
              size="sm"
              icon={<Plus size={12} />}
              title={kind.hint}
              onClick={() => setSpec(addRule(spec, kind.kind as ModuleRuleKind, chosen?.name ?? ''))}
              data-testid={`module-builder-add-rule-${kind.kind}`}
            >
              {kind.label}
            </Button>
          ))}
          {named.length === 0 && (
            <p className="text-xs text-content-tertiary">
              {t('module_builder.rules_need_fields', {
                defaultValue: 'Name a field on the previous step first.',
              })}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        {spec.rules.map((rule, index) => (
          <div key={index} className="rounded-xl border border-border-light p-3">
            <div className="grid gap-2 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <Input
                  label={t('module_builder.rule_code', { defaultValue: 'Code' })}
                  value={rule.code}
                  onChange={(e) => setSpec(updateRule(spec, index, { code: e.target.value.toUpperCase() }))}
                />
              </div>
              <div className="sm:col-span-8">
                <Input
                  label={t('module_builder.rule_message', { defaultValue: 'What the user is told' })}
                  value={rule.message}
                  onChange={(e) => setSpec(updateRule(spec, index, { message: e.target.value }))}
                  placeholder="A pour cannot be recorded before it happened."
                  data-testid={`module-builder-rule-message-${index}`}
                />
              </div>
            </div>

            {rule.kind === 'range' && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Input
                  label={t('module_builder.rule_min', { defaultValue: 'Not below' })}
                  value={rule.min_value === null ? '' : String(rule.min_value)}
                  inputMode="decimal"
                  onChange={(e) =>
                    setSpec(
                      updateRule(spec, index, {
                        min_value: e.target.value.trim() === '' ? null : Number(e.target.value),
                      }),
                    )
                  }
                />
                <Input
                  label={t('module_builder.rule_max', { defaultValue: 'Not above' })}
                  value={rule.max_value === null ? '' : String(rule.max_value)}
                  inputMode="decimal"
                  onChange={(e) =>
                    setSpec(
                      updateRule(spec, index, {
                        max_value: e.target.value.trim() === '' ? null : Number(e.target.value),
                      }),
                    )
                  }
                />
              </div>
            )}

            {rule.kind === 'order' && (
              <div className="mt-2">
                <label className="mb-1 block text-xs font-medium text-content-secondary">
                  {t('module_builder.rule_other_field', { defaultValue: 'Must not come after' })}
                </label>
                <select
                  value={rule.other_field}
                  onChange={(e) => setSpec(updateRule(spec, index, { other_field: e.target.value }))}
                  className="w-full rounded-lg border border-border-light bg-surface-primary px-3 py-2 text-sm"
                >
                  <option value="">{t('common.select', { defaultValue: 'Select…' })}</option>
                  {dateFields
                    .filter((f) => f.name !== rule.field)
                    .map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.label || f.name}
                      </option>
                    ))}
                </select>
              </div>
            )}

            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-content-tertiary">
              <span>
                {rule.kind} · {rule.field}
              </span>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={rule.severity === 'warning'}
                    onChange={(e) =>
                      setSpec(updateRule(spec, index, { severity: e.target.checked ? 'warning' : 'error' }))
                    }
                    className="h-3.5 w-3.5 rounded border-border-light text-oe-blue"
                  />
                  {t('module_builder.rule_warning_only', { defaultValue: 'Warn, do not refuse' })}
                </label>
                <button
                  type="button"
                  onClick={() => setSpec(removeRule(spec, index))}
                  aria-label={t('module_builder.remove_rule', { defaultValue: 'Remove this rule' })}
                  className="rounded-md p-1 hover:text-semantic-error"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <ProblemList problems={problems} />
    </div>
  );
}

/* ── Step 4: review ──────────────────────────────────────────────────────── */

function ReviewStep({ preview }: { preview: PreviewResponse }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="module-builder-review">
      <div className="rounded-xl border border-border-light bg-surface-secondary/40 p-3 text-sm">
        <p className="text-content-primary">
          {t('module_builder.review_summary', {
            files: preview.files.length,
            lines: preview.total_lines,
            defaultValue: '{{files}} files, {{lines}} lines. Nothing has been written yet.',
          })}
        </p>
        <p className="mt-1 text-xs text-content-tertiary">
          {t('module_builder.review_url', {
            path: preview.base_path,
            defaultValue: 'It will answer on {{path}} as soon as it is installed.',
          })}
        </p>
      </div>

      <ul className="divide-y divide-border-light rounded-xl border border-border-light">
        {preview.files.map((file) => (
          <li key={file.path} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
            <span className="flex min-w-0 items-center gap-2 text-content-secondary">
              <FileCode size={13} className="shrink-0 text-content-quaternary" />
              <span className="truncate font-mono">{file.path}</span>
            </span>
            <span className="shrink-0 text-content-tertiary">
              {/* Deliberately not a counted key: `count` would make i18next
                  demand a plural form per language for a string whose natural
                  rendering in several of them is "lines: 96". */}
              {t('module_builder.review_lines', { lines: file.lines, defaultValue: '{{lines}} lines' })}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-xs text-content-tertiary">
        {t('module_builder.review_note', {
          defaultValue:
            'Installing writes these files into this instance and loads them straight away. A platform upgrade will not overwrite them, and removing the module later leaves its records alone unless you ask for them to go too.',
        })}
      </p>
    </div>
  );
}

/* ── Step 5: done ────────────────────────────────────────────────────────── */

function DoneStep({ installed }: { installed: InstalledModule }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 py-2 text-center" data-testid="module-builder-done">
      <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-semantic-success-subtle text-semantic-success">
        <Check size={20} strokeWidth={2.5} />
      </span>
      <p className="text-sm font-medium text-content-primary">{installed.display_name}</p>
      <p className="text-xs text-content-tertiary">
        {t('module_builder.done_note', {
          path: installed.base_path,
          defaultValue: 'Installed and serving on {{path}}. No restart is needed.',
        })}
      </p>
      <p className="text-xs text-content-tertiary">
        {t('module_builder.done_counts', {
          fields: installed.field_count,
          rules: installed.rule_count,
          defaultValue: '{{fields}} fields, {{rules}} rules.',
        })}
      </p>
    </div>
  );
}

export default ModuleBuilderWizard;
