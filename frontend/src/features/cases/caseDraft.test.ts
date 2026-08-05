// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
//
// Unit tests for the pure half of the case editor: what a draft is, what the
// operations on one mean, and what stops it being shared.

import { describe, it, expect } from 'vitest';
import {
  blockersForSharing,
  canSave,
  draftFromPlaybook,
  emptyDraft,
  emptyStep,
  formatList,
  moveStep,
  nextStepId,
  parseList,
  removeStep,
  updateStep,
} from './caseDraft';
import type { CaseDraft, DraftStep } from './caseDraft';
import { PLAYBOOKS } from './playbooks';
import { STEP_TARGETS, isKnownTarget, isValidTarget } from './stepTargets';

function step(id: string, overrides: Partial<DraftStep> = {}): DraftStep {
  return {
    id,
    title: 'Open the bill',
    what: '',
    why: '',
    moduleLabel: '',
    to: '/boq',
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

function draft(overrides: Partial<CaseDraft> = {}): CaseDraft {
  return { ...emptyDraft(), title: 'How we price a variation', ...overrides };
}

describe('step ids', () => {
  it('never reuses an id that was deleted', () => {
    // Run progress is keyed by step id. A sequential id would hand a new step
    // the completion state of the one it replaced.
    const steps = [step('s1'), step('s2'), step('s3')];
    const afterDelete = removeStep(steps, 1);
    expect(nextStepId(afterDelete)).toBe('s4');
  });

  it('starts at s1 on an empty case', () => {
    expect(nextStepId([])).toBe('s1');
  });

  it('ignores ids that are not in the counter shape', () => {
    expect(nextStepId([step('imported-step'), step('s7')])).toBe('s8');
  });

  it('mints a blank step carrying the next id', () => {
    expect(emptyStep([step('s1')]).id).toBe('s2');
    expect(emptyStep([step('s1')]).title).toBe('');
  });
});

describe('reordering', () => {
  const steps = [step('s1'), step('s2'), step('s3')];

  it('moves a step down', () => {
    expect(moveStep(steps, 0, 1).map((s) => s.id)).toEqual(['s2', 's1', 's3']);
  });

  it('moves a step up', () => {
    expect(moveStep(steps, 2, -1).map((s) => s.id)).toEqual(['s1', 's3', 's2']);
  });

  it('is a no-op at either end rather than an error', () => {
    expect(moveStep(steps, 0, -1).map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(moveStep(steps, 2, 1).map((s) => s.id)).toEqual(['s1', 's2', 's3']);
  });

  it('does not mutate the input', () => {
    const original = [step('s1'), step('s2')];
    moveStep(original, 0, 1);
    expect(original.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});

describe('updateStep', () => {
  it('patches one step and leaves the others alone', () => {
    const steps = [step('s1'), step('s2')];
    const next = updateStep(steps, 1, { title: 'Raise the change order' });
    expect(next.map((s) => s.title)).toEqual(['Open the bill', 'Raise the change order']);
    // The input is untouched: the editor holds the draft in React state, so a
    // helper that mutated in place would skip a re-render.
    expect(steps.map((s) => s.title)).toEqual(['Open the bill', 'Open the bill']);
  });
});

describe('list fields', () => {
  it('drops blanks so a trailing comma does not make an empty chip', () => {
    expect(parseList('drawing revision, priced bill, ')).toEqual([
      'drawing revision',
      'priced bill',
    ]);
  });

  it('round-trips', () => {
    expect(parseList(formatList(['a', 'b']))).toEqual(['a', 'b']);
  });

  it('caps the list rather than growing without bound', () => {
    expect(parseList(Array.from({ length: 30 }, (_, i) => `x${i}`).join(','))).toHaveLength(12);
  });
});

describe('what stops a case being shared', () => {
  it('an empty case cannot be shared', () => {
    expect(blockersForSharing(draft())).toContain('cases.editor.blocker.no_steps');
  });

  it('a case with no title cannot be shared', () => {
    expect(blockersForSharing(draft({ title: '  ' }))).toContain('cases.editor.blocker.no_title');
  });

  it('a step with no screen cannot be shared', () => {
    const d = draft({ steps: [step('s1', { to: '' })] });
    expect(blockersForSharing(d)).toContain('cases.editor.blocker.incomplete_steps');
  });

  it('a step pointing off the app cannot be shared', () => {
    const d = draft({ steps: [step('s1', { to: 'https://evil.example' })] });
    expect(blockersForSharing(d)).toContain('cases.editor.blocker.bad_target');
  });

  it('a complete case has nothing blocking it', () => {
    expect(blockersForSharing(draft({ steps: [step('s1')] }))).toEqual([]);
  });

  it('a missing "why" is not a blocker', () => {
    // The backend reports this as a WARNING and still allows sharing. Greying
    // the button out here would be stricter than the rule it mirrors.
    const d = draft({ steps: [step('s1', { why: '' })] });
    expect(blockersForSharing(d)).toEqual([]);
  });
});

describe('canSave', () => {
  it('needs a title and nothing else, so a rough draft still saves', () => {
    expect(canSave(draft({ steps: [] }))).toBe(true);
    expect(canSave(draft({ title: '' }))).toBe(false);
  });
});

describe('starting from a shipped playbook', () => {
  const translate = (key: string | undefined, fallback: string) => (key ? `T:${key}` : fallback);

  // The glob has to have found something or every assertion below is vacuous.
  const first = PLAYBOOKS.at(0);
  if (!first) throw new Error('no shipped playbooks were discovered');

  it('copies every step of a real shipped case', () => {
    const d = draftFromPlaybook(first, translate);
    expect(d.steps).toHaveLength(first.steps.length);
    expect(d.steps.map((s) => s.to)).toEqual(first.steps.map((s) => s.to));
  });

  it('records where the copy came from', () => {
    expect(draftFromPlaybook(first, translate).sourcePlaybookId).toBe(first.id);
  });

  it('starts the copy private whatever the original was', () => {
    expect(draftFromPlaybook(first, translate).isShared).toBe(false);
  });

  it('resolves translation keys, because a key is not text an author can edit', () => {
    const source = PLAYBOOKS.find((pb) => pb.titleKey);
    expect(source, 'expected at least one shipped playbook to carry a titleKey').toBeTruthy();
    if (!source) return;
    expect(draftFromPlaybook(source, translate).title).toBe(`T:${source.titleKey}`);
  });

  it('produces a draft the sharing rules accept', () => {
    // Every shipped case is by definition a good case, so copying one and
    // being told it cannot be shared would mean the rules disagree with the
    // product's own examples.
    for (const source of PLAYBOOKS.slice(0, 20)) {
      expect(blockersForSharing(draftFromPlaybook(source, translate))).toEqual([]);
    }
  });
});

describe('the screen catalogue', () => {
  it('is built from the shipped cases and is not empty', () => {
    expect(STEP_TARGETS.length).toBeGreaterThan(10);
  });

  it('offers only in-app paths', () => {
    for (const target of STEP_TARGETS) {
      expect(target.to.startsWith('/'), target.to).toBe(true);
      expect(isValidTarget(target.to), target.to).toBe(true);
    }
  });

  it('is sorted with the most-used screens first', () => {
    const uses = STEP_TARGETS.map((t) => t.uses);
    expect(uses).toEqual([...uses].sort((a, b) => b - a));
  });

  it('recognises a screen a shipped case uses, query string and all', () => {
    const top = STEP_TARGETS.at(0);
    if (!top) throw new Error('the screen catalogue is empty');
    const known = top.to;
    expect(isKnownTarget(known)).toBe(true);
    expect(isKnownTarget(`${known}?tab=cost`)).toBe(true);
    expect(isKnownTarget('/not-a-screen-any-case-uses')).toBe(false);
  });

  it('refuses the targets the backend refuses', () => {
    // Same list as the backend schema test. The two guards have to agree, or
    // the editor accepts something the save then rejects.
    for (const bad of [
      'javascript:alert(1)',
      'https://evil.example/x',
      '//evil.example/x',
      'boq',
      '/../admin',
      '/a/../../b',
      '',
    ]) {
      expect(isValidTarget(bad), bad).toBe(false);
    }
    for (const good of [
      '/boq',
      '/reports?tab=cost',
      '/projects/new',
      // A route parameter, which the shipped cases use and the runner
      // substitutes at run time.
      '/projects/:projectId/files',
    ]) {
      expect(isValidTarget(good), good).toBe(true);
    }
  });

  it('allowing a colon in the path does not let a scheme through', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
      expect(isValidTarget(bad), bad).toBe(false);
    }
  });
});
