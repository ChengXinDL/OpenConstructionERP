// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Cases - progress store.
//
// A thin zustand store over the pure helpers in ./progress. It owns the
// per-run progress map plus the per-case sample-project selection, and persists
// both to localStorage so a half-finished case (and the project you were
// learning it on) survive reloads and a hop into a module and back. All real
// logic lives in ./progress (pure, tested); this layer only reads/writes and
// persists.
//
// It also owns two small pieces of view state for the Cases hub itself (not
// per-run progress): the "I work as..." company type the user picked, and
// which cases they pinned to which real project. Both are plain localStorage,
// no backend, same pattern as everything else in this file.

import { create } from 'zustand';
import type { CaseCategory, CompanyType, PlaybookProgress, ProfessionalRole } from './types';
import {
  clampStepIndex,
  emptyProgress,
  runKey,
  toggleStep as toggleStepProgress,
} from './progress';

const RUNS_KEY = 'oe_cases_progress';
const SELECTED_KEY = 'oe_cases_selected';
const COMPANY_TYPE_KEY = 'oe_cases_company_type';
const ROLE_KEY = 'oe_cases_role';
const PINS_KEY = 'oe_cases_pins';
const CATEGORY_KEY = 'oe_cases_categories';

// There was a sixth key here, `oe_cases_pin_project`, holding "which real
// project is the Cases hub pinning to". Nothing outside this store ever wrote
// it, so the hub read "No project selected" while the top-bar switcher held a
// project (issue #413). The hub now reads the app-wide active project from
// `useProjectContextStore`; the pin map below stays keyed by project id.

/** Stable, frozen fallback used by selectors for a run that has no progress
 *  yet. Frozen so an accidental mutation throws instead of corrupting shared
 *  state; the pure helpers never mutate, they return new objects. */
export const EMPTY_PROGRESS: PlaybookProgress = Object.freeze(emptyProgress());

type RunMap = Record<string, PlaybookProgress>;
type SelectedMap = Record<string, string>;

function readRuns(): RunMap {
  try {
    const raw = localStorage.getItem(RUNS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: RunMap = {};
    for (const [k, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = value as Partial<PlaybookProgress> | null;
      if (v && Array.isArray(v.completedStepIds)) {
        out[k] = {
          completedStepIds: v.completedStepIds.filter(
            (id): id is string => typeof id === 'string',
          ),
          currentStepIndex: typeof v.currentStepIndex === 'number' ? v.currentStepIndex : 0,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function readSelected(): SelectedMap {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: SelectedMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function persistRuns(runs: RunMap) {
  try {
    localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
  } catch {
    /* localStorage unavailable (private mode / quota) - non-fatal. */
  }
}

function persistSelected(selected: SelectedMap) {
  try {
    localStorage.setItem(SELECTED_KEY, JSON.stringify(selected));
  } catch {
    /* non-fatal */
  }
}

const VALID_COMPANY_TYPES: readonly CompanyType[] = [
  'general-contractor',
  'subcontractor',
  'cost-consultant',
  'designer',
  'developer-client',
  'project-manager',
  'bim-consultant',
  'owner-operator',
];

/** Read a persisted filter selection as a list of valid ids.
 *
 *  Both filters held a single id before they became multi-select, and that
 *  value was written bare, not as JSON. A legacy entry therefore has to be
 *  read as a one-item selection: parsing it as JSON throws, and treating the
 *  throw as "nothing selected" would silently clear the filter of everyone who
 *  had already picked something. Unknown ids are dropped rather than trusted,
 *  so a renamed id cannot filter the list down to nothing with no way back. */
function readIdList<T extends string>(key: string, valid: readonly T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const isValid = (v: unknown): v is T =>
      typeof v === 'string' && (valid as readonly string[]).includes(v);
    if (raw.startsWith('[')) {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? [...new Set(parsed.filter(isValid))] : [];
    }
    return isValid(raw) ? [raw] : [];
  } catch {
    return [];
  }
}

function persistIdList(key: string, value: readonly string[]) {
  try {
    if (value.length) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    /* non-fatal */
  }
}

/** Add or remove one id, preserving the order the user picked them in. */
function toggleId<T extends string>(list: readonly T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

const VALID_ROLES: readonly ProfessionalRole[] = [
  'estimator',
  'quantity-surveyor',
  'site-manager',
  'project-manager',
  'bim-coordinator',
  'procurement-buyer',
  'planner',
  'hse-officer',
  'design-lead',
  'document-controller',
  'commercial-manager',
  'foreman',
];

const VALID_CATEGORIES: readonly CaseCategory[] = [
  'estimating',
  'tendering',
  'planning',
  'bim',
  'site',
  'quality',
  'commercial',
  'handover',
];

/** Case ids pinned per real project id (NOT a sample-project scope like
 *  `selected` above - this is the user's own "cases I use on this job" list). */
type PinsMap = Record<string, string[]>;

function readPins(): PinsMap {
  try {
    const raw = localStorage.getItem(PINS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: PinsMap = {};
    for (const [projectId, ids] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(ids)) {
        out[projectId] = ids.filter((id): id is string => typeof id === 'string');
      }
    }
    return out;
  } catch {
    return {};
  }
}

function persistPins(pins: PinsMap) {
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    /* non-fatal */
  }
}

interface CasesState {
  /** Progress per run key (playbookId or `playbookId::projectId`). */
  runs: RunMap;
  /** Sample project chosen per playbook id (empty / absent = none). */
  selected: SelectedMap;
  /** The "I work as..." company types picked on the Cases hub (empty = show
   *  every case, no company filter applied). Persists across visits.
   *
   *  The three filter lists below follow the ordinary faceted-search rule: OR
   *  inside one list, AND between lists. Someone who is both a contractor and
   *  a consultant wants the union of the two, but adding a role to that should
   *  narrow the result, not widen it. */
  companyTypes: CompanyType[];
  /** The "Your role" professional roles picked on the Cases hub (empty = no
   *  role filter). Independent of `companyTypes`; both narrow the list. */
  roles: ProfessionalRole[];
  /** The discipline chips picked on the Cases hub (empty = every discipline).
   *  Held here rather than in the page so it survives a visit to a case and
   *  back, which is how the other two filters already behaved. */
  categories: CaseCategory[];
  /** Case ids pinned per real project id. The project the hub is pinning TO
   *  is not held here - it is the app-wide active project from
   *  `useProjectContextStore`. */
  pins: PinsMap;
  /** Toggle a step's done flag for a run. */
  toggleStepDone: (playbookId: string, projectId: string | null, stepId: string) => void;
  /** Move the runner's focus to a step index (clamped to the step count). */
  setCurrentStep: (
    playbookId: string,
    projectId: string | null,
    index: number,
    total: number,
  ) => void;
  /** Clear all progress for a run. */
  reset: (playbookId: string, projectId?: string | null) => void;
  /** Set (or clear, with '') the sample project for a playbook. */
  setSelectedProject: (playbookId: string, projectId: string) => void;
  /** Replace the whole "I work as..." filter (pass [] to clear it). */
  setCompanyTypes: (companyTypes: CompanyType[]) => void;
  /** Replace the whole "Your role" filter (pass [] to clear it). */
  setRoles: (roles: ProfessionalRole[]) => void;
  /** Replace the whole discipline filter (pass [] to clear it). */
  setCategories: (categories: CaseCategory[]) => void;
  /** Add or remove one company type from the "I work as..." filter. */
  toggleCompanyType: (companyType: CompanyType) => void;
  /** Add or remove one role from the "Your role" filter. */
  toggleRole: (role: ProfessionalRole) => void;
  /** Add or remove one discipline from the category filter. */
  toggleCategory: (category: CaseCategory) => void;
  /** Drop every company, role and discipline filter in one go. */
  clearFilters: () => void;
  /** Pin or unpin a case for a project (no-op with an empty projectId). */
  togglePin: (projectId: string, playbookId: string) => void;
  /** True when the case is pinned to the given project. */
  isPinned: (projectId: string, playbookId: string) => boolean;
}

export const useCasesStore = create<CasesState>((set, get) => ({
  runs: readRuns(),
  selected: readSelected(),
  companyTypes: readIdList(COMPANY_TYPE_KEY, VALID_COMPANY_TYPES),
  roles: readIdList(ROLE_KEY, VALID_ROLES),
  categories: readIdList(CATEGORY_KEY, VALID_CATEGORIES),
  pins: readPins(),

  toggleStepDone: (playbookId, projectId, stepId) => {
    const key = runKey(playbookId, projectId);
    const current = get().runs[key] ?? emptyProgress();
    const next = toggleStepProgress(current, stepId);
    const runs = { ...get().runs, [key]: next };
    persistRuns(runs);
    set({ runs });
  },

  setCurrentStep: (playbookId, projectId, index, total) => {
    const key = runKey(playbookId, projectId);
    const current = get().runs[key] ?? emptyProgress();
    const clamped = clampStepIndex(index, total);
    if (get().runs[key] && current.currentStepIndex === clamped) return;
    const runs = { ...get().runs, [key]: { ...current, currentStepIndex: clamped } };
    persistRuns(runs);
    set({ runs });
  },

  reset: (playbookId, projectId) => {
    const key = runKey(playbookId, projectId);
    if (!(key in get().runs)) return;
    const runs = { ...get().runs };
    delete runs[key];
    persistRuns(runs);
    set({ runs });
  },

  setSelectedProject: (playbookId, projectId) => {
    const selected = { ...get().selected };
    if (projectId) selected[playbookId] = projectId;
    else delete selected[playbookId];
    persistSelected(selected);
    set({ selected });
  },

  setCompanyTypes: (companyTypes) => {
    persistIdList(COMPANY_TYPE_KEY, companyTypes);
    set({ companyTypes });
  },

  setRoles: (roles) => {
    persistIdList(ROLE_KEY, roles);
    set({ roles });
  },

  setCategories: (categories) => {
    persistIdList(CATEGORY_KEY, categories);
    set({ categories });
  },

  toggleCompanyType: (companyType) => {
    const companyTypes = toggleId(get().companyTypes, companyType);
    persistIdList(COMPANY_TYPE_KEY, companyTypes);
    set({ companyTypes });
  },

  toggleRole: (role) => {
    const roles = toggleId(get().roles, role);
    persistIdList(ROLE_KEY, roles);
    set({ roles });
  },

  toggleCategory: (category) => {
    const categories = toggleId(get().categories, category);
    persistIdList(CATEGORY_KEY, categories);
    set({ categories });
  },

  clearFilters: () => {
    persistIdList(COMPANY_TYPE_KEY, []);
    persistIdList(ROLE_KEY, []);
    persistIdList(CATEGORY_KEY, []);
    set({ companyTypes: [], roles: [], categories: [] });
  },

  togglePin: (projectId, playbookId) => {
    if (!projectId) return;
    const current = get().pins[projectId] ?? [];
    const has = current.includes(playbookId);
    const nextForProject = has
      ? current.filter((id) => id !== playbookId)
      : [...current, playbookId];
    const pins = { ...get().pins, [projectId]: nextForProject };
    persistPins(pins);
    set({ pins });
  },

  isPinned: (projectId, playbookId) => {
    if (!projectId) return false;
    return (get().pins[projectId] ?? []).includes(playbookId);
  },
}));
