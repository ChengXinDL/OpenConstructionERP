// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Group-colour reconciliation (issues #396/#397/#398).
 *
 * These tests exist because the defect they cover was not a rendering glitch:
 * a group colour map that never settled kept its rows permanently dirty, which
 * re-armed the debounced save before it could fire, so a document silently
 * stopped persisting while the sidebar still claimed it was synced. The unit
 * under test is therefore the DECISION about which copy may be written in a
 * commit, not the colours themselves.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MEASUREMENT_COLOR,
  groupColorCommit,
  groupColorIdentity,
  hydrateGroupColors,
  resolveMeasurementColor,
  retargetGroupColor,
  stampGroupColors,
  type GroupColorState,
  type GroupColors,
} from './takeoff-colors';

const RED = '#EF4444';
const GREEN = '#22C55E';

interface Row {
  id: string;
  group: string;
  groupColor?: string;
}

const row = (id: string, group: string, groupColor?: string): Row => ({
  id,
  group,
  groupColor,
});

/**
 * Drive the reconciliation the way the viewer's effect does: apply the action
 * this commit asks for, then re-enter with the result, exactly as a React
 * re-render would. Returns one `"<map value>/<mirror value>"` sample per
 * commit so a test can assert on the SEQUENCE - a settled pair repeats the
 * same sample forever, an unsettled one never does.
 */
function runCommits(
  initial: GroupColorState<Row>,
  identity: string,
  commits: number,
  group: string,
): string[] {
  let state = initial;
  const samples: string[] = [];
  for (let i = 0; i < commits; i += 1) {
    const action = groupColorCommit(state, identity);
    // Apply BOTH writes the action offers, exactly as the viewer's effect does.
    // The harness never chooses between them: if the decision under test ever
    // hands back two writes derived from the same pre-commit snapshot, that is
    // the defect, and it shows up here as an alternation that never ends.
    state = {
      colors: action.colors ?? state.colors,
      measurements: action.measurements ?? state.measurements,
      hydratedFor: action.hydratedFor,
    };
    const mirror = state.measurements.find((m) => m.group === group)?.groupColor;
    samples.push(`${state.colors[group]}/${mirror}`);
  }
  return samples;
}

describe('takeoff-colors', () => {
  describe('groupColorCommit', () => {
    /**
     * The core of #398. A map that says one colour and rows that say another is
     * reachable in normal use, and the old pair of standing effects had no
     * fixed point for it: each side rewrote the other with a value it had read
     * one render earlier, so the two alternated for as long as the document
     * stayed open. Asserting "settles" rather than "settles to X" keeps the
     * test about the property that matters - that writing stops.
     */
    it('settles a map-versus-mirror disagreement instead of alternating forever', () => {
      const identity = groupColorIdentity('proj', 'doc', 'plan.pdf');
      const samples = runCommits(
        {
          // Planted disagreement: localStorage says the group is green, the
          // rows that came off the server say it is red.
          colors: { Walls: GREEN },
          measurements: [row('a', 'Walls', RED), row('b', 'Walls', RED)],
          hydratedFor: null,
        },
        identity,
        12,
        'Walls',
      );
      // Everything after the first (hydration) commit is one repeated value.
      expect(new Set(samples.slice(1)).size).toBe(1);
      // And the two copies agree with each other, not merely with themselves.
      expect(samples[samples.length - 1]).toBe(`${RED}/${RED}`);
    });

    /**
     * The half of #398 that made the bad state durable: the map is written to
     * localStorage on every change, so an inconsistent map was what a reopen
     * hydrated from and the loop restarted with no user action. A document
     * carrying the stored bad map must converge on load, which means hydration
     * has to take the server's value rather than defer to the cached one.
     */
    it('recovers a document whose stored map disagrees with its saved rows', () => {
      const identity = groupColorIdentity('proj', 'doc', 'plan.pdf');
      const state: GroupColorState<Row> = {
        colors: { Walls: GREEN },
        measurements: [row('a', 'Walls', RED)],
        hydratedFor: null,
      };
      const first = groupColorCommit(state, identity);
      // The server's copy wins, because it is the one other people can see.
      expect(first.colors?.Walls).toBe(RED);
    });

    /**
     * Hydration must not also stamp in the same commit. That is precisely what
     * the old code did - two effects firing in one commit, the second reading
     * the array the first had already superseded - and it is what left the pair
     * with no fixed point. One writer per commit is the whole mechanism.
     */
    it('does not write the mirror in the same commit it hydrates the map', () => {
      const identity = groupColorIdentity('proj', 'doc', 'plan.pdf');
      const measurements = [row('a', 'Walls', RED)];
      const action = groupColorCommit(
        { colors: { Walls: GREEN }, measurements, hydratedFor: null },
        identity,
      );
      expect(action.colors).not.toBeNull();
      expect(action.measurements).toBeNull();
    });

    /**
     * The gate is keyed on the document, not latched once per mount. Rewriting
     * it as a plain "has hydrated" boolean would look correct on the document
     * that is open and silently break the next one: doc B's colours would never
     * be folded in, so it would render doc A's scheme (or none at all).
     */
    it('re-hydrates when a different document is opened', () => {
      const docA = groupColorIdentity('proj', 'doc-a', 'a.pdf');
      const docB = groupColorIdentity('proj', 'doc-b', 'b.pdf');
      const settled: GroupColorState<Row> = {
        colors: { Walls: RED },
        measurements: [row('a', 'Walls', RED)],
        hydratedFor: docA,
      };
      const quiet = groupColorCommit(settled, docA);
      expect(quiet.colors).toBeNull();
      expect(quiet.measurements).toBeNull();
      // Same state, different document: the map has to be taught again.
      const reopened = groupColorCommit(
        { ...settled, measurements: [row('c', 'Slab', GREEN)] },
        docB,
      );
      expect(reopened.colors?.Slab).toBe(GREEN);
    });

    /**
     * A document identity has to survive a null document id, because that is a
     * normal state (a file dropped into the viewer that has not been uploaded
     * yet). Keying the gate on the id alone would make every such file the same
     * document, so only the first one opened would ever hydrate.
     */
    it('keeps two unsynced local files apart', () => {
      expect(groupColorIdentity('proj', null, 'north.pdf')).not.toBe(
        groupColorIdentity('proj', null, 'south.pdf'),
      );
      // And a real identity is always a string, so the "never hydrated" null
      // sentinel can never be mistaken for one.
      expect(groupColorIdentity(null, null, null)).toBe('||');
    });

    /** Nothing has arrived to hydrate from yet, so the gate stays open. */
    it('stays un-hydrated while the document has no measurements', () => {
      const identity = groupColorIdentity('proj', 'doc', 'plan.pdf');
      const action = groupColorCommit(
        { colors: {}, measurements: [], hydratedFor: null },
        identity,
      );
      expect(action.colors).toBeNull();
      expect(action.measurements).toBeNull();
      expect(action.hydratedFor).toBeNull();
    });
  });

  describe('retargetGroupColor', () => {
    /**
     * #397. Moving a measurement used to patch `group` alone, so the row landed
     * in its new group still carrying the colour of the one it left. Nothing
     * downstream could tell that colour apart from a deliberate group setting,
     * so a single property edit repainted every other member of the
     * destination.
     */
    it('drops the source group colour when moving into an uncoloured group', () => {
      const colors: GroupColors = { Walls: RED };
      const moved = retargetGroupColor(row('a', 'Walls', RED), 'Slab', colors);
      expect(moved.group).toBe('Slab');
      expect(moved.groupColor).toBeUndefined();
    });

    /** Moving into a group that HAS a colour adopts it, not the old one. */
    it('adopts the destination group colour when the destination has one', () => {
      const colors: GroupColors = { Walls: RED, Slab: GREEN };
      expect(retargetGroupColor(row('a', 'Walls', RED), 'Slab', colors).groupColor).toBe(GREEN);
    });

    /**
     * The end-to-end shape of #397, and the one the in-memory assertions above
     * cannot catch on their own: the stale colour did its damage on the NEXT
     * load, when hydration folded it into the map as though it were the
     * destination group's chosen colour. Simulating a reload is what proves the
     * move left nothing behind to fold in.
     */
    it('leaves the destination group unpainted after a reload', () => {
      const colors: GroupColors = { Walls: RED };
      const moved = retargetGroupColor(row('a', 'Walls', RED), 'Slab', colors);
      const saved = [row('b', 'Walls', RED), moved, row('c', 'Slab', undefined)];
      // Reopen: the cached map knows only Walls, the rows are re-read.
      const reopened = groupColorCommit(
        { colors: { Walls: RED }, measurements: saved, hydratedFor: null },
        groupColorIdentity('proj', 'doc', 'plan.pdf'),
      );
      expect(reopened.colors?.Slab).toBeUndefined();
      expect(reopened.colors?.Walls).toBe(RED);
    });

    /**
     * Called on an already-patched row the guard would compare the new group
     * with itself and return early, leaving the stale colour attached - the
     * exact defect. Pin the pre-patch contract down so a later refactor cannot
     * quietly reintroduce it.
     */
    it('is a no-op when the row is already in the destination group', () => {
      const r = row('a', 'Slab', RED);
      expect(retargetGroupColor(r, 'Slab', { Slab: GREEN })).toBe(r);
    });
  });

  describe('stampGroupColors', () => {
    /**
     * The map is authoritative for every group it KNOWS. A group it does not
     * know is left alone rather than cleared, because the mirrored colour is
     * the only surviving evidence that the group was ever coloured, and
     * hydration is what reads it. Clearing here would PATCH that loss to the
     * server before hydration ever ran - which happens whenever the user draws
     * something before the server rows resolve.
     */
    it('leaves a mirrored colour alone for a group the map does not know', () => {
      const rows = [row('a', 'Slab', RED)];
      expect(stampGroupColors(rows, {})).toBe(rows);
    });

    it('publishes the map onto the rows that mirror it', () => {
      const stamped = stampGroupColors([row('a', 'Walls', RED)], { Walls: GREEN });
      expect(stamped[0]!.groupColor).toBe(GREEN);
    });

    /** Reference-stable when nothing drifts, so a no-op cannot cause a render. */
    it('returns the same array when every mirror already agrees', () => {
      const rows = [row('a', 'Walls', RED)];
      expect(stampGroupColors(rows, { Walls: RED })).toBe(rows);
    });
  });

  describe('resolveMeasurementColor', () => {
    /**
     * The other half of #396. Clearing an override is only worth anything if
     * something downstream then reads the group, so this is the assertion that
     * says the new checkbox does what its label promises: the row goes back to
     * FOLLOWING its group, rather than being frozen at whatever hex the group
     * happened to be showing when it was cleared.
     */
    it('falls back to the group colour once the override is cleared', () => {
      const colors: GroupColors = { Walls: GREEN };
      const pinned = { ...row('a', 'Walls'), color: RED };
      expect(resolveMeasurementColor(pinned, colors)).toBe(RED);
      // Clearing is the absence of the property, which is what a JSON round
      // trip through the server produces for a NULL group_color.
      const cleared = { ...pinned, color: undefined };
      expect(resolveMeasurementColor(cleared, colors)).toBe(GREEN);
      // And it keeps following: recolouring the group moves the row with it.
      expect(resolveMeasurementColor(cleared, { Walls: RED })).toBe(RED);
    });

    /**
     * A cleared row in an uncoloured group has nothing to follow, and returning
     * undefined there would paint nothing at all on the canvas - the row would
     * simply vanish. The base colour is the same one a brand new measurement
     * gets, so clearing lands exactly where a fresh measurement starts.
     */
    it('falls back to the base colour when neither the row nor its group has one', () => {
      expect(resolveMeasurementColor(row('a', 'Slab'), {})).toBe(DEFAULT_MEASUREMENT_COLOR);
    });

    /**
     * An empty string is not a colour. It cannot come from the swatches, but it
     * can come off the wire from a malformed row, and honouring it would paint
     * that measurement invisible with no way to tell why.
     */
    it('treats an empty override as no override', () => {
      expect(resolveMeasurementColor({ ...row('a', 'Walls'), color: '' }, { Walls: GREEN })).toBe(
        GREEN,
      );
    });
  });

  describe('hydrateGroupColors', () => {
    it('returns the same map when the rows teach it nothing new', () => {
      const colors: GroupColors = { Walls: RED };
      expect(hydrateGroupColors(colors, [row('a', 'Walls', RED)])).toBe(colors);
    });

    it('learns a group it had never seen', () => {
      expect(hydrateGroupColors({}, [row('a', 'Slab', GREEN)]).Slab).toBe(GREEN);
    });
  });
});
