// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Meetings register's contribution to the Module Insights panel: it turns the
 * meetings the page already loaded into one dataset plus a set of built-in
 * KPIs and charts (meetings by status and type, action items by meeting type,
 * and how many meetings are held over time). When a project has no meetings
 * yet, a clearly labelled sample set stands in so the panel still shows what
 * it can do; the panel marks it "Sample data" so it is never mistaken for the
 * real thing.
 *
 * Value labels reuse the same `meetings.status_*` / `meetings.type_*` i18n
 * keys the register uses, so a slice in a chart reads exactly like the badge
 * on the row it came from. These are count / status insights: a meeting
 * carries no money field, so every measure is a plain number (a headcount, an
 * action-item count or a 0/1 flag) and there is no currency KPI.
 */
import { useTranslation } from 'react-i18next';
import type { InsightDataset, InsightDef } from '@/features/insights';

type Translate = ReturnType<typeof useTranslation>['t'];

// Minimal shape this builder needs from a meeting. The page hands it the full
// Meeting[] (structurally a superset of this), so no mapping is needed at the
// call site.
interface MeetingLite {
  title: string;
  meeting_type: string;
  status: string;
  date: string;
  attendees?: unknown[];
  action_items?: Array<{ completed?: boolean }>;
}

const DONE_STATUS = 'completed';

/** Sortable YYYY-MM key so the time series stays chronological. */
function monthKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Title-case a snake_case code as a readable fallback (in_progress -> In
 *  Progress); the real translation wins when present. */
function humanize(code: string): string {
  return code
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function typeLabel(code: string, t: Translate): string {
  return t(`meetings.type_${code}`, { defaultValue: humanize(code) });
}

function statusLabel(code: string, t: Translate): string {
  return t(`meetings.status_${code}`, { defaultValue: humanize(code) });
}

interface Row {
  // Index signature so a Row is directly a valid InsightDataset row (a plain
  // record of string/number cells) with no cast.
  [key: string]: string | number;
  title: string;
  type: string;
  status: string;
  month: string;
  attendees: number;
  actions: number;
  open_actions: number;
  done: number;
}

function toRow(r: MeetingLite, t: Translate): Row {
  const items = r.action_items ?? [];
  const openActions = items.filter((a) => !a?.completed).length;
  return {
    title: r.title ?? '',
    type: typeLabel(r.meeting_type, t),
    status: statusLabel(r.status, t),
    month: monthKey(r.date),
    attendees: r.attendees?.length ?? 0,
    actions: items.length,
    open_actions: openActions,
    done: r.status === DONE_STATUS ? 1 : 0,
  };
}

// Illustrative meetings for an empty project - realistic construction meetings
// with a spread of types, statuses, months, attendee counts and action items
// (some still open) so every built-in chart has something to draw.
const SAMPLE: Array<{
  title: string;
  meeting_type: string;
  status: string;
  month: string;
  attendees: number;
  actions: number;
  done_actions: number;
}> = [
  { title: 'Weekly progress meeting #11', meeting_type: 'progress', status: 'completed', month: '2026-02', attendees: 8, actions: 6, done_actions: 5 },
  { title: 'Design coordination - MEP clashes', meeting_type: 'design', status: 'completed', month: '2026-02', attendees: 6, actions: 5, done_actions: 3 },
  { title: 'Safety stand-down after near miss', meeting_type: 'safety', status: 'completed', month: '2026-03', attendees: 14, actions: 4, done_actions: 4 },
  { title: 'Subcontractor coordination - facade', meeting_type: 'subcontractor', status: 'in_progress', month: '2026-03', attendees: 7, actions: 3, done_actions: 1 },
  { title: 'Project kickoff - fit-out package', meeting_type: 'kickoff', status: 'completed', month: '2026-04', attendees: 10, actions: 7, done_actions: 4 },
  { title: 'Weekly progress meeting #12', meeting_type: 'progress', status: 'scheduled', month: '2026-05', attendees: 8, actions: 0, done_actions: 0 },
  { title: 'Design review - core walls', meeting_type: 'design', status: 'cancelled', month: '2026-05', attendees: 0, actions: 0, done_actions: 0 },
  { title: 'Closeout and handover walkthrough', meeting_type: 'closeout', status: 'scheduled', month: '2026-06', attendees: 5, actions: 2, done_actions: 0 },
];

export interface MeetingsInsights {
  datasets: InsightDataset[];
  builtins: InsightDef[];
}

export function buildMeetingsInsights(
  meetings: MeetingLite[],
  currency: string,
  t: Translate,
): MeetingsInsights {
  const real = meetings.length > 0;

  const rows: Row[] = real
    ? [...meetings]
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map((r) => toRow(r, t))
    : SAMPLE.map((s) =>
        toRow(
          {
            title: s.title,
            meeting_type: s.meeting_type,
            status: s.status,
            date: `${s.month}-15`,
            attendees: new Array(s.attendees).fill(null),
            action_items: Array.from({ length: s.actions }, (_, i) => ({
              completed: i < s.done_actions,
            })),
          },
          t,
        ),
    );

  const dataset: InsightDataset = {
    id: 'meetings',
    label: t('meetings.insights.ds_meetings', { defaultValue: 'Meeting register' }),
    currency: currency || '',
    sample: !real,
    fields: [
      { key: 'title', label: t('meetings.insights.f_title', { defaultValue: 'Meeting' }), kind: 'dimension' },
      { key: 'type', label: t('meetings.insights.f_type', { defaultValue: 'Type' }), kind: 'dimension' },
      { key: 'status', label: t('meetings.insights.f_status', { defaultValue: 'Status' }), kind: 'dimension' },
      { key: 'month', label: t('meetings.insights.f_month', { defaultValue: 'Month held' }), kind: 'dimension' },
      { key: 'attendees', label: t('meetings.insights.f_attendees', { defaultValue: 'Attendees' }), kind: 'measure', format: 'number' },
      { key: 'actions', label: t('meetings.insights.f_actions', { defaultValue: 'Action items' }), kind: 'measure', format: 'number' },
      { key: 'open_actions', label: t('meetings.insights.f_open_actions', { defaultValue: 'Open action items' }), kind: 'measure', format: 'number' },
      { key: 'done', label: t('meetings.insights.f_done', { defaultValue: 'Completed' }), kind: 'measure', format: 'number' },
    ],
    rows,
  };

  const base = { datasetId: 'meetings', builtin: true } as const;
  const builtins: InsightDef[] = [
    { ...base, id: 'kpi-meetings', title: t('meetings.insights.k_meetings', { defaultValue: 'Meetings' }), chart: 'kpi', agg: 'count', color: 0 },
    { ...base, id: 'kpi-completed', title: t('meetings.insights.k_completed', { defaultValue: 'Completed' }), chart: 'kpi', measure: 'done', agg: 'sum', color: 3 },
    { ...base, id: 'kpi-open-actions', title: t('meetings.insights.k_open_actions', { defaultValue: 'Open action items' }), chart: 'kpi', measure: 'open_actions', agg: 'sum', color: 1 },
    { ...base, id: 'kpi-avg-attendees', title: t('meetings.insights.k_avg_attendees', { defaultValue: 'Avg attendees' }), chart: 'kpi', measure: 'attendees', agg: 'avg', color: 4 },
    { ...base, id: 'donut-by-status', title: t('meetings.insights.c_by_status', { defaultValue: 'Meetings by status' }), chart: 'donut', dimension: 'status', agg: 'count', color: 4 },
    { ...base, id: 'bar-by-type', title: t('meetings.insights.c_by_type', { defaultValue: 'Meetings by type' }), chart: 'bar', dimension: 'type', agg: 'count', color: 0 },
    { ...base, id: 'bar-actions-by-type', title: t('meetings.insights.c_actions_by_type', { defaultValue: 'Action items by meeting type' }), chart: 'bar', dimension: 'type', measure: 'actions', agg: 'sum', color: 1 },
    { ...base, id: 'area-over-time', title: t('meetings.insights.c_over_time', { defaultValue: 'Meetings over time' }), chart: 'area', dimension: 'month', agg: 'count', color: 5 },
  ];

  return { datasets: [dataset], builtins };
}
