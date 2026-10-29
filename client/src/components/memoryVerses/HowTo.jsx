import { useState } from 'react';

// "How to use Memory Verses", at the top of the app. Open the first time
// somebody comes; closing it is remembered on that device.

const KEY = 'memoryVerses.howToClosed';
const closedBefore = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const rememberClosed = closed => { try { localStorage.setItem(KEY, closed ? '1' : '0'); } catch { /* storage off */ } };

const Step = ({ n, title, children }) => (
  <li className="flex gap-3">
    <span className="shrink-0 w-7 h-7 rounded-full bg-church-navy text-church-gold font-bold text-sm flex items-center justify-center">{n}</span>
    <div className="min-w-0">
      <h4 className="font-semibold text-church-navy">{title}</h4>
      <div className="text-sm text-gray-600 space-y-1 mt-0.5">{children}</div>
    </div>
  </li>
);

export default function HowTo() {
  const [open, setOpen] = useState(() => !closedBefore());
  const toggle = () => setOpen(o => { rememberClosed(o); return !o; });

  return (
    <section className="card border-l-4 border-church-gold" aria-label="How to use Memory Verses">
      <button type="button" onClick={toggle} aria-expanded={open} className="w-full flex items-center justify-between text-left">
        <span className="font-serif text-lg font-semibold text-church-navy">How to use Memory Verses</span>
        <span className="text-sm text-church-navy">{open ? 'Hide ▲' : 'Show ▼'}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-5">
          <p className="text-sm text-gray-600">
            &ldquo;Your word I have treasured in my heart, That I may not sin against You.&rdquo; (Psalm 119:11). This app helps
            anyone — at home or in class — learn scripture by heart, a few minutes at a time.
          </p>
          <ol className="space-y-4">
            <Step n={1} title="Find a set">
              <p>The <strong>Library</strong> holds sets of verses on one subject. Search for a word, a reference (&ldquo;John 3:16&rdquo;)
                or a topic, and narrow it by <strong>category</strong>, <strong>difficulty</strong> (beginner, intermediate, advanced)
                and <strong>age group</strong>. Start with <em>First Verses</em> or <em>Wisdom from Proverbs</em> if you are new.</p>
            </Step>
            <Step n={2} title="Practise with the games">
              <p>Open a set and choose <strong>Practise</strong>. Switch between the games at any time:</p>
              <ul className="list-disc ml-5 space-y-0.5">
                <li><strong>Flash cards</strong> — see the reference, say the verse, turn the card over to check.</li>
                <li><strong>Fill in the blanks</strong> — choose how many words to hide; tap a blank to check it.</li>
                <li><strong>First letters</strong> — only the first letter of each word, to say the verse from.</li>
                <li><strong>Word order</strong> — tap the shuffled words back into the right order.</li>
                <li><strong>Type it out</strong> — type the verse from memory and see any words you missed.</li>
              </ul>
              <p>A good order for a new verse: read it, then flash cards, fill in the blanks (a few, then more), first letters, and finally type it out.</p>
            </Step>
            <Step n={3} title="Practise at home">
              <p>Your practice is saved for you alone. Each verse you get right comes back a little later (tomorrow, then in 3 days,
                a week, two weeks…); one you miss comes back first. A verse right three times in a row, days apart, counts as
                <strong> learned</strong>.</p>
              <p><strong>My practice</strong> shows what is due today, how many verses you have learned, and your streak of days in a
                row. Five minutes a day does more than an hour once a week.</p>
            </Step>
            <Step n={4} title="Make your own set">
              <p>Choose <strong>Make a new set</strong>, give it a title, file it under a category, difficulty and age group, and add the
                verses — one at a time, or paste several at once. Say which translation you used. Everybody can find and practise
                it. To change one of the built-in sets for your class, choose <strong>Make a copy</strong> and change the copy.</p>
            </Step>
            <Step n={5} title="Teachers: score recitations">
              <p>Under <strong>My classes</strong>, start a class and add your students — from the member directory, or type a name
                for a child or visitor who is not in it. Add any other teachers. Then choose the set the class is learning and, as
                each student recites, tap the stars:</p>
              <ul className="ml-5 space-y-0.5">
                <li><span className="text-church-gold">★★★</span> word-perfect</li>
                <li><span className="text-church-gold">★★</span> one or two helps</li>
                <li><span className="text-church-gold">★</span> needed a lot of help</li>
              </ul>
              <p>A verse can be recited again later — the best score counts. The class&apos;s <strong>board</strong> adds up each
                student&apos;s points for the quarter or for all time. Only the class&apos;s teachers see the board. A student,
                and their family, see just their own scores under <strong>My scores</strong>, and are told on their bell.</p>
            </Step>
            <Step n={6} title="In class: Present mode">
              <p>On a TV or projector, open a set and choose <strong>Present</strong>. Any game fills the screen in large type, and
                you play it with the room. Practice in Present mode is not saved to anybody&apos;s progress.</p>
            </Step>
          </ol>
        </div>
      )}
    </section>
  );
}
