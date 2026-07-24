// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Variations' contribution to the Module Insights panel. It reads the
 * variation requests the page already loaded (the entity that carries the
 * commercial and programme impact of every proposed change) and turns them
 * into one dataset plus built-in KPIs and charts: total cost impact, approved
 * vs pending counts, cost by change type, the approval-status split and how
 * the exposure builds up over time. When a project has no requests yet, a
 * clearly-labelled sample set stands in so the panel still shows what it can
 * do; the panel marks it "Sample data" so it is never mistaken for real data.
 *
 * The panel charts variation requests specifically (not notices, orders,
 * daywork or EOT) because requests are where the estimated cost and schedule
 * impact of a change lives before it is priced into an order.
 */
import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';

type Translate = ReturnType<typeof useTranslation>['t'];

/**
 * Minimal shape the builder needs from a variation request. The page's real
 * `VariationRequest` type structurally satisfies this (the money field stays
 * `number | string` so the raw record is assignable without a cast).
 */
interface VariationRequestLite {
  title?: string;
  classification: string;
  status: string;
  urgency: string;
  estimated_cost_impact: number | string;
  estimated_schedule_days: number;
  currency?: string;
  created_at: string;
}

/** Sortable YYYY-MM key so the time series stays chronological. */
function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Fallback for an unknown code: "under_review" -> "Under review". */
function humanize(code: string): string {
  const spaced = code.replace(/_/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : spaced;
}

// Human labels for the fixed enums (VRClassification / VRStatus / VRUrgency).
// Kept as the t() defaultValue so English reads well even before the locale
// keys land, and an unknown code degrades gracefully via humanize().
const CLASS_LABELS: Record<string, string> = {
  scope_change: 'Scope change',
  unforeseen: 'Unforeseen condition',
  owner_change: 'Owner change',
  design_dev: 'Design development',
  regulatory: 'Regulatory',
  other: 'Other',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  approved: 'Approved',
  rejected: 'Rejected',
  converted_to_vo: 'Converted to order',
};

const URGENCY_LABELS: Record<string, string> = {
  low: 'Low',
  med: 'Medium',
  high: 'High',
};

function classLabel(code: string, t: Translate): string {
  return t(`variations.insights.class_${code}`, { defaultValue: CLASS_LABELS[code] ?? humanize(code) });
}

function statusLabel(code: string, t: Translate): string {
  return t(`variations.insights.status_${code}`, { defaultValue: STATUS_LABELS[code] ?? humanize(code) });
}

function urgencyLabel(code: string, t: Translate): string {
  return t(`variations.insights.urgency_${code}`, { defaultValue: URGENCY_LABELS[code] ?? humanize(code) });
}

interface Row {
  // Index signature so a Row is directly a valid InsightDataset row (a plain
  // record of string/number cells) with no cast.
  [key: string]: string | number;
  title: string;
  type: string;
  status: string;
  urgency: string;
  month: string;
  cost: number;
  schedule: number;
  approved: number;
  pending: number;
}

function toRow(r: VariationRequestLite, t: Translate): Row {
  return {
    title: r.title ?? '',
    type: classLabel(r.classification, t),
    status: statusLabel(r.status, t),
    urgency: urgencyLabel(r.urgency, t),
    month: monthKey(r.created_at),
    cost: Number(r.estimated_cost_impact) || 0,
    schedule: Number(r.estimated_schedule_days) || 0,
    approved: r.status === 'approved' ? 1 : 0,
    pending: r.status === 'submitted' || r.status === 'under_review' ? 1 : 0,
  };
}

// Illustrative variation requests for a project with none yet - a realistic
// spread of change types, urgencies, approval states, cost impacts and months
// so every built-in KPI and chart has something to show.
const SAMPLE: Array<Omit<VariationRequestLite, 'created_at'> & { month: string }> = [
  { title: 'Additional piling to grid C', classification: 'unforeseen', status: 'approved', urgency: 'high', estimated_cost_impact: 48000, estimated_schedule_days: 6, month: '2026-02' },
  { title: 'Revised lobby cladding', classification: 'owner_change', status: 'under_review', urgency: 'med', estimated_cost_impact: 72000, estimated_schedule_days: 10, month: '2026-02' },
  { title: 'Rock removal at south basement', classification: 'unforeseen', status: 'approved', urgency: 'high', estimated_cost_impact: 95000, estimated_schedule_days: 14, month: '2026-03' },
  { title: 'Upgraded fire detection', classification: 'regulatory', status: 'submitted', urgency: 'med', estimated_cost_impact: 26000, estimated_schedule_days: 4, month: '2026-03' },
  { title: 'Coordinated MEP routing', classification: 'design_dev', status: 'approved', urgency: 'low', estimated_cost_impact: 18000, estimated_schedule_days: 3, month: '2026-04' },
  { title: 'Extra parking bays', classification: 'scope_change', status: 'rejected', urgency: 'low', estimated_cost_impact: 34000, estimated_schedule_days: 5, month: '2026-04' },
  { title: 'Facade colour change', classification: 'owner_change', status: 'draft', urgency: 'low', estimated_cost_impact: 12000, estimated_schedule_days: 2, month: '2026-05' },
  { title: 'Accessibility ramp revision', classification: 'regulatory', status: 'converted_to_vo', urgency: 'high', estimated_cost_impact: 41000, estimated_schedule_days: 7, month: '2026-05' },
];

export interface VariationsInsights {
  datasets: InsightDataset[];
  builtins: InsightDef[];
}

export function buildVariationsInsights(
  requests: VariationRequestLite[],
  currency: string,
  t: Translate,
): VariationsInsights {
  const real = requests.length > 0;

  const rows: Row[] = real
    ? [...requests]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((r) => toRow(r, t))
    : SAMPLE.map((r) => toRow({ ...r, created_at: `${r.month}-01` }, t));

  const dataset: InsightDataset = {
    id: 'variation_requests',
    label: t('variations.insights.ds_requests', { defaultValue: 'Variation requests' }),
    currency: currency || '',
    sample: !real,
    fields: [
      { key: 'title', label: t('variations.insights.f_title', { defaultValue: 'Request' }), kind: 'dimension' },
      { key: 'type', label: t('variations.insights.f_type', { defaultValue: 'Type' }), kind: 'dimension' },
      { key: 'status', label: t('variations.insights.f_status', { defaultValue: 'Status' }), kind: 'dimension' },
      { key: 'urgency', label: t('variations.insights.f_urgency', { defaultValue: 'Urgency' }), kind: 'dimension' },
      { key: 'month', label: t('variations.insights.f_month', { defaultValue: 'Month logged' }), kind: 'dimension' },
      { key: 'cost', label: t('variations.insights.f_cost', { defaultValue: 'Cost impact' }), kind: 'measure', format: 'currency' },
      { key: 'schedule', label: t('variations.insights.f_schedule', { defaultValue: 'Schedule impact (days)' }), kind: 'measure', format: 'number' },
      { key: 'approved', label: t('variations.insights.f_approved', { defaultValue: 'Approved' }), kind: 'measure', format: 'number' },
      { key: 'pending', label: t('variations.insights.f_pending', { defaultValue: 'Pending' }), kind: 'measure', format: 'number' },
    ],
    rows,
  };

  const base = { datasetId: 'variation_requests', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-count', title: t('variations.insights.k_count', { defaultValue: 'Variations' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-cost', title: t('variations.insights.k_cost', { defaultValue: 'Total cost impact' }), chart: 'kpi', measure: 'cost', agg: 'sum', color: 1 },
    { ...base, id: 'kpi-approved', title: t('variations.insights.k_approved', { defaultValue: 'Approved' }), chart: 'kpi', measure: 'approved', agg: 'sum', color: 2 },
    { ...base, id: 'kpi-pending', title: t('variations.insights.k_pending', { defaultValue: 'Pending' }), chart: 'kpi', measure: 'pending', agg: 'sum', color: 4 },
    { ...base, id: 'bar-cost-by-type', title: t('variations.insights.c_cost_by_type', { defaultValue: 'Cost impact by type' }), chart: 'bar', dimension: 'type', measure: 'cost', agg: 'sum', color: 1 },
    { ...base, id: 'donut-by-status', title: t('variations.insights.c_by_status', { defaultValue: 'Requests by status' }), chart: 'donut', dimension: 'status', agg: 'count', color: 4 },
    { ...base, id: 'bar-by-urgency', title: t('variations.insights.c_by_urgency', { defaultValue: 'Requests by urgency' }), chart: 'bar', dimension: 'urgency', agg: 'count', color: 0 },
    { ...base, id: 'area-cost-over-time', title: t('variations.insights.c_cost_over_time', { defaultValue: 'Cost impact over time' }), chart: 'area', dimension: 'month', measure: 'cost', agg: 'sum', color: 5 },
  ];

  return { datasets: [dataset], builtins };
}
