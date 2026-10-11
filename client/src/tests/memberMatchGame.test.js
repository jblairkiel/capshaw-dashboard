import { describe, test, expect } from 'vitest';
import { buildQuestions, choicesFor, familiesByName } from '../lib/memberMatch';

const family = (photo, names) => ({ photo, members: names.map((name, i) => ({ id: `${photo}-${i}`, name })) });
const ROUNDS = [
  family('smith.jpg', ['Al Smith', 'Bea Smith', 'Cal Smith']),
  family('jones.jpg', ['Dee Jones', 'Ed Jones']),
  family('fay.jpg', ['Fay Ward']),
  family('gus.jpg', ['Gus Hill']),
  family('hal.jpg', ['Hal Ray']),
];
const backToBack = qs => qs.some((q, i) => i > 0 && q.photo === qs[i - 1].photo);

describe('dealing the questions', () => {
  test('everybody once, families spread out, and a family\'s own people in turn — every time', () => {
    for (let run = 0; run < 300; run++) {
      const qs = buildQuestions(ROUNDS);
      expect(qs.map(q => q.targetName).sort()).toEqual(ROUNDS.flatMap(r => r.members.map(m => m.name)).sort());
      expect(backToBack(qs)).toBe(false);
      for (const r of ROUNDS) {
        expect(qs.filter(q => q.photo === r.photo).map(q => q.indexInFamily)).toEqual(r.members.map((_, i) => i + 1));
      }
    }
  });

  test('the order really is random: a family is not always first, nor always together at either end', () => {
    const firsts = new Set();
    for (let run = 0; run < 200; run++) firsts.add(buildQuestions(ROUNDS)[0].photo);
    expect(firsts.size).toBeGreaterThan(3);
  });

  test('when one family is most of the game, it is spread as far as it can be', () => {
    const rounds = [family('big.jpg', ['A', 'B', 'C', 'D']), family('one.jpg', ['E'])];
    for (let run = 0; run < 50; run++) {
      const photos = buildQuestions(rounds).map(q => q.photo);
      // Only one other photo to put between them: big, one, big, big, big.
      expect(photos.slice(0, 2)).toEqual(['big.jpg', 'one.jpg']);
      expect(photos).toHaveLength(5);
    }
  });
});

describe('the choices for a question', () => {
  const families = familiesByName(ROUNDS);
  const asking = name => buildQuestions(ROUNDS).find(q => q.targetName === name);

  test('never a relative of the person asked about, and never two names from one family', () => {
    for (let run = 0; run < 300; run++) {
      const q = asking('Bea Smith');
      const choices = choicesFor(q, families);
      expect(choices).toContain('Bea Smith');
      expect(choices).toHaveLength(4);
      expect(choices.filter(n => n.endsWith('Smith'))).toEqual(['Bea Smith']);
      expect(choices.filter(n => n.endsWith('Jones')).length).toBeLessThanOrEqual(1);
    }
  });

  test('fewer choices rather than a second relative, when there are not enough other families', () => {
    const two = [family('smith.jpg', ['Al Smith', 'Bea Smith']), family('jones.jpg', ['Dee Jones', 'Ed Jones'])];
    const q = buildQuestions(two).find(x => x.targetName === 'Al Smith');
    const choices = choicesFor(q, familiesByName(two));
    expect(choices).toHaveLength(2);
    expect(choices).toContain('Al Smith');
    expect(choices.filter(n => n.endsWith('Jones'))).toHaveLength(1);
  });

  test('somebody in a family portrait and a photo of their own counts as that family either way', () => {
    const rounds = [...ROUNDS, family('al.jpg', ['Al Smith'])];
    const fams = familiesByName(rounds);
    for (let run = 0; run < 100; run++) {
      const q = buildQuestions(rounds).find(x => x.photo === 'al.jpg');
      const choices = choicesFor(q, fams);
      expect(choices.filter(n => n.endsWith('Smith'))).toEqual(['Al Smith']);
    }
  });
});
