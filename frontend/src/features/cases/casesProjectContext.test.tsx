// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// #413 - the Cases hub read "No project selected" while the top-bar switcher
// held a project.
//
// The hub kept its own copy of "which project" in `useCasesStore`
// (localStorage `oe_cases_pin_project`). Nothing outside the hub ever wrote
// that key, so the app-wide project the header switcher sets
// (`useProjectContextStore`) was invisible here. The picker now reads the
// shared context, and selecting in it writes the same store the header does.
//
// The project is put in place through `setActiveProject` - the exact call the
// header switcher makes - and the assertions are on the rendered <select>,
// not on the store, so they cannot pass while the wiring is wrong.
//
// Run:  npx vitest run src/features/cases/casesProjectContext.test.tsx

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import React from "react";

import { useProjectContextStore } from "@/stores/useProjectContextStore";
import { CasesPage } from "./CasesPage";

const PROJECTS = [
  { id: "p-canary", name: "One Canary Square", currency: "GBP" },
  { id: "p-depot", name: "Riverside Depot", currency: "EUR" },
];

/* ── Stable `t` ────────────────────────────────────────────────────────
   The shared test setup mocks `react-i18next` with a `useTranslation()` that
   builds a fresh object - and a fresh `t` - on every call. `CasesList`'s
   `visible` memo lists `t` in its dependencies and feeds a render-time
   `setState` guard (`lastVisible !== visible`), so an unstable `t` makes the
   component re-render without end before any assertion runs. Overriding the
   mock here with one frozen instance keeps that harness detail out of the
   defect under test; the `t` behaviour itself (defaultValue + `{{var}}`
   interpolation) matches the shared setup exactly. */

vi.mock("react-i18next", () => {
  const stableT = (key: string, opts?: Record<string, unknown>) => {
    if (typeof opts === "object" && opts !== null && "defaultValue" in opts) {
      let template = opts.defaultValue as string;
      if (
        "count" in opts &&
        opts.count !== 1 &&
        typeof opts.defaultValue_other === "string"
      ) {
        template = opts.defaultValue_other;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        name in opts ? String(opts[name]) : `{{${name}}}`,
      );
    }
    return key;
  };
  const translation = {
    t: stableT,
    i18n: { language: "en", changeLanguage: vi.fn() },
  };
  return {
    useTranslation: () => translation,
    Trans: ({ children }: { children: React.ReactNode }) => children,
    initReactI18next: { type: "3rdParty", init: () => {} },
    I18nextProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

/* ── Mock @/app/i18n to prevent i18next initialization side-effects ───── */

vi.mock("@/app/i18n", () => ({
  CORE_LANGUAGES: [{ code: "en", name: "English", flag: "gb", country: "gb" }],
  EXTRA_LANGUAGES: [],
  SUPPORTED_LANGUAGES: [
    { code: "en", name: "English", flag: "gb", country: "gb" },
  ],
  getLanguageByCode: () => ({
    code: "en",
    name: "English",
    flag: "gb",
    country: "gb",
  }),
  default: {
    use: () => ({ use: () => ({ use: () => ({ init: vi.fn() }) }) }),
    t: (key: string) => key,
    language: "en",
    changeLanguage: vi.fn(),
  },
}));

/* ── Mock react-query - the hub's only fetch is the project list ───────── */

vi.mock("@tanstack/react-query", () => {
  const settled = (data: unknown) => ({
    data,
    isLoading: false,
    isError: false,
    isSuccess: true,
    error: null,
    refetch: vi.fn(),
  });
  return {
    useQuery: (opts: { queryKey?: unknown[] }) => {
      const root = String(opts?.queryKey?.[0] ?? "");
      if (root === "projects") return settled(PROJECTS);
      return { ...settled(undefined), isSuccess: false };
    },
    useMutation: () => ({
      mutate: vi.fn(),
      mutateAsync: vi.fn(),
      isPending: false,
    }),
    useQueryClient: () => ({
      invalidateQueries: vi.fn(),
      setQueryData: vi.fn(),
    }),
    QueryClient: vi.fn(),
    QueryClientProvider: ({ children }: { children: React.ReactNode }) =>
      children,
  };
});

/* ── Mock @/shared/lib/api to prevent real network calls ──────────────── */

vi.mock("@/shared/lib/api", () => ({
  API_BASE: "/api",
  getAuthToken: () => "mock-token",
  extractErrorMessageFromBody: () => null,
  getErrorMessage: (err: unknown) => String(err),
  apiGet: vi.fn().mockResolvedValue([]),
  apiPost: vi.fn().mockResolvedValue({}),
  apiPatch: vi.fn().mockResolvedValue({}),
  apiPut: vi.fn().mockResolvedValue({}),
  apiDelete: vi.fn().mockResolvedValue(undefined),
  triggerDownload: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

/* ── Helpers ──────────────────────────────────────────────────────────── */

/** Exactly what the top-bar project switcher does when a user picks one. */
function selectProjectInTopBar(id: string, name: string) {
  useProjectContextStore.getState().setActiveProject(id, name);
}

function renderCases(): HTMLSelectElement {
  const { container } = render(
    <MemoryRouter initialEntries={["/cases"]}>
      <CasesPage />
    </MemoryRouter>,
  );
  const picker = container.querySelector<HTMLSelectElement>(
    "#cases-pin-project",
  );
  if (!picker) throw new Error("Cases project picker did not render");
  return picker;
}

beforeEach(() => {
  localStorage.clear();
  useProjectContextStore.getState().clearProject();
});

/* ── Tests ────────────────────────────────────────────────────────────── */

describe("Cases project picker follows the app-wide project (#413)", () => {
  it("shows the project the top bar has selected, not 'No project selected'", () => {
    selectProjectInTopBar("p-canary", "One Canary Square");

    const picker = renderCases();

    // The defect: the picker sat on the empty option while the header showed
    // "One Canary Square".
    expect(picker.value).toBe("p-canary");
  });

  it("still reads empty when no project is selected anywhere", () => {
    const picker = renderCases();

    expect(picker.value).toBe("");
  });

  it("writes the app-wide store when a project is picked here", () => {
    const picker = renderCases();

    fireEvent.change(picker, { target: { value: "p-depot" } });

    // Same store the header switcher uses - picking here moves the whole app,
    // rather than creating a second selection that silently disagrees with
    // the top bar.
    expect(useProjectContextStore.getState().activeProjectId).toBe("p-depot");
    expect(useProjectContextStore.getState().activeProjectName).toBe(
      "Riverside Depot",
    );
  });

  it("explains the zero on 'Cases for this project' before the user clicks it", () => {
    // #414: the count beside that button is the user's own pin list, which is
    // empty until they pin something. "Cases for this project 0" next to a
    // project name reads as "this project has no cases", so the hub now says
    // what the number is as soon as a project is chosen.
    selectProjectInTopBar("p-canary", "One Canary Square");

    renderCases();

    expect(
      screen.getByText(
        "Pin a case to this project from its card, and it will show up here.",
      ),
    ).toBeInTheDocument();
  });
});
