// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The fixtures are the real set a Swiss estimator was picking from, quoted as
 * reported. They share the whole head and differ only in the tail, so a test
 * written against names that differ early would keep passing with the marking
 * removed. That is the point of using these five and not invented ones.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { highlightMatch } from '../highlightMatch';

// `as const` is load bearing under noUncheckedIndexedAccess: without it every
// CATALOGUE[n] below is string | undefined and the file does not compile.
const CATALOGUE = [
  'Installation de chantier - petit chantier, acces direct',
  'Installation de chantier - petit chantier, acces difficile',
  'Installation de chantier - chantier moyen, grue mobile',
  'Installation de chantier - chantier moyen, grue à tour',
  'Installation de chantier - grand chantier, grue à tour + baraquements',
] as const;

/** Render into a container and read back only what came out inside <mark>. */
function marked(text: string, query: string): string[] {
  const { container, unmount } = render(<div>{highlightMatch(text, query)}</div>);
  const out = Array.from(container.querySelectorAll('mark')).map((m) => m.textContent ?? '');
  unmount();
  return out;
}

/** Everything rendered, marked or not, must still read as the original. */
function whole(text: string, query: string): string {
  const { container, unmount } = render(<div>{highlightMatch(text, query)}</div>);
  const out = container.textContent ?? '';
  unmount();
  return out;
}

describe('highlightMatch', () => {
  it('marks the tail that tells two catalogue entries apart', () => {
    expect(marked(CATALOGUE[2], 'grue mobile')).toEqual(['grue mobile']);
    expect(marked(CATALOGUE[3], 'grue à tour')).toEqual(['grue à tour']);
  });

  it('marks nothing on the entries the query does not pick out', () => {
    // The discriminating words are absent from the first two, so those rows
    // must stay plain even though they share every other word.
    expect(marked(CATALOGUE[0], 'grue à tour')).toEqual([]);
    expect(marked(CATALOGUE[1], 'grue à tour')).toEqual([]);
  });

  it('finds an accented name from an unaccented query', () => {
    expect(marked(CATALOGUE[3], 'grue a tour')).toEqual(['grue à tour']);
    // and the marked text is the source spelling, not the folded one
    expect(marked(CATALOGUE[3], 'grue a tour')[0]).toContain('à');
  });

  it('folds case', () => {
    expect(marked(CATALOGUE[2], 'GRUE MOBILE')).toEqual(['grue mobile']);
  });

  it('never alters the text it renders', () => {
    for (const name of CATALOGUE) {
      expect(whole(name, 'grue à tour')).toBe(name);
      expect(whole(name, 'acces')).toBe(name);
      expect(whole(name, 'nothing here')).toBe(name);
    }
  });

  it('does not mark a one letter term when the phrase is absent', () => {
    // "a" alone appears throughout; marking it would speckle the row. The
    // phrase "grue a X" is not present in this entry, so the fallback runs and
    // must drop the single character term.
    const hits = marked(CATALOGUE[0], 'grue a');
    expect(hits).toEqual([]);
  });

  it('falls back to separate terms when the phrase is not contiguous', () => {
    expect(marked(CATALOGUE[4], 'grand baraquements')).toEqual(['grand', 'baraquements']);
  });

  it('marks every occurrence, not only the first', () => {
    // "Installation de chantier - chantier moyen, grue mobile" carries it twice.
    expect(marked(CATALOGUE[2], 'chantier')).toEqual(['chantier', 'chantier']);
  });

  it('returns the text untouched for an empty query', () => {
    expect(marked(CATALOGUE[0], '')).toEqual([]);
    expect(marked(CATALOGUE[0], '   ')).toEqual([]);
    expect(whole(CATALOGUE[0], '')).toBe(CATALOGUE[0]);
  });

  it('renders the query itself as a mark when it is the whole name', () => {
    expect(marked('grue', 'grue')).toEqual(['grue']);
  });
});

describe('highlightMatch in the pickers', () => {
  it('is what puts a mark on screen for a row the estimator is scanning', () => {
    render(
      <ul>
        {CATALOGUE.map((name) => (
          <li key={name}>{highlightMatch(name, 'grue à tour')}</li>
        ))}
      </ul>,
    );
    // Two of the five carry the crane variant, and only those two are marked.
    expect(screen.getAllByText('grue à tour')).toHaveLength(2);
  });
});
