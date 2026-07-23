// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Registry of COLLAPSED module info cards on the current page (+ which pages
 * carry a "How it works" guide button).
 *
 * When a `DismissibleInfo` card is collapsed (card click or X) it disappears
 * from the content flow. The way back is a re-open control:
 *
 *   - Founder revision 2026-07-23: the PRIMARY control is a small labelled
 *     pill rendered right next to the module's "How it works" button
 *     (`ModuleInfoButton`, hosted by `ModuleGuideButton`). This is discoverable
 *     and sits where the founder asked - "рядом с кнопкой how to".
 *   - FALLBACK: on the rare page that has an info card but NO guide button,
 *     the top app bar shows a small info icon after the module name instead,
 *     so a collapsed card is never stranded and unreachable.
 *
 * Mechanics:
 *   - Every DismissibleInfo registers itself here while collapsed (key + an
 *     `expand` callback) and unregisters when expanded or unmounted, so
 *     navigation naturally clears the registry.
 *   - Every ModuleGuideButton registers a `guideKey` while mounted, so the
 *     Header can tell whether the pill is already handling re-open on this
 *     page and suppress the top-bar fallback icon. Both the pill and the icon
 *     fire every collapsed entry's `expand` (the canon is one card per page).
 */

import { create } from 'zustand';

export interface CollapsedModuleInfo {
  /** Stable identity - the DismissibleInfo localStorage key. */
  key: string;
  /** Re-expands the owning card (persists the expanded state). */
  expand: () => void;
}

interface ModuleInfoState {
  entries: CollapsedModuleInfo[];
  register: (entry: CollapsedModuleInfo) => void;
  unregister: (key: string) => void;
  /** Expand every collapsed card on the page (re-open control click). */
  expandAll: () => void;

  /** Ids of the "How it works" guide buttons currently mounted on the page. */
  guideKeys: string[];
  registerGuide: (id: string) => void;
  unregisterGuide: (id: string) => void;
}

export const useModuleInfoStore = create<ModuleInfoState>((set, get) => ({
  entries: [],
  register: (entry) =>
    set((s) => ({
      // Replace-on-rekey keeps StrictMode double-mounts and prop updates safe.
      entries: [...s.entries.filter((e) => e.key !== entry.key), entry],
    })),
  unregister: (key) => set((s) => ({ entries: s.entries.filter((e) => e.key !== key) })),
  expandAll: () => {
    // Snapshot first: expand() flips the card to expanded, which unregisters
    // the entry and mutates the array we are iterating.
    const snapshot = [...get().entries];
    snapshot.forEach((e) => e.expand());
  },

  guideKeys: [],
  registerGuide: (id) =>
    set((s) => (s.guideKeys.includes(id) ? s : { guideKeys: [...s.guideKeys, id] })),
  unregisterGuide: (id) => set((s) => ({ guideKeys: s.guideKeys.filter((k) => k !== id) })),
}));
