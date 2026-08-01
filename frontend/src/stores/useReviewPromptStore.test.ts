// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Cadence rules for the review ask.
 *
 * `shouldShowReviewAsk` is pure and takes `now` plus the Support-modal
 * timestamp as arguments, so every rule below is exercised over simulated
 * months without touching a clock or rendering anything.
 *
 * Each assertion here is paired with a rule in the store. They were checked
 * by mutation: flipping MIN_AGE_MS to 0, collapsing DECLINE_BACKOFF_MS to a
 * constant, raising MAX_DECLINES, and making `stopForever` a no-op each turn
 * a specific test in this file red. A test that stays green when its rule is
 * removed is not testing the rule.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  shouldShowReviewAsk,
  reviewAskShownWithin,
  CROSS_SURFACE_QUIET_MS,
  useReviewPromptStore,
  __resetReviewPromptStore,
  dayKey,
  EMPTY_STATE,
  REVIEW_PROMPT_CONSTANTS as C,
  type ReviewPromptState,
} from './useReviewPromptStore';

const DAY = C.DAY_MS;
const NOW = Date.UTC(2026, 6, 1, 12, 0, 0); // fixed reference instant

/** A state that has cleared BOTH earned-the-right gates and never been asked. */
function eligible(overrides: Partial<ReviewPromptState> = {}): ReviewPromptState {
  return {
    firstSeenAt: NOW - 10 * DAY,
    activeDays: Array.from({ length: C.MIN_ACTIVE_DAYS }, (_, i) => `2026-06-${20 + i}`),
    lastAskedAt: null,
    declineCount: 0,
    status: 'active',
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  __resetReviewPromptStore();
});

describe('shouldShowReviewAsk - earning the right to ask', () => {
  it('never asks a brand-new user with no recorded history', () => {
    expect(shouldShowReviewAsk({ ...EMPTY_STATE }, NOW)).toBe(false);
  });

  it('does not ask an install that is old enough but barely used', () => {
    const state = eligible({ activeDays: ['2026-06-20', '2026-06-21'] });
    expect(state.activeDays.length).toBeLessThan(C.MIN_ACTIVE_DAYS);
    expect(shouldShowReviewAsk(state, NOW)).toBe(false);
  });

  it('does not ask a heavy user whose install is still too young', () => {
    // Opened on plenty of distinct days, but all inside the grace window -
    // someone evaluating the tool intensively over a couple of days.
    const state = eligible({ firstSeenAt: NOW - 2 * DAY });
    expect(shouldShowReviewAsk(state, NOW)).toBe(false);
  });

  it('asks once both the age and the distinct-day thresholds are met', () => {
    expect(shouldShowReviewAsk(eligible(), NOW)).toBe(true);
  });

  it('holds off until the very moment the age threshold passes', () => {
    const justShy = eligible({ firstSeenAt: NOW - C.MIN_AGE_MS + 1 });
    const justPast = eligible({ firstSeenAt: NOW - C.MIN_AGE_MS });
    expect(shouldShowReviewAsk(justShy, NOW)).toBe(false);
    expect(shouldShowReviewAsk(justPast, NOW)).toBe(true);
  });
});

describe('shouldShowReviewAsk - spacing between asks', () => {
  it('does not reappear before 4 days have passed', () => {
    const state = eligible({ lastAskedAt: NOW - 3 * DAY });
    expect(shouldShowReviewAsk(state, NOW)).toBe(false);
  });

  it('reappears once 4 days have passed', () => {
    const state = eligible({ lastAskedAt: NOW - 4 * DAY });
    expect(shouldShowReviewAsk(state, NOW)).toBe(true);
  });
});

describe('shouldShowReviewAsk - declines push the next ask further out', () => {
  it('waits 4 days after the first decline', () => {
    const declined = eligible({ declineCount: 1, lastAskedAt: NOW - 3 * DAY });
    expect(shouldShowReviewAsk(declined, NOW)).toBe(false);
    expect(shouldShowReviewAsk({ ...declined, lastAskedAt: NOW - 4 * DAY }, NOW)).toBe(true);
  });

  it('waits longer than 4 days after the second decline', () => {
    const twice = eligible({ declineCount: 2, lastAskedAt: NOW - 4 * DAY });
    // The interval that was enough at one decline is NOT enough at two.
    expect(shouldShowReviewAsk(twice, NOW)).toBe(false);
    expect(shouldShowReviewAsk({ ...twice, lastAskedAt: NOW - 14 * DAY }, NOW)).toBe(true);
  });

  it('waits longer again after the third decline', () => {
    const thrice = eligible({ declineCount: 3, lastAskedAt: NOW - 14 * DAY });
    // The interval that was enough at two declines is NOT enough at three.
    expect(shouldShowReviewAsk(thrice, NOW)).toBe(false);
    expect(shouldShowReviewAsk({ ...thrice, lastAskedAt: NOW - 45 * DAY }, NOW)).toBe(true);
  });

  it('escalates strictly - each decline level waits longer than the last', () => {
    const intervals = C.DECLINE_BACKOFF_MS;
    for (let i = 2; i < intervals.length; i += 1) {
      const current = intervals[i];
      const previous = intervals[i - 1];
      // Explicit rather than `?? 0`: a hole in the table must fail the test,
      // not be silently coerced into a passing comparison.
      if (current === undefined || previous === undefined) {
        throw new Error(`backoff table has a hole at index ${i}`);
      }
      expect(current).toBeGreaterThan(previous);
    }
  });
});

describe('shouldShowReviewAsk - terminal states', () => {
  it('caps the number of asks at four, as a policy value', () => {
    // Pinned as a literal on purpose. Reading the cap from the constant
    // would make every assertion below adapt to whatever the constant says,
    // and raising MAX_DECLINES would then break nothing. Changing the policy
    // should require changing this line, deliberately.
    expect(C.MAX_DECLINES).toBe(4);
  });

  it('never asks again after the decline cap is reached', () => {
    const capped = eligible({ declineCount: 4, lastAskedAt: NOW - 365 * DAY });
    expect(shouldShowReviewAsk(capped, NOW)).toBe(false);
    // Not even a year later.
    expect(shouldShowReviewAsk(capped, NOW + 365 * DAY)).toBe(false);
  });

  it('never asks a user who opted out', () => {
    const stopped = eligible({ status: 'stopped' });
    expect(shouldShowReviewAsk(stopped, NOW)).toBe(false);
    expect(shouldShowReviewAsk(stopped, NOW + 365 * DAY)).toBe(false);
  });
});

describe('shouldShowReviewAsk - does not stack on the Support-us modal', () => {
  it('stays silent while the Support modal is still in its quiet period', () => {
    expect(shouldShowReviewAsk(eligible(), NOW, NOW - 1 * DAY)).toBe(false);
  });

  it('asks once the Support modal quiet period has elapsed', () => {
    expect(shouldShowReviewAsk(eligible(), NOW, NOW - 5 * DAY)).toBe(true);
  });
});

describe('cross-surface quiet period - the modal must survive it', () => {
  /** Seed storage with a given last-shown stamp and ask the real predicate. */
  function shownWithin(lastAskedAt: number | null, now: number): boolean {
    localStorage.setItem(
      C.STORAGE_KEY,
      JSON.stringify({ ...eligible(), lastAskedAt }),
    );
    return reviewAskShownWithin(CROSS_SURFACE_QUIET_MS, now);
  }

  it('reports nothing when the card has never been shown', () => {
    expect(shownWithin(null, NOW)).toBe(false);
  });

  it('reports the card as recent inside the window and stale outside it', () => {
    expect(shownWithin(NOW - 1 * DAY, NOW)).toBe(true);
    expect(shownWithin(NOW - 3 * DAY, NOW)).toBe(true);
    expect(shownWithin(NOW - 4 * DAY, NOW)).toBe(false);
    expect(shownWithin(NOW - 40 * DAY, NOW)).toBe(false);
  });

  /**
   * Walk a full install lifetime, one day at a time, for a user who declines
   * the card EVERY time it appears - the worst case for suppression. Then
   * check the modal still gets its turns.
   *
   * This is the test the "suppression quietly becomes a permanent mute"
   * worry demands: it does not assert against hand-written dates, it drives
   * the real `shouldShowReviewAsk` and derives everything from what actually
   * happens.
   */
  function simulateAlwaysDeclines(): { shownAt: number[]; final: ReviewPromptState } {
    let state = eligible();
    const shownAt: number[] = [];
    for (let day = 0; day <= 730; day += 1) {
      const now = NOW + day * DAY;
      if (shouldShowReviewAsk(state, now)) {
        shownAt.push(now);
        // Shown and declined the same day: the harshest schedule possible.
        state = { ...state, lastAskedAt: now, declineCount: state.declineCount + 1 };
      }
    }
    return { shownAt, final: state };
  }

  it('shows the card at most four times across two years of declining', () => {
    const { shownAt } = simulateAlwaysDeclines();
    expect(shownAt.length).toBe(4);
  });

  it('bounds total suppression to four short windows, not an open-ended mute', () => {
    const { shownAt } = simulateAlwaysDeclines();
    // Each appearance can silence the modal for at most one quiet window.
    const worstCaseSuppressedMs = shownAt.length * CROSS_SURFACE_QUIET_MS;
    expect(worstCaseSuppressedMs).toBeLessThanOrEqual(4 * 4 * DAY);
    // Over a two-year span that is a rounding error, not a mute.
    expect(worstCaseSuppressedMs).toBeLessThan(20 * DAY);
  });

  it('leaves every one of the modal 30-day slots free, even for a serial decliner', () => {
    const { shownAt } = simulateAlwaysDeclines();
    // The Support modal's own cooldown is 30 days, so it wants to fire at
    // roughly day 30, 60, 90 ... Check each slot against the real predicate.
    const slots = [30, 60, 90, 120, 180, 365].map((d) => NOW + d * DAY);
    for (const slot of slots) {
      const lastBefore = [...shownAt].reverse().find((t) => t <= slot) ?? null;
      expect(shownWithin(lastBefore, slot)).toBe(false);
    }
  });

  it('stops suppressing forever once the card has hit its cap', () => {
    const { shownAt, final } = simulateAlwaysDeclines();
    const lastShow = shownAt[shownAt.length - 1];
    if (lastShow === undefined) throw new Error('the card never appeared');
    // The cap is reached, so lastAskedAt can never advance again...
    expect(final.declineCount).toBe(4);
    expect(shouldShowReviewAsk(final, lastShow + 365 * DAY)).toBe(false);
    // ...and the quiet window therefore expires once and never re-arms.
    expect(shownWithin(lastShow, lastShow + 4 * DAY)).toBe(false);
    expect(shownWithin(lastShow, lastShow + 365 * DAY)).toBe(false);
  });
});

describe('store actions', () => {
  it('records distinct days without duplicating today', () => {
    const store = useReviewPromptStore.getState();
    store.recordActiveDay();
    store.recordActiveDay();
    store.recordActiveDay();
    const { state } = useReviewPromptStore.getState();
    expect(state.activeDays).toEqual([dayKey(Date.now())]);
    expect(state.firstSeenAt).not.toBeNull();
  });

  it('seeds the first-launch stamp on the first recorded day', () => {
    useReviewPromptStore.getState().recordActiveDay();
    expect(useReviewPromptStore.getState().state.firstSeenAt).toBeCloseTo(Date.now(), -4);
  });

  it('persists a decline so a reload does not reset the count', () => {
    useReviewPromptStore.setState({ state: eligible(), visible: true });
    useReviewPromptStore.getState().decline();
    expect(useReviewPromptStore.getState().state.declineCount).toBe(1);
    __resetReviewPromptStore(); // simulates a page reload
    expect(useReviewPromptStore.getState().state.declineCount).toBe(1);
  });

  it('persists an opt-out across a reload', () => {
    useReviewPromptStore.setState({ state: eligible(), visible: true });
    useReviewPromptStore.getState().stopForever();
    __resetReviewPromptStore();
    const { state } = useReviewPromptStore.getState();
    expect(state.status).toBe('stopped');
    expect(shouldShowReviewAsk(state, Date.now() + 365 * DAY)).toBe(false);
  });

  it('treats following a review link as terminal', () => {
    useReviewPromptStore.setState({ state: eligible(), visible: true });
    useReviewPromptStore.getState().recordReviewed();
    __resetReviewPromptStore();
    expect(useReviewPromptStore.getState().state.status).toBe('stopped');
  });

  it('stamps lastAskedAt when the card is shown, so a reload cannot replay it', () => {
    useReviewPromptStore.setState({ state: eligible(), visible: false });
    useReviewPromptStore.getState().evaluate();
    expect(useReviewPromptStore.getState().visible).toBe(true);
    expect(useReviewPromptStore.getState().state.lastAskedAt).not.toBeNull();

    __resetReviewPromptStore(); // reload
    useReviewPromptStore.getState().evaluate();
    expect(useReviewPromptStore.getState().visible).toBe(false);
  });
});

describe('storage being unavailable', () => {
  it('degrades to silence rather than throwing', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
        removeItem: () => {},
        clear: () => {},
      },
    });

    expect(() => __resetReviewPromptStore()).not.toThrow();
    expect(() => useReviewPromptStore.getState().recordActiveDay()).not.toThrow();
    expect(() => useReviewPromptStore.getState().evaluate()).not.toThrow();
    // Nothing could be persisted, so nothing may be shown.
    expect(useReviewPromptStore.getState().visible).toBe(false);

    if (original) Object.defineProperty(window, 'localStorage', original);
  });
});
