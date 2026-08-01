// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Cadence for the "rate us / leave a review" ask.
 *
 * The founder's brief is "once every 4 days". Four days is the CEILING on
 * frequency, not a schedule to run from day one, so the gate is built from
 * four independent conditions and the card only appears when all of them
 * agree.
 *
 *   1. Earned the right to ask. A construction estimator cannot judge a cost
 *      platform on first contact - they need to have imported something,
 *      priced it and come back to it. So we require BOTH a minimum age since
 *      first launch AND a minimum number of DISTINCT days the app was opened.
 *      Age alone would ask someone who installed it, walked away for a
 *      fortnight and came back once. Distinct days alone would ask someone
 *      who opened it five times in one afternoon while evaluating it. Both
 *      together describe a person who actually put the tool to work.
 *   2. At least 4 days between asks, from a stored timestamp.
 *   3. Escalating backoff on decline. Someone who said "maybe later" twice is
 *      telling us something, and repeating the same 4-day interval at them is
 *      how a prompt becomes a nag.
 *   4. A hard cap. After MAX_DECLINES it is gone for good, no exceptions.
 *
 * "Don't ask again" and actually following a review link are both terminal:
 * a person who left a review must never be asked for one again.
 *
 * Every localStorage access is wrapped. When storage is blocked (private
 * mode, hardened browser) we cannot record that we asked, so asking would
 * mean asking on EVERY load. The safe degradation is to stay silent.
 */

import { create } from 'zustand';

/* ── storage keys ─────────────────────────────────────────────────────── */

const STORAGE_KEY = 'oe_review_prompt';

/** Written by the existing Support-us modal (`app/layout/SupportUsButton.tsx`).
 *  That modal carries the SAME asks (star on GitHub, review, share on social),
 *  so if the user has just been shown it, this card must stay out of the way -
 *  otherwise one week can deliver both and the pair reads as pestering. */
const SUPPORT_MODAL_KEY = 'oe_support_seen_at';

/* ── cadence constants ────────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimum wall-clock age of the install before the first ask. Seven days
 *  covers a full working week, which is the shortest span in which someone
 *  can have run a real bill of quantities through the platform. */
const MIN_AGE_MS = 7 * DAY_MS;

/** Minimum number of distinct calendar days the app was opened. Five is a
 *  working week of genuine use and is what separates a user from an
 *  evaluator. Deliberately lower than the 7-day age window so a daily user
 *  is not held back by a weekend. */
const MIN_ACTIVE_DAYS = 5;

/** The floor: never less than four days between asks. */
const BASE_INTERVAL_MS = 4 * DAY_MS;

/** The ceiling, and the conservative fallback for an out-of-range index. */
const MAX_BACKOFF_MS = 45 * DAY_MS;

/** Delay before the next ask, indexed by how many times the user has
 *  declined. Index 0 is the "shown but never answered" case (the card was
 *  displayed and the user simply navigated away), which earns the plain
 *  4-day floor. A decline then escalates: 4 days, 14 days, 45 days. */
const DECLINE_BACKOFF_MS = [
  BASE_INTERVAL_MS,
  BASE_INTERVAL_MS,
  14 * DAY_MS,
  MAX_BACKOFF_MS,
];

/** Backoff for a given decline count, with the index clamped into range.
 *  `noUncheckedIndexedAccess` is on in this project, so a variable index
 *  widens to `number | undefined` even though `clamped` is provably valid;
 *  the fallback is the LONGEST interval, so a hypothetical miss can only
 *  ever make us quieter, never pushier. */
function backoffFor(declineCount: number): number {
  const clamped = Math.min(Math.max(declineCount, 0), DECLINE_BACKOFF_MS.length - 1);
  return DECLINE_BACKOFF_MS[clamped] ?? MAX_BACKOFF_MS;
}

/** Hard cap. After the fourth decline the card never appears again, so the
 *  worst case a user can ever experience is four asks spread over ~9 weeks. */
const MAX_DECLINES = 4;

/** Quiet period after the Support-us modal has been seen. Matches the base
 *  interval so the two surfaces cannot land in the same 4-day window. */
const SUPPORT_MODAL_QUIET_MS = 4 * DAY_MS;

/** Bound on the stored day list. We only ever compare its LENGTH against
 *  MIN_ACTIVE_DAYS, so there is no reason to keep more than the cap plus a
 *  little headroom in localStorage. */
const MAX_TRACKED_DAYS = 30;

/* ── state ────────────────────────────────────────────────────────────── */

export interface ReviewPromptState {
  /** First time the app was ever opened by this browser, ms epoch. */
  firstSeenAt: number | null;
  /** Distinct local calendar days the app was opened, as YYYY-MM-DD. */
  activeDays: string[];
  /** When the card was last shown, ms epoch. */
  lastAskedAt: number | null;
  /** How many times the user chose "maybe later" (or dismissed the card). */
  declineCount: number;
  /** `stopped` is terminal: opted out, or already left a review. */
  status: 'active' | 'stopped';
}

export const EMPTY_STATE: ReviewPromptState = {
  firstSeenAt: null,
  activeDays: [],
  lastAskedAt: null,
  declineCount: 0,
  status: 'active',
};

/** Local (not UTC) calendar day - "distinct days I opened it" is a claim
 *  about the user's own days, and a UTC key would split an evening session
 *  in Asia across two entries. */
export function dayKey(now: number): string {
  const d = new Date(now);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/* ── persistence (every access guarded) ───────────────────────────────── */

function readState(): ReviewPromptState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_STATE };
    const parsed = JSON.parse(raw) as Partial<ReviewPromptState>;
    return {
      firstSeenAt:
        typeof parsed.firstSeenAt === 'number' && Number.isFinite(parsed.firstSeenAt)
          ? parsed.firstSeenAt
          : null,
      activeDays: Array.isArray(parsed.activeDays)
        ? parsed.activeDays.filter((d): d is string => typeof d === 'string')
        : [],
      lastAskedAt:
        typeof parsed.lastAskedAt === 'number' && Number.isFinite(parsed.lastAskedAt)
          ? parsed.lastAskedAt
          : null,
      declineCount:
        typeof parsed.declineCount === 'number' && Number.isFinite(parsed.declineCount)
          ? parsed.declineCount
          : 0,
      status: parsed.status === 'stopped' ? 'stopped' : 'active',
    };
  } catch {
    // Storage blocked, or a corrupt/hand-edited value. Either way we fall
    // back to a blank state, which cannot satisfy the age gate, so nothing
    // is shown. Failing closed is the point.
    return { ...EMPTY_STATE };
  }
}

function writeState(state: ReviewPromptState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode - the card simply never becomes eligible */
  }
}

export function readSupportModalSeenAt(): number | null {
  try {
    const raw = localStorage.getItem(SUPPORT_MODAL_KEY);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * Shared quiet period between the two "support us" surfaces: this card and
 * the Support-us modal in `app/layout/SupportUsButton.tsx`. One constant
 * drives both directions, so the rule reads the same from either side.
 *
 * Deliberately SHORT (4 days, the card's own floor). The goal is that a
 * person never meets both asks inside one short window - it is NOT that
 * either surface gets to mute the other. A long window here would be a slow
 * way of deleting the modal.
 */
export const CROSS_SURFACE_QUIET_MS = BASE_INTERVAL_MS;

/**
 * True when the review card was last SHOWN within `withinMs`.
 *
 * Read by the Support-us modal to hold back its unprompted auto-popup. It
 * deliberately reads persisted storage rather than the Zustand store: the
 * modal lives in a different part of the tree and must not subscribe to this
 * store just to answer one question, and storage is the value that survives
 * a reload anyway.
 *
 * WHY THIS CANNOT BECOME A PERMANENT MUTE - and what would break that.
 * `lastAskedAt` only advances while the card is still allowed to appear, and
 * the card is hard-capped at MAX_DECLINES appearances for the lifetime of the
 * install. So the total time this predicate can ever return true is bounded
 * by MAX_DECLINES * CROSS_SURFACE_QUIET_MS - about 16 days, once, spread over
 * the ~10 weeks the card is active. After the cap the card never shows again,
 * `lastAskedAt` freezes, and this returns false forever.
 *
 * That bound is the whole safety argument, and it rests on the cap. If
 * MAX_DECLINES is ever removed or made effectively unlimited, a card on its
 * 4-day rhythm would re-arm this window before it expired and the modal's
 * auto-popup would be suppressed indefinitely. Anyone loosening the cap must
 * revisit this function. `useReviewPromptStore.test.ts` pins the bound.
 */
export function reviewAskShownWithin(withinMs: number, now: number = Date.now()): boolean {
  const { lastAskedAt } = readState();
  if (lastAskedAt === null) return false;
  return now - lastAskedAt < withinMs;
}

/* ── the rule, as a pure function ─────────────────────────────────────── */

/**
 * Decide whether the review card may be shown right now.
 *
 * Pure on purpose: `now` and the support-modal timestamp are injected so the
 * cadence can be table-tested across months of simulated time without fake
 * clocks or a rendered component.
 */
export function shouldShowReviewAsk(
  state: ReviewPromptState,
  now: number,
  supportSeenAt: number | null = null,
): boolean {
  // Terminal states first - these outrank every other consideration.
  if (state.status === 'stopped') return false;
  if (state.declineCount >= MAX_DECLINES) return false;

  // Never recorded a first launch (fresh user, or storage is unavailable).
  if (state.firstSeenAt === null) return false;

  // Earned-the-right gate: age AND distinct days, both required.
  if (now - state.firstSeenAt < MIN_AGE_MS) return false;
  if (state.activeDays.length < MIN_ACTIVE_DAYS) return false;

  // Don't stack on top of the Support-us modal, which makes the same asks.
  if (supportSeenAt !== null && now - supportSeenAt < SUPPORT_MODAL_QUIET_MS) return false;

  // First eligible ask - thresholds are met and we have never asked.
  if (state.lastAskedAt === null) return true;

  // Otherwise respect the interval for the current decline level.
  return now - state.lastAskedAt >= backoffFor(state.declineCount);
}

/* ── store ────────────────────────────────────────────────────────────── */

interface ReviewPromptStore {
  state: ReviewPromptState;
  visible: boolean;
  /** Unconditional: records that the app was opened today and seeds the
   *  first-launch stamp. MUST run from the app shell, not from the card,
   *  or the day counter would only advance on days the card rendered and
   *  could never reach its own threshold. */
  recordActiveDay: () => void;
  /** Re-run the gate and show the card if it passes. */
  evaluate: () => void;
  /** "Maybe later" / dismiss - pushes the next ask out. */
  decline: () => void;
  /** "Don't ask again" - terminal. */
  stopForever: () => void;
  /** User followed a review link - terminal, never ask a reviewer again. */
  recordReviewed: () => void;
}

export const useReviewPromptStore = create<ReviewPromptStore>((set, get) => ({
  state: readState(),
  visible: false,

  recordActiveDay: () => {
    const now = Date.now();
    const today = dayKey(now);
    const current = get().state;
    const alreadyToday = current.activeDays.includes(today);
    if (alreadyToday && current.firstSeenAt !== null) return;

    const next: ReviewPromptState = {
      ...current,
      // Existing installs get seeded on the day this ships. That is
      // deliberate, not a bug: nobody is asked for the first MIN_AGE_MS
      // after deploy, which is the same grace a new user gets.
      firstSeenAt: current.firstSeenAt ?? now,
      activeDays: alreadyToday
        ? current.activeDays
        : [...current.activeDays, today].slice(-MAX_TRACKED_DAYS),
    };
    writeState(next);
    set({ state: next });
  },

  evaluate: () => {
    const { state, visible } = get();
    if (visible) return;
    const now = Date.now();
    if (!shouldShowReviewAsk(state, now, readSupportModalSeenAt())) return;
    // Stamp the ask as we show it, so a reload cannot replay the same ask.
    const next: ReviewPromptState = { ...state, lastAskedAt: now };
    writeState(next);
    set({ state: next, visible: true });
  },

  decline: () => {
    const current = get().state;
    const next: ReviewPromptState = {
      ...current,
      declineCount: current.declineCount + 1,
      lastAskedAt: Date.now(),
    };
    writeState(next);
    set({ state: next, visible: false });
  },

  stopForever: () => {
    const next: ReviewPromptState = { ...get().state, status: 'stopped' };
    writeState(next);
    set({ state: next, visible: false });
  },

  recordReviewed: () => {
    const next: ReviewPromptState = { ...get().state, status: 'stopped' };
    writeState(next);
    set({ state: next, visible: false });
  },
}));

/** Test seam - resets the in-memory store to what storage currently says. */
export function __resetReviewPromptStore(): void {
  useReviewPromptStore.setState({ state: readState(), visible: false });
}

export const REVIEW_PROMPT_CONSTANTS = {
  DAY_MS,
  MIN_AGE_MS,
  MIN_ACTIVE_DAYS,
  DECLINE_BACKOFF_MS,
  MAX_DECLINES,
  SUPPORT_MODAL_QUIET_MS,
  STORAGE_KEY,
  SUPPORT_MODAL_KEY,
} as const;
