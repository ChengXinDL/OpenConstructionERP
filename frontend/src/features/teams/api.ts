// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * API helpers for the Team Visibility module.
 *
 * Backed by /api/v1/teams/ - see backend/app/modules/teams.
 *
 * Two concepts, and the difference matters when reading this file:
 *
 * Teams and members
 *   Who is on the project, grouped. A membership row is what grants project
 *   access platform-wide, so every write here needs project ownership; a
 *   plain member gets 403. Reads need project access; a stranger gets 404
 *   with no way to tell "not yours" from "does not exist".
 *
 * Restrictions
 *   Which records are narrowed to which teams. A record with no restriction
 *   is open to everyone on the project; a record with one or more is open to
 *   the named teams, plus the project owner and system admins. A restriction
 *   can only ever take a record away from someone, never hand one out, so no
 *   team assignment can widen what a user reaches.
 */

import { apiGet, apiPost, apiPatch, apiPut, apiDelete } from '@/shared/lib/api';

const BASE = '/v1/teams';

/* ── Domain types ──────────────────────────────────────────────────────── */

/** Team roles, split by who may assign them. Mirrors backend schemas.py. */
export const BASIC_TEAM_ROLES = ['member', 'lead', 'estimator', 'viewer'] as const;
export const ELEVATED_TEAM_ROLES = ['owner', 'project_manager'] as const;
export const ALL_TEAM_ROLES = [...BASIC_TEAM_ROLES, ...ELEVATED_TEAM_ROLES] as const;
export type TeamRole = (typeof ALL_TEAM_ROLES)[number];

/** Which party a team represents. Descriptive only - carries no permission. */
export const TEAM_KINDS = [
  'internal',
  'client',
  'subcontractor',
  'consultant',
  'supplier',
  'authority',
] as const;
export type TeamKind = (typeof TEAM_KINDS)[number];

export interface TeamMembership {
  id: string;
  team_id: string;
  user_id: string;
  role: string;
  /** Empty on the paths that do not join to the user row. */
  email: string;
  full_name: string;
  /** False for a deactivated user, and for a membership whose user row is gone. */
  is_active: boolean;
  created_at: string;
}

export interface Team {
  id: string;
  project_id: string;
  name: string;
  name_translations: Record<string, string> | null;
  description: string;
  kind: TeamKind;
  sort_order: number;
  is_default: boolean;
  is_active: boolean;
  metadata: Record<string, unknown>;
  memberships: TeamMembership[];
  member_count: number;
  /** null when the caller asked for a shape that does not count restrictions. */
  restricted_record_count: number | null;
  created_at: string;
  updated_at: string;
}

/** One record kind that can carry a restriction. */
export interface VisibilityEntityType {
  key: string;
  label: string;
  module: string;
  /**
   * Whether the owning module actually subtracts restricted ids on read yet.
   * False means the restriction is recorded but not enforced - the UI has to
   * say so rather than imply a lock that is not wired.
   */
  enforced: boolean;
}

export interface VisibilityTeamRef {
  team_id: string;
  name: string;
  kind: TeamKind;
  is_active: boolean;
  member_count: number;
}

export interface EntityVisibilityState {
  entity_type: string;
  entity_id: string;
  project_id: string;
  /** False means the record follows plain project access. */
  restricted: boolean;
  teams: VisibilityTeamRef[];
  /** Distinct people reachable through the named teams. Excludes owner/admins. */
  viewer_count: number;
  enforced: boolean;
  /** Whether the caller themselves still reaches the record. */
  caller_can_see: boolean;
}

export interface RestrictedEntityRow {
  entity_type: string;
  entity_id: string;
  team_ids: string[];
  team_names: string[];
  viewer_count: number;
  enforced: boolean;
}

export interface EntityVisibilityRow {
  id: string;
  entity_type: string;
  entity_id: string;
  team_id: string;
  created_at: string;
}

export interface AccessMatrixMember {
  user_id: string;
  email: string;
  full_name: string;
  is_project_owner: boolean;
  is_system_admin: boolean;
  team_ids: string[];
  team_names: string[];
  roles: string[];
  visible_restricted_count: number;
  hidden_restricted_count: number;
}

export interface AccessMatrix {
  project_id: string;
  restricted_record_count: number;
  members: AccessMatrixMember[];
}

export interface TeamsValidationFinding {
  rule_id: string;
  /** Stable i18n key; the English `message` is the fallback. */
  key: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  element_ref: string | null;
  suggestion: string | null;
  context: Record<string, unknown>;
}

export interface TeamsValidationReport {
  project_id: string;
  status: string;
  /** null when nothing was checked - never render that as a clean pass. */
  score: number | null;
  error_count: number;
  warning_count: number;
  findings: TeamsValidationFinding[];
}

/* ── Teams ─────────────────────────────────────────────────────────────── */

export async function listTeams(
  projectId: string,
  opts: { includeInactive?: boolean } = {},
): Promise<Team[]> {
  const qs = new URLSearchParams();
  if (opts.includeInactive) qs.set('include_inactive', 'true');
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiGet<Team[]>(`${BASE}/project/${projectId}${suffix}`);
}

export interface CreateTeamPayload {
  project_id: string;
  name: string;
  description?: string;
  kind?: TeamKind;
  sort_order?: number;
  is_default?: boolean;
}

export async function createTeam(payload: CreateTeamPayload): Promise<Team> {
  return apiPost<Team, CreateTeamPayload>(`${BASE}/`, payload);
}

export interface UpdateTeamPayload {
  name?: string;
  description?: string;
  kind?: TeamKind;
  sort_order?: number;
  is_default?: boolean;
  is_active?: boolean;
}

export async function updateTeam(teamId: string, payload: UpdateTeamPayload): Promise<Team> {
  return apiPatch<Team, UpdateTeamPayload>(`${BASE}/${teamId}`, payload);
}

export async function deleteTeam(teamId: string): Promise<void> {
  await apiDelete(`${BASE}/${teamId}`);
}

/* ── Members ───────────────────────────────────────────────────────────── */

export async function listMembers(teamId: string): Promise<TeamMembership[]> {
  return apiGet<TeamMembership[]>(`${BASE}/${teamId}/members`);
}

export async function addMember(
  teamId: string,
  payload: { user_id: string; role: TeamRole },
): Promise<TeamMembership> {
  return apiPost<TeamMembership, typeof payload>(`${BASE}/${teamId}/members`, payload);
}

export async function updateMemberRole(
  teamId: string,
  userId: string,
  role: TeamRole,
): Promise<TeamMembership> {
  return apiPatch<TeamMembership, { role: TeamRole }>(`${BASE}/${teamId}/members/${userId}`, {
    role,
  });
}

export async function removeMember(teamId: string, userId: string): Promise<void> {
  await apiDelete(`${BASE}/${teamId}/members/${userId}`);
}

/* ── Restrictions ──────────────────────────────────────────────────────── */

export async function listEntityTypes(): Promise<VisibilityEntityType[]> {
  return apiGet<VisibilityEntityType[]>(`${BASE}/entity-types`);
}

export async function listTeamVisibility(teamId: string): Promise<EntityVisibilityRow[]> {
  return apiGet<EntityVisibilityRow[]>(`${BASE}/${teamId}/visibility`);
}

export async function describeEntityVisibility(
  projectId: string,
  entityType: string,
  entityId: string,
): Promise<EntityVisibilityState> {
  return apiGet<EntityVisibilityState>(
    `${BASE}/project/${projectId}/visibility/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
  );
}

/**
 * Replace the whole set of teams a record is restricted to.
 *
 * An empty `teamIds` lifts the restriction and returns the record to every
 * project member - the widest state reachable, and still narrower than the
 * project itself.
 */
export async function setEntityVisibility(
  projectId: string,
  entityType: string,
  entityId: string,
  teamIds: string[],
): Promise<EntityVisibilityState> {
  return apiPut<EntityVisibilityState, { team_ids: string[] }>(
    `${BASE}/project/${projectId}/visibility/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    { team_ids: teamIds },
  );
}

export async function listRestrictedEntities(
  projectId: string,
  entityType?: string,
): Promise<RestrictedEntityRow[]> {
  const qs = entityType ? `?entity_type=${encodeURIComponent(entityType)}` : '';
  return apiGet<RestrictedEntityRow[]>(`${BASE}/project/${projectId}/restricted${qs}`);
}

export async function getAccessMatrix(projectId: string): Promise<AccessMatrix> {
  return apiGet<AccessMatrix>(`${BASE}/project/${projectId}/access-matrix`);
}

export async function validateProjectTeams(projectId: string): Promise<TeamsValidationReport> {
  return apiGet<TeamsValidationReport>(`${BASE}/project/${projectId}/validate`);
}
