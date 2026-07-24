// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Risk register's contribution to the Module Insights panel: it turns the
 * risks the page already loaded into one dataset plus a set of built-in KPIs
 * and charts (exposure by category, risks by severity and status, register
 * growth over time). When a project has no risks yet, a clearly-labelled
 * sample set stands in so the panel still shows what it can do; the panel
 * marks it "Sample data" so it is never mistaken for the real thing.
 *
 * Labels reuse the same `risk.cat_*` / `risk.severity_*` / `risk.status_*`
 * i18n keys the register table uses, so a slice in a chart reads exactly like
 * the badge on the row it came from.
 */
import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';

type Translate = ReturnType<typeof useTranslation>['t'];

interface RiskLite {
  title: string;
  category: string;
  impact_severity: string;
  status: string;
  risk_score: number;
  impact_cost: number;
  impact_schedule_days: number;
  owner_name: string;
  created_at: string;
}

const HIGH_SEVERITIES = ['high', 'critical'];
const MITIGATED_STATUSES = ['mitigating', 'mitigated', 'closed'];

/** Sortable YYYY-MM key so the time series stays chronological. */
function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function catLabel(code: string, t: Translate): string {
  return t(`risk.cat_${code}`, { defaultValue: code.charAt(0).toUpperCase() + code.slice(1) });
}

function severityLabel(code: string, t: Translate): string {
  return t(`risk.severity_${code}`, { defaultValue: code.charAt(0).toUpperCase() + code.slice(1) });
}

function statusLabel(code: string, t: Translate): string {
  return t(`risk.status_${code}`, { defaultValue: code.charAt(0).toUpperCase() + code.slice(1) });
}

interface Row {
  // Index signature so a Row is directly a valid InsightDataset row (a plain
  // record of string/number cells) with no cast.
  [key: string]: string | number;
  title: string;
  category: string;
  severity: string;
  status: string;
  owner: string;
  month: string;
  exposure: number;
  score: number;
  schedule: number;
  high: number;
  mitigated: number;
}

function toRow(r: RiskLite, unassigned: string, t: Translate): Row {
  return {
    title: r.title ?? '',
    category: catLabel(r.category, t),
    severity: severityLabel(r.impact_severity, t),
    status: statusLabel(r.status, t),
    owner: r.owner_name?.trim() || unassigned,
    month: monthKey(r.created_at),
    exposure: r.impact_cost ?? 0,
    score: r.risk_score ?? 0,
    schedule: r.impact_schedule_days ?? 0,
    high: HIGH_SEVERITIES.includes(r.impact_severity) ? 1 : 0,
    mitigated: MITIGATED_STATUSES.includes(r.status) ? 1 : 0,
  };
}

// Illustrative risks for an empty project - realistic construction threats
// with a spread of categories, severities, statuses and months so every
// built-in chart has something to draw.
const SAMPLE: Array<Omit<RiskLite, 'created_at'> & { month: string }> = [
  { title: 'Ground conditions worse than survey', category: 'technical', impact_severity: 'high', status: 'mitigating', risk_score: 16, impact_cost: 180000, impact_schedule_days: 20, owner_name: 'Geotech lead', month: '2026-02' },
  { title: 'Steel price escalation', category: 'financial', impact_severity: 'critical', status: 'monitoring', risk_score: 20, impact_cost: 240000, impact_schedule_days: 0, owner_name: 'Commercial', month: '2026-02' },
  { title: 'Permit approval delay', category: 'regulatory', impact_severity: 'high', status: 'open', risk_score: 15, impact_cost: 60000, impact_schedule_days: 30, owner_name: 'Project director', month: '2026-03' },
  { title: 'Late design information', category: 'schedule', impact_severity: 'medium', status: 'mitigating', risk_score: 9, impact_cost: 45000, impact_schedule_days: 15, owner_name: 'Design manager', month: '2026-03' },
  { title: 'Contaminated soil removal', category: 'environmental', impact_severity: 'high', status: 'assessed', risk_score: 12, impact_cost: 130000, impact_schedule_days: 10, owner_name: 'HSE', month: '2026-04' },
  { title: 'Working-at-height incident', category: 'safety', impact_severity: 'critical', status: 'monitoring', risk_score: 20, impact_cost: 90000, impact_schedule_days: 5, owner_name: 'HSE', month: '2026-04' },
  { title: 'Key subcontractor insolvency', category: 'procurement', impact_severity: 'medium', status: 'open', risk_score: 10, impact_cost: 75000, impact_schedule_days: 25, owner_name: 'Commercial', month: '2026-05' },
  { title: 'Crane availability clash', category: 'schedule', impact_severity: 'low', status: 'mitigated', risk_score: 4, impact_cost: 12000, impact_schedule_days: 3, owner_name: 'Site manager', month: '2026-05' },
];

export interface RiskInsights {
  datasets: InsightDataset[];
  builtins: InsightDef[];
}

export function buildRiskInsights(
  risks: RiskLite[],
  currency: string,
  t: Translate,
): RiskInsights {
  const real = risks.length > 0;
  const unassigned = t('risk.insights.unassigned', { defaultValue: 'Unassigned' });

  const rows: Row[] = real
    ? [...risks]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((r) => toRow(r, unassigned, t))
    : SAMPLE.map((s) => toRow({ ...s, created_at: `${s.month}-01` }, unassigned, t));

  const dataset: InsightDataset = {
    id: 'risks',
    label: t('risk.insights.ds_risks', { defaultValue: 'Risk register' }),
    currency: currency || '',
    sample: !real,
    fields: [
      { key: 'title', label: t('risk.insights.f_title', { defaultValue: 'Risk' }), kind: 'dimension' },
      { key: 'category', label: t('risk.insights.f_category', { defaultValue: 'Category' }), kind: 'dimension' },
      { key: 'severity', label: t('risk.insights.f_severity', { defaultValue: 'Severity' }), kind: 'dimension' },
      { key: 'status', label: t('risk.insights.f_status', { defaultValue: 'Status' }), kind: 'dimension' },
      { key: 'owner', label: t('risk.insights.f_owner', { defaultValue: 'Owner' }), kind: 'dimension' },
      { key: 'month', label: t('risk.insights.f_month', { defaultValue: 'Month logged' }), kind: 'dimension' },
      { key: 'exposure', label: t('risk.insights.f_exposure', { defaultValue: 'Cost exposure' }), kind: 'measure', format: 'currency' },
      { key: 'score', label: t('risk.insights.f_score', { defaultValue: 'Risk score' }), kind: 'measure', format: 'number' },
      { key: 'schedule', label: t('risk.insights.f_schedule', { defaultValue: 'Schedule impact (days)' }), kind: 'measure', format: 'number' },
      { key: 'high', label: t('risk.insights.f_high', { defaultValue: 'High / Critical' }), kind: 'measure', format: 'number' },
      { key: 'mitigated', label: t('risk.insights.f_mitigated', { defaultValue: 'Mitigated' }), kind: 'measure', format: 'number' },
    ],
    rows,
  };

  const base = { datasetId: 'risks', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-risks', title: t('risk.insights.k_risks', { defaultValue: 'Risks' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-exposure', title: t('risk.insights.k_exposure', { defaultValue: 'Total exposure' }), chart: 'kpi', measure: 'exposure', agg: 'sum', color: 1 },
    { ...base, id: 'kpi-avg-score', title: t('risk.insights.k_avgscore', { defaultValue: 'Avg risk score' }), chart: 'kpi', measure: 'score', agg: 'avg', color: 4 },
    { ...base, id: 'kpi-high', title: t('risk.insights.k_high', { defaultValue: 'High / Critical' }), chart: 'kpi', measure: 'high', agg: 'sum', color: 1 },
    { ...base, id: 'bar-exposure-by-cat', title: t('risk.insights.c_exposure_by_cat', { defaultValue: 'Exposure by category' }), chart: 'bar', dimension: 'category', measure: 'exposure', agg: 'sum', color: 1 },
    { ...base, id: 'donut-by-severity', title: t('risk.insights.c_by_severity', { defaultValue: 'Risks by severity' }), chart: 'donut', dimension: 'severity', agg: 'count', color: 4 },
    { ...base, id: 'bar-by-status', title: t('risk.insights.c_by_status', { defaultValue: 'Risks by status' }), chart: 'bar', dimension: 'status', agg: 'count', color: 0 },
    { ...base, id: 'area-over-time', title: t('risk.insights.c_over_time', { defaultValue: 'Risks logged over time' }), chart: 'area', dimension: 'month', agg: 'count', color: 5 },
  ];

  return { datasets: [dataset], builtins };
}
