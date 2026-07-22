// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
import { describe, it, expect } from 'vitest';
import { seedAnnotationCounters } from '../lib/takeoff-labels';

describe('seedAnnotationCounters (issue #384)', () => {
  it('returns the highest trailing number per type', () => {
    const seeded = seedAnnotationCounters([
      { type: 'distance', annotation: 'Distance 1' },
      { type: 'distance', annotation: 'Distance 3' },
      { type: 'area', annotation: 'Area 2' },
    ]);
    expect(seeded).toEqual({ distance: 3, area: 2 });
  });

  it('so a reopened doc never re-issues a default label already in use', () => {
    // Two Distance rows hydrate; the next auto label must be Distance 3, not a
    // duplicate Distance 1.
    const seeded = seedAnnotationCounters([
      { type: 'distance', annotation: 'Distance 1' },
      { type: 'distance', annotation: 'Distance 2' },
    ]);
    const nextDistance = (seeded.distance ?? 0) + 1;
    expect(nextDistance).toBe(3);
  });

  it('falls back to label when annotation is empty', () => {
    const seeded = seedAnnotationCounters([
      { type: 'count', annotation: '', label: 'Count 7' },
    ]);
    expect(seeded.count).toBe(7);
  });

  it('ignores rows with no trailing number (renamed labels)', () => {
    const seeded = seedAnnotationCounters([
      { type: 'area', annotation: 'North wall' },
      { type: 'area', annotation: 'Slab on grade' },
    ]);
    expect(seeded.area).toBeUndefined();
  });

  it('is language-agnostic (keys on the trailing number, not the prefix)', () => {
    const seeded = seedAnnotationCounters([
      { type: 'distance', annotation: 'Distanz 4' },
      { type: 'distance', annotation: '距离 6' },
    ]);
    expect(seeded.distance).toBe(6);
  });

  it('over-counts rather than under-counts on a numbered custom label', () => {
    // "Wall 5" is not a default label, but seeding to 5 only skips numbers -
    // never reuses one - so the next default "Distance 6" cannot collide.
    const seeded = seedAnnotationCounters([{ type: 'distance', annotation: 'Wall 5' }]);
    expect(seeded.distance).toBe(5);
  });

  it('returns an empty map for no measurements', () => {
    expect(seedAnnotationCounters([])).toEqual({});
  });
});
