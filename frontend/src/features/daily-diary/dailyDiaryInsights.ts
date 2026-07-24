// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Daily site diary's contribution to the Module Insights panel: it turns the
 * diaries the calendar already loaded into one dataset plus a set of built-in
 * KPIs and charts (site days logged over time, labour on site over time,
 * diaries by status and by weather). When a project has no diaries yet, a
 * clearly labelled sample set stands in so the panel still shows what it can
 * do; the panel marks it "Sample data" so it is never mistaken for the real
 * thing.
 *
 * Value labels reuse the same `daily_diary.status.*` i18n keys the calendar
 * badges use, so a slice in a chart reads exactly like the badge on the day it
 * came from. A diary carries no money field, so every measure is a plain number
 * (a count, a headcount or a 0/1 flag) - there is no currency KPI.
 */
import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';

type Translate = ReturnType<typeof useTranslation>['t'];

// Minimal shape this builder needs from a diary. The page hands it the full
// DailyDiary[] (structurally a superset of this), so no mapping is needed at
// the call site.
interface DiaryLite {
  diary_date: string;
  status: string;
  labour_count: number;
  equipment_count: number;
  weather_summary?: Record<string, unknown> | null;
}

// A diary is sealed once it is signed or archived - a tamper-evident, final
// record. open / closed diaries are still live.
const SEALED_STATUSES = ['signed', 'archived'];

// English fallbacks mirror the calendar badge labels (STATUS_LABEL_EN in
// DailyDiaryPage) so the chart reads the same before the translation loads.
const STATUS_LABEL_EN: Record<string, string> = {
  open: 'Open',
  closed: 'Closed',
  signed: 'Signed',
  archived: 'Archived',
};

/** Sortable YYYY-MM key so the time series stays chronological. */
function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Reasonable title-case fallback; the real translation wins when present. */
function humanize(code: string): string {
  const s = code.replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function statusLabel(code: string, t: Translate): string {
  return t(`daily_diary.status.${code}`, { defaultValue: STATUS_LABEL_EN[code] ?? humanize(code) });
}

// Weather is snapshotted onto the diary as `weather_summary.conditions` (a code
// like "clear" / "rain"). The register itself has no weather badge, so these
// slice labels are the module's own insights keys, defaulted to plain English.
function weatherLabel(summary: Record<string, unknown> | null | undefined, t: Translate): string {
  const raw = summary?.conditions;
  const code = typeof raw === 'string' ? raw.trim() : '';
  if (!code) return t('daily_diary.insights.weather_none', { defaultValue: 'Not recorded' });
  return t(`daily_diary.insights.weather_${code}`, { defaultValue: humanize(code) });
}

interface Row {
  // Index signature so a Row is directly a valid InsightDataset row (a plain
  // record of string/number cells) with no cast.
  [key: string]: string | number;
  date: string;
  status: string;
  weather: string;
  month: string;
  labour: number;
  equipment: number;
  signed: number;
}

function toRow(d: DiaryLite, t: Translate): Row {
  return {
    date: d.diary_date ?? '',
    status: statusLabel(d.status, t),
    weather: weatherLabel(d.weather_summary, t),
    month: monthKey(d.diary_date),
    labour: d.labour_count ?? 0,
    equipment: d.equipment_count ?? 0,
    signed: SEALED_STATUSES.includes(d.status) ? 1 : 0,
  };
}

// Illustrative diaries for an empty project - a run of site days across a few
// months with a spread of statuses, weather and a rising labour curve so every
// built-in chart has something to draw.
const SAMPLE: Array<{
  diary_date: string;
  status: string;
  labour_count: number;
  equipment_count: number;
  conditions: string;
}> = [
  { diary_date: '2026-02-03', status: 'signed', labour_count: 18, equipment_count: 4, conditions: 'clear' },
  { diary_date: '2026-02-17', status: 'signed', labour_count: 24, equipment_count: 5, conditions: 'cloudy' },
  { diary_date: '2026-03-05', status: 'signed', labour_count: 31, equipment_count: 6, conditions: 'rain' },
  { diary_date: '2026-03-19', status: 'archived', labour_count: 28, equipment_count: 5, conditions: 'overcast' },
  { diary_date: '2026-04-08', status: 'signed', labour_count: 35, equipment_count: 7, conditions: 'clear' },
  { diary_date: '2026-04-22', status: 'closed', labour_count: 40, equipment_count: 8, conditions: 'rain' },
  { diary_date: '2026-05-06', status: 'open', labour_count: 33, equipment_count: 6, conditions: 'snow' },
  { diary_date: '2026-05-20', status: 'open', labour_count: 29, equipment_count: 5, conditions: 'cloudy' },
];

export interface DailyDiaryInsights {
  datasets: InsightDataset[];
  builtins: InsightDef[];
}

export function buildDailyDiaryInsights(
  diaries: DiaryLite[],
  currency: string,
  t: Translate,
): DailyDiaryInsights {
  const real = diaries.length > 0;

  const rows: Row[] = real
    ? [...diaries]
        .sort((a, b) => (a.diary_date ?? '').localeCompare(b.diary_date ?? ''))
        .map((d) => toRow(d, t))
    : SAMPLE.map((s) =>
        toRow(
          {
            diary_date: s.diary_date,
            status: s.status,
            labour_count: s.labour_count,
            equipment_count: s.equipment_count,
            weather_summary: { conditions: s.conditions },
          },
          t,
        ),
      );

  const dataset: InsightDataset = {
    id: 'diaries',
    label: t('daily_diary.insights.ds_diaries', { defaultValue: 'Site diary register' }),
    currency: currency || '',
    sample: !real,
    fields: [
      { key: 'date', label: t('daily_diary.insights.f_date', { defaultValue: 'Diary date' }), kind: 'dimension' },
      { key: 'status', label: t('daily_diary.insights.f_status', { defaultValue: 'Status' }), kind: 'dimension' },
      { key: 'weather', label: t('daily_diary.insights.f_weather', { defaultValue: 'Weather' }), kind: 'dimension' },
      { key: 'month', label: t('daily_diary.insights.f_month', { defaultValue: 'Month' }), kind: 'dimension' },
      { key: 'labour', label: t('daily_diary.insights.f_labour', { defaultValue: 'Labour on site' }), kind: 'measure', format: 'number' },
      { key: 'equipment', label: t('daily_diary.insights.f_equipment', { defaultValue: 'Plant and equipment' }), kind: 'measure', format: 'number' },
      { key: 'signed', label: t('daily_diary.insights.f_signed', { defaultValue: 'Signed records' }), kind: 'measure', format: 'number' },
    ],
    rows,
  };

  const base = { datasetId: 'diaries', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-diaries', title: t('daily_diary.insights.k_diaries', { defaultValue: 'Site days logged' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-total-labour', title: t('daily_diary.insights.k_total_labour', { defaultValue: 'Total labour logged' }), chart: 'kpi', measure: 'labour', agg: 'sum', color: 3 },
    { ...base, id: 'kpi-avg-labour', title: t('daily_diary.insights.k_avg_labour', { defaultValue: 'Avg daily labour' }), chart: 'kpi', measure: 'labour', agg: 'avg', color: 4 },
    { ...base, id: 'kpi-signed', title: t('daily_diary.insights.k_signed', { defaultValue: 'Signed records' }), chart: 'kpi', measure: 'signed', agg: 'sum', color: 2 },
    { ...base, id: 'area-over-time', title: t('daily_diary.insights.c_over_time', { defaultValue: 'Site days logged over time' }), chart: 'area', dimension: 'month', agg: 'count', color: 5 },
    { ...base, id: 'line-labour-over-time', title: t('daily_diary.insights.c_labour_over_time', { defaultValue: 'Labour on site over time' }), chart: 'line', dimension: 'month', measure: 'labour', agg: 'sum', color: 0 },
    { ...base, id: 'donut-by-status', title: t('daily_diary.insights.c_by_status', { defaultValue: 'Diaries by status' }), chart: 'donut', dimension: 'status', agg: 'count', color: 4 },
    { ...base, id: 'bar-by-weather', title: t('daily_diary.insights.c_by_weather', { defaultValue: 'Site days by weather' }), chart: 'bar', dimension: 'weather', agg: 'count', color: 1 },
  ];

  return { datasets: [dataset], builtins };
}
