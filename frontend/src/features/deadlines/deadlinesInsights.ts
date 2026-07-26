// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Deadline register's contribution to the Module Insights panel.
 *
 * The table groups late work by the module it came from, which answers "what
 * is late" but not "who is it landing on" or "how late is late". Those are the
 * two questions that decide whether a weekly meeting is a status update or an
 * escalation, so this panel puts overdue work against its owner and against
 * the number of days it has slipped.
 *
 * Rows are the deadline items the page already loaded. Note that the register
 * only ever holds work with a date attached - correspondence response
 * deadlines, NCR corrective actions and punch items - so a small register is
 * usually a sign that dates are missing upstream rather than that nothing is
 * outstanding.
 */
import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';
import type { DeadlineItem } from './api';

type Translate = ReturnType<typeof useTranslation>['t'];

function titleCase(code: string): string {
  return code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, ' ');
}

/** Sortable YYYY-MM key so the time series stays chronological. */
function monthKey(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Same key the register's group headers use, so a slice reads like a group. */
function moduleLabel(code: string, t: Translate): string {
  return t(`deadlines.module.${code}`, { defaultValue: titleCase(code) });
}

function severityLabel(code: string, t: Translate): string {
  return t(`deadlines.insights.sev_${code}`, { defaultValue: titleCase(code) });
}

function classificationLabel(code: string, t: Translate): string {
  return t(`deadlines.insights.cls_${code}`, { defaultValue: titleCase(code) });
}

interface Row {
  // Index signature so a Row is directly a valid InsightDataset row (a plain
  // record of string/number cells) with no cast.
  [key: string]: string | number;
  title: string;
  module: string;
  owner: string;
  severity: string;
  classification: string;
  due_month: string;
  overdue: number;
  approaching: number;
  days_late: number;
}

function toRow(it: DeadlineItem, unassigned: string, t: Translate): Row {
  const late = it.days_overdue > 0;
  return {
    title: it.title ?? '',
    module: moduleLabel(it.module, t),
    owner: it.owner_name?.trim() || unassigned,
    severity: severityLabel(it.severity, t),
    classification: classificationLabel(it.classification, t),
    due_month: monthKey(it.due_date),
    overdue: late ? 1 : 0,
    approaching: it.classification === 'approaching' ? 1 : 0,
    // Only genuinely late work carries a slip. Something due next week has
    // negative days_overdue, which would drag an average towards zero and
    // make the register look healthier than it is.
    days_late: late ? it.days_overdue : 0,
  };
}

// Illustrative items for an empty register: a spread across the three source
// modules, owners and severities, with a realistic tail of slip, so every
// built-in chart has something to draw.
interface SampleDeadline {
  title: string;
  module: string;
  owner: string;
  severity: string;
  classification: string;
  daysOverdue: number;
}

const SAMPLE: SampleDeadline[] = [
  { title: 'Response to RFI on stair core rebar', module: 'correspondence', owner: 'Design manager', severity: 'critical', classification: 'overdue', daysOverdue: 14 },
  { title: 'Response to variation instruction 042', module: 'correspondence', owner: 'Commercial', severity: 'warning', classification: 'overdue', daysOverdue: 6 },
  { title: 'Letter of intent acknowledgement', module: 'correspondence', owner: 'Project director', severity: 'info', classification: 'approaching', daysOverdue: -4 },
  { title: 'Corrective action: concrete cube failure', module: 'qms_ncr_action', owner: 'QA lead', severity: 'critical', classification: 'overdue', daysOverdue: 21 },
  { title: 'Corrective action: weld inspection gap', module: 'qms_ncr_action', owner: 'QA lead', severity: 'warning', classification: 'overdue', daysOverdue: 3 },
  { title: 'Corrective action: membrane lap width', module: 'qms_ncr_action', owner: 'Site manager', severity: 'info', classification: 'approaching', daysOverdue: -7 },
  { title: 'Fire door closer not self-latching', module: 'punchlist', owner: 'Site manager', severity: 'critical', classification: 'overdue', daysOverdue: 12 },
  { title: 'Riser duct penetration unsealed', module: 'punchlist', owner: 'Site manager', severity: 'warning', classification: 'overdue', daysOverdue: 4 },
  { title: 'Rainwater outlet ponding on roof', module: 'punchlist', owner: 'Unassigned', severity: 'warning', classification: 'approaching', daysOverdue: -2 },
  { title: 'Socket outlet loose in unit 4.02', module: 'punchlist', owner: 'Unassigned', severity: 'info', classification: 'approaching', daysOverdue: -6 },
];

function sampleRow(s: SampleDeadline, t: Translate): Row {
  const due = new Date(Date.now() - s.daysOverdue * 24 * 60 * 60 * 1000);
  const late = s.daysOverdue > 0;
  return {
    title: s.title,
    module: moduleLabel(s.module, t),
    owner: s.owner,
    severity: severityLabel(s.severity, t),
    classification: classificationLabel(s.classification, t),
    due_month: monthKey(due.toISOString()),
    overdue: late ? 1 : 0,
    approaching: s.classification === 'approaching' ? 1 : 0,
    days_late: late ? s.daysOverdue : 0,
  };
}

export interface DeadlinesInsights {
  datasets: InsightDataset[];
  builtins: InsightDef[];
}

/**
 * Build the deadline dataset and its built-in charts. Deadlines carry no
 * money, so there is no currency and no currency-formatted measure.
 */
export function buildDeadlinesInsights(items: DeadlineItem[], t: Translate): DeadlinesInsights {
  const real = items.length > 0;
  const unassigned = t('deadlines.no_owner', { defaultValue: 'Unassigned' });

  const rows: Row[] = real
    ? items.map((it) => toRow(it, unassigned, t))
    : SAMPLE.map((s) => sampleRow(s, t));

  const dataset: InsightDataset = {
    id: 'deadlines',
    label: t('deadlines.insights.ds_deadlines', { defaultValue: 'Deadline register' }),
    currency: '',
    sample: !real,
    fields: [
      { key: 'title', label: t('deadlines.insights.f_title', { defaultValue: 'Item' }), kind: 'dimension' },
      { key: 'module', label: t('deadlines.insights.f_module', { defaultValue: 'Source module' }), kind: 'dimension' },
      { key: 'owner', label: t('deadlines.insights.f_owner', { defaultValue: 'Owner' }), kind: 'dimension' },
      { key: 'severity', label: t('deadlines.insights.f_severity', { defaultValue: 'Severity' }), kind: 'dimension' },
      { key: 'classification', label: t('deadlines.insights.f_classification', { defaultValue: 'Standing' }), kind: 'dimension' },
      { key: 'due_month', label: t('deadlines.insights.f_due_month', { defaultValue: 'Month due' }), kind: 'dimension' },
      { key: 'overdue', label: t('deadlines.insights.f_overdue', { defaultValue: 'Overdue' }), kind: 'measure', format: 'number' },
      { key: 'approaching', label: t('deadlines.insights.f_approaching', { defaultValue: 'Approaching' }), kind: 'measure', format: 'number' },
      { key: 'days_late', label: t('deadlines.insights.f_days_late', { defaultValue: 'Days late' }), kind: 'measure', format: 'number' },
    ],
    rows,
  };

  const base = { datasetId: 'deadlines', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-tracked', title: t('deadlines.insights.k_tracked', { defaultValue: 'Dated items tracked' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-overdue', title: t('deadlines.insights.k_overdue', { defaultValue: 'Overdue' }), chart: 'kpi', measure: 'overdue', agg: 'sum', color: 1 },
    { ...base, id: 'kpi-approaching', title: t('deadlines.insights.k_approaching', { defaultValue: 'Approaching' }), chart: 'kpi', measure: 'approaching', agg: 'sum', color: 4 },
    { ...base, id: 'kpi-worst', title: t('deadlines.insights.k_worst', { defaultValue: 'Worst slip (days)' }), chart: 'kpi', measure: 'days_late', agg: 'max', color: 5 },
    { ...base, id: 'bar-overdue-by-module', title: t('deadlines.insights.c_overdue_by_module', { defaultValue: 'Overdue by source module' }), chart: 'bar', dimension: 'module', measure: 'overdue', agg: 'sum', color: 1 },
    { ...base, id: 'bar-overdue-by-owner', title: t('deadlines.insights.c_overdue_by_owner', { defaultValue: 'Overdue by owner' }), chart: 'bar', dimension: 'owner', measure: 'overdue', agg: 'sum', color: 0 },
    { ...base, id: 'donut-by-severity', title: t('deadlines.insights.c_by_severity', { defaultValue: 'Items by severity' }), chart: 'donut', dimension: 'severity', agg: 'count', color: 4 },
    { ...base, id: 'bar-slip-by-module', title: t('deadlines.insights.c_slip_by_module', { defaultValue: 'Average slip by source module' }), chart: 'bar', dimension: 'module', measure: 'days_late', agg: 'avg', color: 5 },
  ];

  return { datasets: [dataset], builtins };
}
