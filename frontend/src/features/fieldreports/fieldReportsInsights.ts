// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Field reports' contribution to the Module Insights panel: it turns the daily
 * site reports the page already loaded into one dataset plus a set of built-in
 * KPIs and charts (reports by type, by status, by weather, and how many reports
 * and labour hours land over time). When a project has no reports yet, a clearly
 * labelled sample set stands in so the panel still shows what it can do; the
 * panel marks it "Sample data" so it is never mistaken for the real thing.
 *
 * Value labels reuse the same `fieldreports.type_*` / `fieldreports.status_*` /
 * `fieldreports.weather_*` i18n keys the register uses, so a slice in a chart
 * reads exactly like the badge on the row it came from. A field report carries
 * no money field, so every measure is a plain number (a count, an hour count or
 * a 0/1 flag) - there is no currency KPI.
 */
import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';

type Translate = ReturnType<typeof useTranslation>['t'];

interface WorkforceLite {
  count?: number | null;
  hours?: number | null;
}

// Minimal shape this builder needs from a field report. The page hands it the
// full FieldReport[] (structurally a superset of this), so no mapping is needed
// at the call site.
interface FieldReportLite {
  report_date: string;
  report_type: string;
  weather_condition: string;
  status: string;
  workforce?: WorkforceLite[] | null;
  delay_hours?: number | null;
  created_at: string;
}

// A report is approved once it is signed off; draft and submitted are still in
// progress, so "open" is anything not yet approved.
const APPROVED_STATUS = 'approved';

/** Sortable YYYY-MM key so the time series stays chronological. */
function monthKey(iso: string): string {
  // report_date is a date-only string (yyyy-mm-dd); new Date() would read it as
  // UTC midnight and drift the month back a day for viewers west of UTC. Anchor
  // bare dates to local midnight (as the page's formatDate helper does); full
  // timestamps already carry their own time.
  const s = iso.length === 10 ? `${iso}T00:00:00` : iso;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return 'n/a';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Reasonable title-case fallback; the real translation wins when present. */
function humanize(code: string): string {
  const s = code.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function typeLabel(code: string, t: Translate): string {
  return t(`fieldreports.type_${code}`, { defaultValue: humanize(code) });
}

function statusLabel(code: string, t: Translate): string {
  return t(`fieldreports.status_${code}`, { defaultValue: humanize(code) });
}

function weatherLabel(code: string, t: Translate): string {
  return t(`fieldreports.weather_${code}`, { defaultValue: humanize(code) });
}

/** Total headcount and labour hours across the report's workforce rows. */
function workforceTotals(
  wf: WorkforceLite[] | null | undefined,
): { workers: number; hours: number } {
  let workers = 0;
  let hours = 0;
  for (const e of wf ?? []) {
    const c = e.count ?? 0;
    workers += c;
    hours += c * (e.hours ?? 0);
  }
  return { workers, hours: Math.round(hours * 10) / 10 };
}

interface Row {
  // Index signature so a Row is directly a valid InsightDataset row (a plain
  // record of string/number cells) with no cast.
  [key: string]: string | number;
  date: string;
  type: string;
  status: string;
  weather: string;
  month: string;
  workers: number;
  labour: number;
  delay: number;
  open: number;
  approved: number;
}

function toRow(r: FieldReportLite, t: Translate): Row {
  const { workers, hours } = workforceTotals(r.workforce);
  const approved = r.status === APPROVED_STATUS ? 1 : 0;
  return {
    date: r.report_date ?? '',
    type: typeLabel(r.report_type, t),
    status: statusLabel(r.status, t),
    weather: weatherLabel(r.weather_condition, t),
    month: monthKey(r.report_date || r.created_at),
    workers,
    labour: hours,
    delay: r.delay_hours ?? 0,
    open: approved ? 0 : 1,
    approved,
  };
}

// Illustrative field reports for an empty project - realistic daily, inspection,
// safety and concrete-pour records with a spread of statuses, weather, workforce
// and months so every built-in chart has something to draw.
const SAMPLE: FieldReportLite[] = [
  { report_date: '2026-02-03', report_type: 'daily', weather_condition: 'cloudy', status: 'approved', workforce: [{ count: 12, hours: 8 }, { count: 4, hours: 8 }], delay_hours: 0, created_at: '2026-02-03T17:00:00' },
  { report_date: '2026-02-17', report_type: 'inspection', weather_condition: 'clear', status: 'approved', workforce: [{ count: 3, hours: 6 }], delay_hours: 0, created_at: '2026-02-17T17:00:00' },
  { report_date: '2026-03-04', report_type: 'concrete_pour', weather_condition: 'rain', status: 'submitted', workforce: [{ count: 18, hours: 10 }, { count: 6, hours: 10 }], delay_hours: 3, created_at: '2026-03-04T17:00:00' },
  { report_date: '2026-03-19', report_type: 'daily', weather_condition: 'fog', status: 'approved', workforce: [{ count: 14, hours: 8 }], delay_hours: 2, created_at: '2026-03-19T17:00:00' },
  { report_date: '2026-04-02', report_type: 'safety', weather_condition: 'clear', status: 'submitted', workforce: [{ count: 9, hours: 8 }], delay_hours: 0, created_at: '2026-04-02T17:00:00' },
  { report_date: '2026-04-21', report_type: 'daily', weather_condition: 'storm', status: 'draft', workforce: [{ count: 5, hours: 4 }], delay_hours: 6, created_at: '2026-04-21T17:00:00' },
  { report_date: '2026-05-06', report_type: 'concrete_pour', weather_condition: 'cloudy', status: 'approved', workforce: [{ count: 20, hours: 9 }, { count: 8, hours: 9 }], delay_hours: 0, created_at: '2026-05-06T17:00:00' },
  { report_date: '2026-05-18', report_type: 'inspection', weather_condition: 'snow', status: 'draft', workforce: [{ count: 4, hours: 6 }], delay_hours: 1, created_at: '2026-05-18T17:00:00' },
];

export interface FieldReportsInsights {
  datasets: InsightDataset[];
  builtins: InsightDef[];
}

export function buildFieldReportsInsights(
  reports: FieldReportLite[],
  currency: string,
  t: Translate,
): FieldReportsInsights {
  const real = reports.length > 0;

  const rows: Row[] = real
    ? [...reports]
        .sort((a, b) => new Date(a.report_date).getTime() - new Date(b.report_date).getTime())
        .map((r) => toRow(r, t))
    : SAMPLE.map((s) => toRow(s, t));

  const dataset: InsightDataset = {
    id: 'fieldreports',
    label: t('fieldreports.insights.ds_reports', { defaultValue: 'Field reports' }),
    currency: currency || '',
    sample: !real,
    fields: [
      { key: 'date', label: t('fieldreports.insights.f_date', { defaultValue: 'Report date' }), kind: 'dimension' },
      { key: 'type', label: t('fieldreports.insights.f_type', { defaultValue: 'Type' }), kind: 'dimension' },
      { key: 'status', label: t('fieldreports.insights.f_status', { defaultValue: 'Status' }), kind: 'dimension' },
      { key: 'weather', label: t('fieldreports.insights.f_weather', { defaultValue: 'Weather' }), kind: 'dimension' },
      { key: 'month', label: t('fieldreports.insights.f_month', { defaultValue: 'Month' }), kind: 'dimension' },
      { key: 'workers', label: t('fieldreports.insights.f_workers', { defaultValue: 'Workers' }), kind: 'measure', format: 'number' },
      { key: 'labour', label: t('fieldreports.insights.f_labour', { defaultValue: 'Labour hours' }), kind: 'measure', format: 'number' },
      { key: 'delay', label: t('fieldreports.insights.f_delay', { defaultValue: 'Delay hours' }), kind: 'measure', format: 'number' },
      { key: 'open', label: t('fieldreports.insights.f_open', { defaultValue: 'Open' }), kind: 'measure', format: 'number' },
      { key: 'approved', label: t('fieldreports.insights.f_approved', { defaultValue: 'Approved' }), kind: 'measure', format: 'number' },
    ],
    rows,
  };

  const base = { datasetId: 'fieldreports', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-reports', title: t('fieldreports.insights.k_reports', { defaultValue: 'Reports' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-labour', title: t('fieldreports.insights.k_labour', { defaultValue: 'Labour hours' }), chart: 'kpi', measure: 'labour', agg: 'sum', color: 3 },
    { ...base, id: 'kpi-delay', title: t('fieldreports.insights.k_delay', { defaultValue: 'Delay hours' }), chart: 'kpi', measure: 'delay', agg: 'sum', color: 1 },
    { ...base, id: 'kpi-approved', title: t('fieldreports.insights.k_approved', { defaultValue: 'Approved' }), chart: 'kpi', measure: 'approved', agg: 'sum', color: 6 },
    { ...base, id: 'bar-by-type', title: t('fieldreports.insights.c_by_type', { defaultValue: 'Reports by type' }), chart: 'bar', dimension: 'type', agg: 'count', color: 0 },
    { ...base, id: 'donut-by-status', title: t('fieldreports.insights.c_by_status', { defaultValue: 'Reports by status' }), chart: 'donut', dimension: 'status', agg: 'count', color: 4 },
    { ...base, id: 'bar-by-weather', title: t('fieldreports.insights.c_by_weather', { defaultValue: 'Reports by weather' }), chart: 'bar', dimension: 'weather', agg: 'count', color: 3 },
    { ...base, id: 'area-over-time', title: t('fieldreports.insights.c_over_time', { defaultValue: 'Reports logged over time' }), chart: 'area', dimension: 'month', agg: 'count', color: 5 },
    { ...base, id: 'line-labour-over-time', title: t('fieldreports.insights.c_labour_over_time', { defaultValue: 'Labour hours over time' }), chart: 'line', dimension: 'month', measure: 'labour', agg: 'sum', color: 6 },
  ];

  return { datasets: [dataset], builtins };
}
