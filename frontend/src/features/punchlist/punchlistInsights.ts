// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Punch list's contribution to the Module Insights panel. The snag table shows
 * one row per defect; what a site manager actually needs before a walk is the
 * shape of the list - which trade is carrying the most open work, how much of
 * it is past its due date, and whether the list is shrinking or growing week
 * on week. Those are exactly the numbers a row-by-row table hides.
 *
 * Everything is derived from the punch items the page already loaded, so the
 * panel costs no extra request. On a project with no snags a clearly-labelled
 * sample set stands in so the panel still shows what it can do.
 *
 * Row VALUES reuse the same `punch.status_*` / `punch.priority_*` /
 * `punch.category_*` keys the table badges use, so a chart slice reads exactly
 * like the badge on the row it came from.
 */
import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';
import type { PunchItem } from './api';

type Translate = ReturnType<typeof useTranslation>['t'];

/** Statuses that mean the snag is off the site manager's list. */
const DONE_STATUSES = ['resolved', 'verified', 'closed'];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Sortable YYYY-MM key so the time series stays chronological. */
function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function titleCase(code: string): string {
  return code.charAt(0).toUpperCase() + code.slice(1).replace(/_/g, ' ');
}

function statusLabel(code: string, t: Translate): string {
  return t(`punch.status_${code}`, { defaultValue: titleCase(code) });
}

function priorityLabel(code: string, t: Translate): string {
  return t(`punch.priority_${code}`, { defaultValue: titleCase(code) });
}

function categoryLabel(code: string | null, t: Translate, fallback: string): string {
  if (!code) return fallback;
  return t(`punch.category_${code}`, { defaultValue: titleCase(code) });
}

/**
 * Whole days between two instants, floored at zero. Used for both "how long
 * has this been open" and "how far past its due date is it".
 */
function daysBetween(fromIso: string, toMs: number): number {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((toMs - from) / DAY_MS));
}

interface Row {
  // Index signature so a Row is directly a valid InsightDataset row (a plain
  // record of string/number cells) with no cast.
  [key: string]: string | number;
  title: string;
  status: string;
  priority: string;
  category: string;
  trade: string;
  assignee: string;
  month: string;
  open: number;
  overdue: number;
  age: number;
  reopened: number;
}

function toRow(item: PunchItem, unassigned: string, none: string, t: Translate): Row {
  const now = Date.now();
  const isOpen = !DONE_STATUSES.includes(item.status);
  const due = item.due_date ? new Date(item.due_date).getTime() : NaN;
  // "Overdue" only counts work still outstanding. A snag closed late is a
  // historical fact, not something to chase today.
  const overdue = isOpen && !Number.isNaN(due) && due < now ? 1 : 0;
  // Age runs to the point the snag left the list, so closed items keep the
  // turnaround they actually had rather than ageing forever.
  const end = !isOpen && item.resolved_at ? new Date(item.resolved_at).getTime() : now;

  return {
    title: item.title ?? '',
    status: statusLabel(item.status, t),
    priority: priorityLabel(item.priority, t),
    category: categoryLabel(item.category, t, none),
    trade: item.trade?.trim() || none,
    assignee: item.assigned_to?.trim() || unassigned,
    month: monthKey(item.created_at),
    open: isOpen ? 1 : 0,
    overdue,
    age: daysBetween(item.created_at, Number.isNaN(end) ? now : end),
    reopened: item.reopen_history?.length ?? 0,
  };
}

// Illustrative snags for an empty project: a realistic spread of trades,
// categories, priorities and statuses so every built-in chart has something to
// draw. Dates are relative to now so the "raised over time" series and the
// overdue count stay sensible whenever the panel is opened.
interface SampleSnag {
  title: string;
  status: string;
  priority: string;
  category: string;
  trade: string;
  assignee: string;
  /** Days before today the snag was raised. */
  raisedDaysAgo: number;
  /** Days from today the snag is due; negative means already past due. */
  dueInDays: number | null;
  reopened: number;
}

const SAMPLE: SampleSnag[] = [
  { title: 'Fire door closer not self-latching', status: 'open', priority: 'critical', category: 'fire_safety', trade: 'Joinery', assignee: 'A. Novak', raisedDaysAgo: 41, dueInDays: -12, reopened: 1 },
  { title: 'Riser duct penetration unsealed', status: 'in_progress', priority: 'high', category: 'mechanical', trade: 'Mechanical', assignee: 'M. Ferreira', raisedDaysAgo: 33, dueInDays: -4, reopened: 0 },
  { title: 'Socket outlet loose in unit 4.02', status: 'open', priority: 'medium', category: 'electrical', trade: 'Electrical', assignee: 'K. Bauer', raisedDaysAgo: 27, dueInDays: 6, reopened: 0 },
  { title: 'Plaster crack above lobby lintel', status: 'assigned', priority: 'medium', category: 'finishing', trade: 'Finishes', assignee: 'S. Ilic', raisedDaysAgo: 24, dueInDays: 9, reopened: 0 },
  { title: 'Rainwater outlet ponding on roof', status: 'open', priority: 'high', category: 'exterior', trade: 'Roofing', assignee: 'T. Adeyemi', raisedDaysAgo: 19, dueInDays: -2, reopened: 0 },
  { title: 'WC waste trap weeping', status: 'resolved', priority: 'medium', category: 'plumbing', trade: 'Plumbing', assignee: 'M. Ferreira', raisedDaysAgo: 16, dueInDays: 3, reopened: 0 },
  { title: 'Handrail bracket fixing short', status: 'verified', priority: 'high', category: 'structural', trade: 'Steelwork', assignee: 'K. Bauer', raisedDaysAgo: 12, dueInDays: 5, reopened: 1 },
  { title: 'AHU filter access panel fouls duct', status: 'in_progress', priority: 'low', category: 'hvac', trade: 'Mechanical', assignee: 'A. Novak', raisedDaysAgo: 9, dueInDays: 11, reopened: 0 },
  { title: 'Ceiling tile cut oversize at grille', status: 'open', priority: 'low', category: 'finishing', trade: 'Finishes', assignee: 'S. Ilic', raisedDaysAgo: 5, dueInDays: 14, reopened: 0 },
  { title: 'Kerb line out of tolerance at entrance', status: 'closed', priority: 'medium', category: 'landscaping', trade: 'Groundworks', assignee: 'T. Adeyemi', raisedDaysAgo: 3, dueInDays: 18, reopened: 0 },
];

function sampleRow(s: SampleSnag, t: Translate): Row {
  const now = Date.now();
  const created = new Date(now - s.raisedDaysAgo * DAY_MS).toISOString();
  const isOpen = !DONE_STATUSES.includes(s.status);
  return {
    title: s.title,
    status: statusLabel(s.status, t),
    priority: priorityLabel(s.priority, t),
    category: categoryLabel(s.category, t, s.category),
    trade: s.trade,
    assignee: s.assignee,
    month: monthKey(created),
    open: isOpen ? 1 : 0,
    overdue: isOpen && s.dueInDays !== null && s.dueInDays < 0 ? 1 : 0,
    age: isOpen ? s.raisedDaysAgo : Math.max(1, Math.round(s.raisedDaysAgo * 0.6)),
    reopened: s.reopened,
  };
}

export interface PunchlistInsights {
  datasets: InsightDataset[];
  builtins: InsightDef[];
}

/**
 * Build the punch list dataset and its built-in charts.
 *
 * No `currency` argument and no currency-formatted measure: a punch item
 * carries no money, and a fake currency KPI would be worse than none.
 */
export function buildPunchlistInsights(items: PunchItem[], t: Translate): PunchlistInsights {
  const real = items.length > 0;
  const unassigned = t('punch.insights.unassigned', { defaultValue: 'Unassigned' });
  const none = t('punch.insights.none', { defaultValue: 'Not set' });

  const rows: Row[] = real
    ? [...items]
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .map((item) => toRow(item, unassigned, none, t))
    : SAMPLE.map((s) => sampleRow(s, t));

  const dataset: InsightDataset = {
    id: 'punch',
    label: t('punch.insights.ds_punch', { defaultValue: 'Punch list' }),
    currency: '',
    sample: !real,
    fields: [
      { key: 'title', label: t('punch.insights.f_title', { defaultValue: 'Item' }), kind: 'dimension' },
      { key: 'status', label: t('punch.insights.f_status', { defaultValue: 'Status' }), kind: 'dimension' },
      { key: 'priority', label: t('punch.insights.f_priority', { defaultValue: 'Priority' }), kind: 'dimension' },
      { key: 'category', label: t('punch.insights.f_category', { defaultValue: 'Category' }), kind: 'dimension' },
      { key: 'trade', label: t('punch.insights.f_trade', { defaultValue: 'Trade' }), kind: 'dimension' },
      { key: 'assignee', label: t('punch.insights.f_assignee', { defaultValue: 'Assigned to' }), kind: 'dimension' },
      { key: 'month', label: t('punch.insights.f_month', { defaultValue: 'Month raised' }), kind: 'dimension' },
      { key: 'open', label: t('punch.insights.f_open', { defaultValue: 'Still open' }), kind: 'measure', format: 'number' },
      { key: 'overdue', label: t('punch.insights.f_overdue', { defaultValue: 'Overdue' }), kind: 'measure', format: 'number' },
      { key: 'age', label: t('punch.insights.f_age', { defaultValue: 'Days on the list' }), kind: 'measure', format: 'number' },
      { key: 'reopened', label: t('punch.insights.f_reopened', { defaultValue: 'Times reopened' }), kind: 'measure', format: 'number' },
    ],
    rows,
  };

  const base = { datasetId: 'punch', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-items', title: t('punch.insights.k_items', { defaultValue: 'Punch items' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-open', title: t('punch.insights.k_open', { defaultValue: 'Still open' }), chart: 'kpi', measure: 'open', agg: 'sum', color: 4 },
    { ...base, id: 'kpi-overdue', title: t('punch.insights.k_overdue', { defaultValue: 'Past due date' }), chart: 'kpi', measure: 'overdue', agg: 'sum', color: 1 },
    { ...base, id: 'kpi-age', title: t('punch.insights.k_age', { defaultValue: 'Avg days on the list' }), chart: 'kpi', measure: 'age', agg: 'avg', color: 5 },
    { ...base, id: 'bar-open-by-trade', title: t('punch.insights.c_open_by_trade', { defaultValue: 'Open items by trade' }), chart: 'bar', dimension: 'trade', measure: 'open', agg: 'sum', color: 0 },
    { ...base, id: 'donut-by-status', title: t('punch.insights.c_by_status', { defaultValue: 'Items by status' }), chart: 'donut', dimension: 'status', agg: 'count', color: 4 },
    { ...base, id: 'bar-overdue-by-priority', title: t('punch.insights.c_overdue_by_priority', { defaultValue: 'Overdue by priority' }), chart: 'bar', dimension: 'priority', measure: 'overdue', agg: 'sum', color: 1 },
    { ...base, id: 'area-over-time', title: t('punch.insights.c_over_time', { defaultValue: 'Items raised over time' }), chart: 'area', dimension: 'month', agg: 'count', color: 5 },
  ];

  return { datasets: [dataset], builtins };
}
