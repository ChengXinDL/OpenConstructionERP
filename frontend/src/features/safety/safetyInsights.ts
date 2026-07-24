// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Safety module's contribution to the Module Insights panel: it turns the
 * incidents the page already loaded into one dataset plus a set of built-in
 * KPIs and charts (incidents by type, by severity and status, and the register
 * growing over time, with lost-time days rolled up). When a project has no
 * incidents yet, a clearly-labelled sample set stands in so the panel still
 * shows what it can do; the panel marks it "Sample data" so it is never
 * mistaken for the real thing.
 *
 * Labels reuse the same `safety.type_*` / `safety.severity_*` / `safety.status_*`
 * i18n keys the incidents table uses, so a slice in a chart reads exactly like
 * the badge on the row it came from. Safety records are count/severity/status
 * based - there is no money field, so every measure is a count, a flag or the
 * genuine lost-time day count.
 */
import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';

type Translate = ReturnType<typeof useTranslation>['t'];

/** Minimal shape the builder needs; a real Incident row satisfies it. */
interface SafetyLite {
  incident_number: string;
  type: string;
  severity: string;
  status: string;
  days_lost: number;
  date: string;
}

// Elevated incident severities (backend enum: minor|moderate|major|critical).
const HIGH_SEVERITIES = ['major', 'critical'];
// Anything not yet closed counts as open (status enum:
// reported|investigating|corrective_action|closed).
const CLOSED_STATUSES = ['closed'];

/** Sortable YYYY-MM key so the time series stays chronological. */
function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Humanised fallback for a snake_case enum token (e.g. near_miss -> Near miss). */
function humanize(code: string): string {
  const s = code.replace(/_/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—';
}

function typeLabel(code: string, t: Translate): string {
  return t(`safety.type_${code}`, { defaultValue: humanize(code) });
}

function severityLabel(code: string, t: Translate): string {
  return t(`safety.severity_${code}`, { defaultValue: humanize(code) });
}

function statusLabel(code: string, t: Translate): string {
  return t(`safety.status_${code}`, { defaultValue: humanize(code) });
}

interface Row {
  // Index signature so a Row is directly a valid InsightDataset row (a plain
  // record of string/number cells) with no cast.
  [key: string]: string | number;
  number: string;
  type: string;
  severity: string;
  status: string;
  month: string;
  days_lost: number;
  open: number;
  high: number;
}

function toRow(r: SafetyLite, t: Translate): Row {
  return {
    number: r.incident_number ?? '',
    type: typeLabel(r.type, t),
    severity: severityLabel(r.severity, t),
    status: statusLabel(r.status, t),
    month: monthKey(r.date),
    days_lost: r.days_lost ?? 0,
    open: CLOSED_STATUSES.includes(r.status) ? 0 : 1,
    high: HIGH_SEVERITIES.includes(r.severity) ? 1 : 0,
  };
}

// Illustrative incidents for an empty project - a realistic spread of types,
// severities, statuses, months and lost-time days so every built-in chart has
// something to draw.
const SAMPLE: Array<Omit<SafetyLite, 'date'> & { month: string }> = [
  { incident_number: 'INC-001', type: 'injury', severity: 'major', status: 'investigating', days_lost: 12, month: '2026-02' },
  { incident_number: 'INC-002', type: 'near_miss', severity: 'minor', status: 'closed', days_lost: 0, month: '2026-02' },
  { incident_number: 'INC-003', type: 'property_damage', severity: 'moderate', status: 'corrective_action', days_lost: 0, month: '2026-03' },
  { incident_number: 'INC-004', type: 'injury', severity: 'critical', status: 'investigating', days_lost: 30, month: '2026-03' },
  { incident_number: 'INC-005', type: 'environmental', severity: 'moderate', status: 'reported', days_lost: 0, month: '2026-04' },
  { incident_number: 'INC-006', type: 'near_miss', severity: 'minor', status: 'closed', days_lost: 0, month: '2026-04' },
  { incident_number: 'INC-007', type: 'fire', severity: 'major', status: 'corrective_action', days_lost: 3, month: '2026-05' },
  { incident_number: 'INC-008', type: 'injury', severity: 'minor', status: 'closed', days_lost: 2, month: '2026-05' },
];

export interface SafetyInsights {
  datasets: InsightDataset[];
  builtins: InsightDef[];
}

export function buildSafetyInsights(
  incidents: SafetyLite[],
  currency: string,
  t: Translate,
): SafetyInsights {
  const real = incidents.length > 0;

  const rows: Row[] = real
    ? [...incidents]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map((r) => toRow(r, t))
    : SAMPLE.map((s) => toRow({ ...s, date: `${s.month}-01` }, t));

  const dataset: InsightDataset = {
    id: 'incidents',
    label: t('safety.insights.ds_incidents', { defaultValue: 'Incidents' }),
    currency: currency || '',
    sample: !real,
    fields: [
      { key: 'number', label: t('safety.insights.f_number', { defaultValue: 'Incident #' }), kind: 'dimension' },
      { key: 'type', label: t('safety.insights.f_type', { defaultValue: 'Type' }), kind: 'dimension' },
      { key: 'severity', label: t('safety.insights.f_severity', { defaultValue: 'Severity' }), kind: 'dimension' },
      { key: 'status', label: t('safety.insights.f_status', { defaultValue: 'Status' }), kind: 'dimension' },
      { key: 'month', label: t('safety.insights.f_month', { defaultValue: 'Month' }), kind: 'dimension' },
      { key: 'days_lost', label: t('safety.insights.f_days_lost', { defaultValue: 'Days lost' }), kind: 'measure', format: 'number' },
      { key: 'open', label: t('safety.insights.f_open', { defaultValue: 'Open' }), kind: 'measure', format: 'number' },
      { key: 'high', label: t('safety.insights.f_high', { defaultValue: 'High / Critical' }), kind: 'measure', format: 'number' },
    ],
    rows,
  };

  const base = { datasetId: 'incidents', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-incidents', title: t('safety.insights.k_incidents', { defaultValue: 'Incidents' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-open', title: t('safety.insights.k_open', { defaultValue: 'Open' }), chart: 'kpi', measure: 'open', agg: 'sum', color: 4 },
    { ...base, id: 'kpi-high', title: t('safety.insights.k_high', { defaultValue: 'High / Critical' }), chart: 'kpi', measure: 'high', agg: 'sum', color: 1 },
    { ...base, id: 'kpi-days-lost', title: t('safety.insights.k_days_lost', { defaultValue: 'Days lost' }), chart: 'kpi', measure: 'days_lost', agg: 'sum', color: 3 },
    { ...base, id: 'bar-by-type', title: t('safety.insights.c_by_type', { defaultValue: 'Incidents by type' }), chart: 'bar', dimension: 'type', agg: 'count', color: 0 },
    { ...base, id: 'donut-by-severity', title: t('safety.insights.c_by_severity', { defaultValue: 'Incidents by severity' }), chart: 'donut', dimension: 'severity', agg: 'count', color: 1 },
    { ...base, id: 'bar-by-status', title: t('safety.insights.c_by_status', { defaultValue: 'Incidents by status' }), chart: 'bar', dimension: 'status', agg: 'count', color: 4 },
    { ...base, id: 'area-over-time', title: t('safety.insights.c_over_time', { defaultValue: 'Incidents over time' }), chart: 'area', dimension: 'month', agg: 'count', color: 5 },
  ];

  return { datasets: [dataset], builtins };
}
