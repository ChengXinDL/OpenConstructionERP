// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * API helpers for the Formwork module.
 *
 * Formwork is the temporary mould concrete is cast into. It is bought or hired
 * once and used many times, so its rate has two parts and only one of them
 * amortises:
 *
 *   - the panel cost (`unit_rate`), divided by how many times the set is reused
 *   - the erect-and-strike labour (`erect_strike_rate`), paid on EVERY use
 *
 * Pricing only the first is the classic way to under-price a concrete-heavy
 * job, so both ride on every catalogue row and both are reported back on every
 * assignment.
 *
 * Backed by /api/v1/formwork/ - see backend/app/modules/formwork.
 *
 * Money, quantity and percentage values ride as Decimal-as-string in JSON so
 * large totals round-trip without binary-float drift. Every such field below is
 * typed `string`; parse to a number only for display formatting, never for
 * arithmetic that feeds a bill of quantities.
 */

import { apiGet, apiPost, apiPatch, apiDelete } from '@/shared/lib/api';

const BASE = '/v1/formwork';

/* ── Domain types ──────────────────────────────────────────────────────── */

/** What the system forms. Matches the backend's SYSTEM_TYPES pattern. */
export type FormworkSystemType =
  | 'wall'
  | 'slab'
  | 'column'
  | 'beam'
  | 'foundation'
  | 'climbing'
  | 'custom';

/** What the panels are made of. Matches the backend's MATERIALS pattern. */
export type FormworkMaterial =
  | 'plywood'
  | 'steel'
  | 'aluminium'
  | 'composite'
  | 'timber'
  | 'other';

/** One catalogue row: a physical formwork system with its rate drivers. */
export interface FormworkSystem {
  id: string;
  name: string;
  system_type: FormworkSystemType;
  supplier: string | null;
  material: FormworkMaterial;
  /** Manufacturer reuse limit - how many casts the panels survive. */
  reuses_max: number;
  /** Panel acquisition or hire cost per m2 of panel. Amortises. */
  unit_rate: string;
  /** Labour + consumables per m2 formed, per use. Does NOT amortise. */
  erect_strike_rate: string;
  /** Minimum days from pour to strike. Sets the floor on the pour cycle. */
  strip_time_days: number;
  currency: string;
  notes: string | null;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A priced formwork assignment on one project. */
export interface FormworkAssignment {
  id: string;
  project_id: string;
  boq_position_id: string | null;
  formwork_system_id: string;
  area_m2: string;
  reuse_count: number;
  waste_pct: string;
  /** material + labour, per m2 formed. */
  computed_unit_cost: string;
  /** The amortising half of the unit cost. */
  material_unit_cost: string;
  /** The per-use half of the unit cost. */
  labour_unit_cost: string;
  computed_total: string;
  notes: string | null;
  tenant_id: string | null;
  created_at: string;
  updated_at: string;
}

/** An assignment plus the catalogue facts needed to read its rate. */
export interface FormworkAssignmentDetail extends FormworkAssignment {
  system_name: string;
  system_type: FormworkSystemType | '';
  material: FormworkMaterial | '';
  supplier: string | null;
  reuses_max: number;
  system_unit_rate: string;
  erect_strike_rate: string;
  strip_time_days: number;
  currency: string;
  schedule_line_count: number;
}

/** One pour of the cycle under an assignment. */
export interface FormworkScheduleLine {
  id: string;
  project_id: string;
  assignment_id: string;
  pour_no: number;
  pour_date: string | null;
  level_label: string;
  area_m2: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Two consecutive pours one panel set cannot physically serve. */
export interface FormworkCycleConflict {
  from_pour_no: number;
  to_pour_no: number;
  gap_days: number;
  required_days: number;
}

/** What the pour schedule says about an assignment's reuse economics. */
export interface FormworkCycleAnalysis {
  assignment_id: string;
  pour_count: number;
  total_pour_area_m2: string;
  /** The largest single pour - the panel set that must be bought or hired. */
  peak_pour_area_m2: string;
  reuse_ratio: string;
  /** Floor of the ratio: the turnaround the programme actually delivers. */
  derived_reuse_count: number;
  current_reuse_count: number;
  current_area_m2: string;
  reuses_max: number;
  strip_time_days: number;
  min_gap_days: number | null;
  conflicts: FormworkCycleConflict[];
  dated_pour_count: number;
  in_sync: boolean;
}

export interface FormworkDeriveResult {
  assignment: FormworkAssignment;
  analysis: FormworkCycleAnalysis;
  changed: boolean;
}

/** How many assignments a catalogue change actually moved. */
export interface FormworkRepriceResult {
  examined: number;
  repriced: number;
  unchanged: number;
  delta_total: string;
}

export interface FormworkSystemUpdateResult {
  system: FormworkSystem;
  reprice: FormworkRepriceResult;
}

export interface FormworkSystemUsage {
  system_id: string;
  assignment_count: number;
  project_count: number;
  total_area_m2: string;
  total_cost: string;
}

export interface FormworkSystemSeedResult {
  inserted: number;
  skipped: number;
  total_after: number;
}

/** One `system_type` bucket of a project's formwork spend. */
export interface FormworkTypeBreakdown {
  system_type: string;
  assignment_count: number;
  area_m2: string;
  total: string;
  share_pct: string;
}

/** The project's formwork numbers, with the reuse saving made explicit. */
export interface FormworkProjectSummary {
  project_id: string;
  assignment_count: number;
  system_count: number;
  total_area_m2: string;
  total_cost: string;
  material_cost: string;
  labour_cost: string;
  average_unit_cost: string;
  /** The same areas priced as if every pour needed brand-new panels. */
  single_use_total: string;
  amortisation_saving: string;
  amortisation_saving_pct: string;
  unlinked_to_boq: number;
  currency: string;
  currency_mixed: boolean;
  by_system_type: FormworkTypeBreakdown[];
}

/** One failing validation rule, ready for the UI. */
export interface FormworkFinding {
  rule_id: string;
  severity: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  key: string;
  element_ref: string | null;
  suggestion: string | null;
  context: Record<string, unknown>;
}

export interface FormworkValidationReport {
  target_type: string;
  target_id: string | null;
  status: string;
  error_count: number;
  warning_count: number;
  info_count: number;
  passed_count: number;
  findings: FormworkFinding[];
  /** Non-empty means validation did NOT run - not the same as passing. */
  unsupported_rule_sets: string[];
}

/* ── Request payloads ──────────────────────────────────────────────────── */

export interface FormworkSystemCreatePayload {
  name: string;
  system_type: FormworkSystemType;
  supplier?: string | null;
  material: FormworkMaterial;
  reuses_max: number;
  unit_rate: string;
  erect_strike_rate: string;
  strip_time_days: number;
  currency: string;
  notes?: string | null;
}

export type FormworkSystemUpdatePayload = Partial<FormworkSystemCreatePayload>;

export interface FormworkAssignmentCreatePayload {
  project_id: string;
  boq_position_id?: string | null;
  formwork_system_id: string;
  area_m2: string;
  reuse_count: number;
  waste_pct: string;
  notes?: string | null;
}

export type FormworkAssignmentUpdatePayload = Partial<
  Omit<FormworkAssignmentCreatePayload, 'project_id'>
>;

export interface FormworkScheduleLinePayload {
  pour_no: number;
  pour_date?: string | null;
  level_label: string;
  area_m2: string;
  notes?: string | null;
}

/* ── Catalogue ─────────────────────────────────────────────────────────── */

export interface ListSystemsParams {
  system_type?: string;
  material?: string;
  supplier?: string;
  offset?: number;
  limit?: number;
}

export async function listSystems(params: ListSystemsParams = {}): Promise<FormworkSystem[]> {
  const query = new URLSearchParams();
  if (params.system_type) query.set('system_type', params.system_type);
  if (params.material) query.set('material', params.material);
  if (params.supplier) query.set('supplier', params.supplier);
  if (params.offset != null) query.set('offset', String(params.offset));
  if (params.limit != null) query.set('limit', String(params.limit));
  const qs = query.toString();
  return apiGet<FormworkSystem[]>(`${BASE}/systems/${qs ? `?${qs}` : ''}`);
}

export async function getSystem(systemId: string): Promise<FormworkSystem> {
  return apiGet<FormworkSystem>(`${BASE}/systems/${systemId}`);
}

export async function createSystem(
  payload: FormworkSystemCreatePayload,
): Promise<FormworkSystem> {
  return apiPost<FormworkSystem, FormworkSystemCreatePayload>(`${BASE}/systems/`, payload);
}

/**
 * Patch a catalogue system.
 *
 * The result carries the re-pricing counts because the edit is not local: a
 * rate change moves the formwork total on every project that picked this
 * system, and the UI has to be able to say so.
 */
export async function updateSystem(
  systemId: string,
  payload: FormworkSystemUpdatePayload,
): Promise<FormworkSystemUpdateResult> {
  return apiPatch<FormworkSystemUpdateResult, FormworkSystemUpdatePayload>(
    `${BASE}/systems/${systemId}`,
    payload,
  );
}

export async function deleteSystem(systemId: string): Promise<void> {
  await apiDelete(`${BASE}/systems/${systemId}`);
}

export async function getSystemUsage(systemId: string): Promise<FormworkSystemUsage> {
  return apiGet<FormworkSystemUsage>(`${BASE}/systems/${systemId}/usage`);
}

/** Recompute every assignment priced off one system. Idempotent. */
export async function repriceSystem(systemId: string): Promise<FormworkRepriceResult> {
  return apiPost<FormworkRepriceResult, Record<string, never>>(
    `${BASE}/systems/${systemId}/reprice`,
    {},
  );
}

export async function seedDefaultSystems(): Promise<FormworkSystemSeedResult> {
  return apiPost<FormworkSystemSeedResult, Record<string, never>>(
    `${BASE}/systems/seed-defaults`,
    {},
  );
}

/* ── Assignments ───────────────────────────────────────────────────────── */

export async function listAssignments(projectId: string): Promise<FormworkAssignmentDetail[]> {
  return apiGet<FormworkAssignmentDetail[]>(
    `${BASE}/assignments/?project_id=${encodeURIComponent(projectId)}`,
  );
}

export async function createAssignment(
  payload: FormworkAssignmentCreatePayload,
): Promise<FormworkAssignment> {
  return apiPost<FormworkAssignment, FormworkAssignmentCreatePayload>(
    `${BASE}/assignments/`,
    payload,
  );
}

export async function updateAssignment(
  assignmentId: string,
  payload: FormworkAssignmentUpdatePayload,
): Promise<FormworkAssignment> {
  return apiPatch<FormworkAssignment, FormworkAssignmentUpdatePayload>(
    `${BASE}/assignments/${assignmentId}`,
    payload,
  );
}

export async function deleteAssignment(assignmentId: string): Promise<void> {
  await apiDelete(`${BASE}/assignments/${assignmentId}`);
}

export async function getCycle(assignmentId: string): Promise<FormworkCycleAnalysis> {
  return apiGet<FormworkCycleAnalysis>(`${BASE}/assignments/${assignmentId}/cycle`);
}

/** Replace the typed area and reuse count with the ones the cycle delivers. */
export async function deriveFromSchedule(
  assignmentId: string,
): Promise<FormworkDeriveResult> {
  return apiPost<FormworkDeriveResult, Record<string, never>>(
    `${BASE}/assignments/${assignmentId}/derive-from-schedule`,
    {},
  );
}

export async function validateAssignment(
  assignmentId: string,
  locale = '',
): Promise<FormworkValidationReport> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : '';
  return apiPost<FormworkValidationReport, Record<string, never>>(
    `${BASE}/assignments/${assignmentId}/validate${qs}`,
    {},
  );
}

/* ── Pour cycle ────────────────────────────────────────────────────────── */

export async function listScheduleLines(
  assignmentId: string,
): Promise<FormworkScheduleLine[]> {
  return apiGet<FormworkScheduleLine[]>(`${BASE}/assignments/${assignmentId}/schedule-lines/`);
}

export async function addScheduleLine(
  assignmentId: string,
  payload: FormworkScheduleLinePayload,
): Promise<FormworkScheduleLine> {
  return apiPost<FormworkScheduleLine, FormworkScheduleLinePayload>(
    `${BASE}/assignments/${assignmentId}/schedule-lines/`,
    payload,
  );
}

export async function updateScheduleLine(
  lineId: string,
  payload: Partial<FormworkScheduleLinePayload>,
): Promise<FormworkScheduleLine> {
  return apiPatch<FormworkScheduleLine, Partial<FormworkScheduleLinePayload>>(
    `${BASE}/schedule-lines/${lineId}`,
    payload,
  );
}

export async function deleteScheduleLine(lineId: string): Promise<void> {
  await apiDelete(`${BASE}/schedule-lines/${lineId}`);
}

/* ── Project rollup ────────────────────────────────────────────────────── */

export async function getProjectSummary(projectId: string): Promise<FormworkProjectSummary> {
  return apiGet<FormworkProjectSummary>(
    `${BASE}/summary?project_id=${encodeURIComponent(projectId)}`,
  );
}

export async function validateProject(
  projectId: string,
  locale = '',
): Promise<FormworkValidationReport> {
  const query = new URLSearchParams({ project_id: projectId });
  if (locale) query.set('locale', locale);
  return apiPost<FormworkValidationReport, Record<string, never>>(
    `${BASE}/validate?${query.toString()}`,
    {},
  );
}

export async function repriceProject(projectId: string): Promise<FormworkRepriceResult> {
  return apiPost<FormworkRepriceResult, Record<string, never>>(
    `${BASE}/reprice?project_id=${encodeURIComponent(projectId)}`,
    {},
  );
}
