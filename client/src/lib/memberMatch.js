// ─── Member Match: building a game ────────────────────────────────────────────
//
// A "family" here is everybody in one photo: that is all the directory says
// about who belongs together (the server groups people by shared portrait).
// Two rules follow from it:
//
//   - A family is spread through the game, not asked back to back: the
//     questions are dealt out at random, but never two from the same photo in
//     a row when the photos on file make that possible at all.
//   - A question offers at most one name from any family — never the person's
//     own relatives as wrong answers, and never two relatives of each other.

export const OPTIONS_PER_QUESTION = 4;

export function shuffled(list, random = Math.random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// Whether what is left can still be dealt with no family twice in a row, the
// first of it not from `last`. With n left, a family other than `last` may
// have at most half (rounded up); `last` itself at most half rounded down,
// since it cannot go first.
function canSpread(counts, last, n) {
  for (const [photo, count] of counts) {
    if (count > (photo === last ? Math.floor(n / 2) : Math.ceil(n / 2))) return false;
  }
  return true;
}

// One question per person in each photo. Each family's own members come in a
// shuffled order, and the families are interleaved at random so that, where
// possible, no two questions in a row share a photo.
export function buildQuestions(rounds, random = Math.random) {
  const queues = new Map();
  for (const round of rounds) {
    const members = shuffled(round.members, random);
    queues.set(round.photo, members.map((member, i) => ({
      photo:         round.photo,
      targetId:      member.id,
      targetName:    member.name,
      familySize:    members.length,
      indexInFamily: i + 1,
    })));
  }

  const counts = new Map([...queues].map(([photo, q]) => [photo, q.length]));
  let left = [...counts.values()].reduce((a, b) => a + b, 0);
  const out = [];
  let last = null;

  while (left > 0) {
    const open = [...counts].filter(([, c]) => c > 0).map(([photo]) => photo);
    const others = open.filter(p => p !== last);
    // Of the families that are not the one just asked, those that still leave
    // the rest spreadable; if none do (one family is simply most of the
    // game), the biggest goes next, to use it up as fast as the rest allows.
    const safe = others.filter(p => {
      counts.set(p, counts.get(p) - 1);
      const ok = canSpread(counts, p, left - 1);
      counts.set(p, counts.get(p) + 1);
      return ok;
    });
    let pick;
    if (safe.length) {
      // Weighted by how many each has left, so every remaining question is
      // equally likely to come next.
      const total = safe.reduce((n, p) => n + counts.get(p), 0);
      let r = random() * total;
      pick = safe.find(p => (r -= counts.get(p)) < 0) ?? safe[safe.length - 1];
    } else if (others.length) {
      pick = others.reduce((a, b) => (counts.get(b) > counts.get(a) ? b : a));
    } else {
      pick = last;
    }
    out.push(queues.get(pick).shift());
    counts.set(pick, counts.get(pick) - 1);
    left--;
    last = pick;
  }
  return out;
}

// Which families each name belongs to: a person may be in more than one
// photo — their own, and a family portrait.
export function familiesByName(rounds) {
  const map = new Map();
  for (const round of rounds) {
    for (const m of round.members) {
      if (!map.has(m.name)) map.set(m.name, new Set());
      map.get(m.name).add(round.photo);
    }
  }
  return map;
}

// The right name and up to three wrong ones, each from a different family and
// none from the person's own. Fewer wrong names when the photos on file do not
// have that many other families.
export function choicesFor(question, families, random = Math.random) {
  const taken = new Set(families.get(question.targetName) || [question.photo]);
  const distractors = [];
  for (const name of shuffled([...families.keys()], random)) {
    if (distractors.length >= OPTIONS_PER_QUESTION - 1) break;
    if (name === question.targetName) continue;
    const theirs = [...families.get(name)];
    if (theirs.some(p => taken.has(p))) continue;
    distractors.push(name);
    for (const p of theirs) taken.add(p);
  }
  return shuffled([question.targetName, ...distractors], random);
}
