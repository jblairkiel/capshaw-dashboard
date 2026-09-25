import { useState, useEffect, useMemo, useCallback } from 'react';
import { call } from '../lib/groups';

// ─── Member Match ───────────────────────────────────────────────────────────
//
// A photo, and a name to put to it. A photo held by one directory row is a
// single question; held by several — a family portrait — the same photo comes
// back once per person in it, asked one at a time rather than all at once,
// since nothing on file says which face in the picture is which name.
const API = '/api/member-match';
const OPTIONS_PER_QUESTION = 4;

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// One round per photo becomes one question per person in it, in a shuffled
// order of photos but with a family's own members kept back to back — the
// point is "another face from the same picture", not a random reshuffle of
// everybody at once.
function buildQuestions(rounds) {
  return shuffled(rounds).flatMap(round => {
    const members = shuffled(round.members);
    return members.map((member, i) => ({
      photo:       round.photo,
      targetId:    member.id,
      targetName:  member.name,
      familySize:  members.length,
      indexInFamily: i + 1,
    }));
  });
}

// The correct name plus a few names drawn at random from everybody else with
// a photo on file. Another person from the very same family photo can turn up
// as a wrong choice here — that is still just a wrong choice, since grading
// only ever checks against this one question's own target.
function choicesFor(question, allNames) {
  const pool = allNames.filter(n => n !== question.targetName);
  const distractors = shuffled(pool).slice(0, OPTIONS_PER_QUESTION - 1);
  return shuffled([question.targetName, ...distractors]);
}

export default function MemberMatchView() {
  const [rounds,   setRounds]   = useState(null);
  const [error,    setError]    = useState('');
  const [questions, setQuestions] = useState([]);
  const [index,    setIndex]    = useState(0);
  const [choices,  setChoices]  = useState([]);
  const [picked,   setPicked]   = useState(null);
  const [correct,  setCorrect]  = useState(0);
  const [answered, setAnswered] = useState(0);

  const allNames = useMemo(
    () => [...new Set((rounds || []).flatMap(r => r.members.map(m => m.name)))],
    [rounds]
  );

  const startGame = useCallback(list => {
    const built = buildQuestions(list);
    setQuestions(built);
    setIndex(0);
    setPicked(null);
    setCorrect(0);
    setAnswered(0);
  }, []);

  useEffect(() => {
    call(`${API}/rounds`)
      .then(json => {
        setRounds(json.rounds);
        startGame(json.rounds);
      })
      .catch(err => setError(err.message));
  }, [startGame]);

  const question = questions[index] ?? null;

  // A fresh set of choices for each question, chosen once it is reached — not
  // recomputed on every render, or the options would reshuffle under a click.
  useEffect(() => {
    if (!question) return;
    setChoices(choicesFor(question, allNames));
    setPicked(null);
  }, [question, allNames]);

  function choose(name) {
    if (picked) return;
    setPicked(name);
    setAnswered(a => a + 1);
    if (name === question.targetName) setCorrect(c => c + 1);
  }

  function next() {
    setIndex(i => i + 1);
  }

  function playAgain() {
    startGame(rounds);
  }

  if (error) {
    return <div className="card text-center py-10 text-red-600 text-sm">{error}</div>;
  }

  if (!rounds) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-church-gold" />
      </div>
    );
  }

  if (!questions.length) {
    return (
      <div className="card text-center py-10 text-gray-500 text-sm">
        No member photos are on file yet. Check back once some have been added.
      </div>
    );
  }

  const done = index >= questions.length;

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-church-navy">Member Match</h1>
        <p className="text-sm text-gray-500 mt-1">Put a name to a face from around the church family.</p>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{done ? 'Finished' : `Question ${index + 1} of ${questions.length}`}</span>
        <span className="font-medium text-church-navy">{correct} / {answered} correct</span>
      </div>

      {done ? (
        <div className="card text-center py-10 space-y-4">
          <p className="text-lg font-semibold text-church-navy">
            You matched {correct} of {questions.length}!
          </p>
          <button onClick={playAgain} className="btn-primary text-sm">Play again</button>
        </div>
      ) : (
        <div className="card space-y-4">
          <div className="flex justify-center">
            <img
              src={`${API}/photo/${encodeURIComponent(question.photo)}`}
              alt="Who is this?"
              className="rounded-lg max-h-72 object-contain border border-gray-200"
            />
          </div>

          <p className="text-center text-sm text-gray-600">
            {question.familySize > 1
              ? `Who is this — person ${question.indexInFamily} of ${question.familySize} in this photo?`
              : 'Who is this?'}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {choices.map(name => {
              const isTarget = name === question.targetName;
              const isPicked = name === picked;
              const tone = !picked
                ? 'border-gray-200 hover:border-church-gold text-church-navy'
                : isTarget
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                  : isPicked
                    ? 'border-red-400 bg-red-50 text-red-700'
                    : 'border-gray-200 text-gray-400';

              return (
                <button
                  key={name}
                  onClick={() => choose(name)}
                  disabled={!!picked}
                  className={`text-sm px-4 py-2.5 rounded-lg border-2 transition-colors text-left disabled:cursor-default ${tone}`}
                >
                  {name}
                </button>
              );
            })}
          </div>

          {picked && (
            <div className="flex justify-end">
              <button onClick={next} className="btn-primary text-sm">
                {index + 1 < questions.length ? 'Next' : 'See results'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
