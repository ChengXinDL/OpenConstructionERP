/**
 * No module may ship invented rows to the Insights panel.
 *
 * Every register used to carry a hand-written array of plausible-looking
 * records and substitute it whenever the real query came back empty, so a
 * brand new project opened onto charts of work nobody had done. Roughly 380
 * such records across 43 arrays were removed. The panel now refuses to draw a
 * dataset with no rows, which handles the ones we deleted.
 *
 * This file handles the ones nobody has written yet. InsightsPanel.test.tsx
 * proves the panel discards fabricated rows if it is handed them; it cannot
 * notice a producer quietly reintroducing an array, because the panel would
 * be handed those rows as real. Only a scan of the producers themselves can.
 *
 * The scan reads the source files off disk rather than importing them. A
 * producer is a pure function of records it is given, so importing one and
 * calling it with an empty list would prove only that this particular call
 * returned nothing, and a fallback keyed on some other condition would slip
 * straight past. The text of the file is the thing being asserted about.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const FEATURES = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Producers are named `<module>Insights.ts`, one per feature directory. */
function producers(): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(FEATURES)) {
    const dir = join(FEATURES, entry);
    if (!statSync(dir).isDirectory()) continue;
    for (const file of readdirSync(dir)) {
      if (file.endsWith('Insights.ts') && !file.endsWith('.test.ts')) {
        found.push(join(dir, file));
      }
    }
  }
  return found.sort();
}

/**
 * Strip line and block comments before matching. The word "sample" is still
 * the clearest way to write a comment explaining that fabricated rows were
 * removed, and flagging our own explanation as the offence would train the
 * next person to delete the explanation rather than the code.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const OFFENCES: Array<[string, RegExp]> = [
  // The old shape: a module-level array of fabricated records.
  ['declares a SAMPLE constant', /\b(const|let|var)\s+[A-Z_]*SAMPLE[A-Z_]*\s*[:=]/],
  // The old flag: marks a dataset as illustrative rather than not building it.
  ['flags a dataset as sample data', /\bsample\s*:/],
  // A renamed revival of the same idea.
  ['declares fabricated demo rows', /\b(const|let|var)\s+[A-Z_]*(DEMO|FAKE|MOCK|PLACEHOLDER|DUMMY|FALLBACK)_?ROWS?\b/i],
];

describe('module insights producers', () => {
  const files = producers();

  it('finds the producers at all, so an empty scan cannot pass by default', () => {
    // A path typo would silently make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(OFFENCES)('no producer %s', (_label, pattern) => {
    const guilty = files.filter((f) => pattern.test(code(readFileSync(f, 'utf8'))));
    expect(guilty.map((f) => `${basename(dirname(f))}/${basename(f)}`)).toEqual([]);
  });

  it('draws nothing rather than something when a register is empty', () => {
    // The panel's contract, restated here so the reason these patterns are
    // banned is written down next to the ban: an empty register is a fact
    // about the project. A chart of invented figures is a claim about it.
    const panel = readFileSync(join(FEATURES, 'insights', 'InsightsPanel.tsx'), 'utf8');
    expect(panel).toMatch(/rows\.length\s*>\s*0/);
  });
});
