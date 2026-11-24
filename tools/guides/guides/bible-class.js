// Bible Class tools (Grow → Bible Class, client/src/components/
// BibleClassView.jsx): the three a member or a teacher is most likely to use.
//   - Memory Verses (memoryVerses/): a set from the library, flash cards, the
//     other games, and Present mode for a classroom screen
//   - Bible Quiz (BibleQuizView.jsx): a single-player game and the leaderboard
//   - Bible Jeopardy (jeopardy/): a saved game played with teams
// The Question Generator and Lesson Planner write with AI, which the guide's
// copy of the site has no key for, so they are left out.
//
// The quiz deals its questions on the server, so the guide cannot know the
// answers: it picks the first choice, or types a guess for a written answer,
// and the captions say the answer is shown either way. Bible Jeopardy plays
// the seeded sample board (seed/generators/bibleClass.js), whose first 100
// clue is not a Daily Double; a Daily Double is skipped past if one comes up.
//
// Staged: nothing. Practice, quiz answers and the Jeopardy scores are real in
// the run's throwaway copy of the site.
module.exports = {
  description: 'Bible Class tools: Memory Verses, the Bible Quiz and Bible Jeopardy',
  pace: 0.9,
  // Every caption stays up for at least this long, so it can be read.
  stepSeconds: 10,

  cards: {
    title: {
      kicker: 'MEMBER PORTAL · HOW TO',
      heading: 'Bible Class tools',
      sub: 'Memory verses, the Bible Quiz and Bible Jeopardy',
      note: 'All names and details shown are sample data.',
    },
    end: {
      heading: 'Learning together, in class and at home',
      items: [
        'Grow → Bible Class', 'Memory Verses: flash cards and games', 'Present on a classroom screen',
        'Bible Quiz and the leaderboard', 'Bible Jeopardy with teams', 'Teachers upload games from a template',
      ],
      note: 'Capshaw Church of Christ · Member Portal',
    },
  },

  segments: [
    {
      name: 'bible-class',
      device: 'desktop',
      start: '/?page=my-week',
      ready: ({ page }) => page.locator('button').filter({ has: page.locator('span', { hasText: /^Grow$/ }) }).first(),
      async run({ d, page }) {
        // A callout is drawn where the element is now, so bring it on screen first.
        const show = async (loc, label, opts) => { await d.reveal([].concat(loc)[0]); await d.callout(loc, label, opts); };
        const openTool = async title => {
          await d.click(page.getByRole('heading', { name: title, exact: true }), { ms: 600 });
          await page.getByRole('button', { name: 'Bible Class Apps' }).waitFor({ timeout: 15000 });
          await d.sleep(700);
        };
        const backToTools = async () => {
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
          await d.sleep(600);
          await d.click(page.getByRole('button', { name: 'Bible Class Apps' }), { ms: 500 });
          await page.getByRole('heading', { name: 'Bible Class', exact: true }).waitFor({ timeout: 15000 });
          await d.sleep(600);
        };

        // ── The tools ───────────────────────────────────────────────────────
        d.mark('tools');
        await d.nav('Grow', 'Bible Class');
        await page.getByRole('heading', { name: 'Bible Class', exact: true }).waitFor({ timeout: 15000 });
        await d.sleep(700);
        await show(page.locator('main div.grid').first(), 'Open any tool', { where: 'below' });
        await d.caption({ chip: 'BIBLE CLASS', title: 'Tools for class and for home', text: 'Bible Class is under Grow in the menu. Each tile opens a tool, from memory verses to a Bible quiz and Jeopardy.' });
        await d.hold(4000);
        await d.clear();

        // ── Memory Verses ───────────────────────────────────────────────────
        d.mark('memory-verses');
        await openTool('Memory Verses');
        const howTo = page.getByRole('region', { name: 'How to use Memory Verses' });
        await howTo.waitFor({ timeout: 15000 });
        const howToButton = howTo.getByRole('button').first();
        if ((await howToButton.getAttribute('aria-expanded')) === 'true') {
          await d.click(howToButton, { ms: 500 });
          await d.sleep(500);
        }
        const sets = page.getByRole('list', { name: 'Sets' });
        await sets.waitFor({ timeout: 15000 });
        await show(page.getByLabel('Search the library').locator('xpath=ancestor::div[contains(@class,"card")][1]'), 'Search and filter', { where: 'below' });
        await d.caption({ chip: 'MEMORY VERSES', title: 'A library of verse sets', text: 'Each set holds verses on one subject. Search for a word, a reference or a topic, and narrow it by category, difficulty and age.' });
        await d.hold(3600);
        await d.clear();
        await d.click(sets.getByRole('button').first(), { ms: 600 });
        const practise = page.getByRole('button', { name: 'Practise', exact: true });
        await practise.waitFor({ timeout: 15000 });
        await d.sleep(800);
        await d.click(practise, { ms: 500 });

        const card = page.getByRole('button', { name: 'Turn the card over' });
        await card.waitFor({ timeout: 15000 });
        await d.sleep(500);
        await d.caption({ chip: 'MEMORY VERSES', title: 'Flash cards', text: 'See the reference and say the verse, then turn the card over. Mark how you did. Verses you missed come back first next time.' });
        await d.hold(2400);
        await d.click(card, { ms: 600 });
        await d.hold(2200);
        await d.click(page.getByRole('button', { name: 'I knew it' }).first(), { ms: 500 });
        await d.sleep(600);

        const games = page.getByRole('group', { name: 'Game' });
        await show(games, 'Five ways to practise', { where: 'below' });
        await d.caption({ chip: 'MEMORY VERSES', title: 'More ways to practise', text: 'Try filling in the blanks, first letters, word order or typing it out. Present shows the same games in large type for a classroom screen.' });
        await d.hold(1800);
        const blanks = games.getByRole('button', { name: 'Fill in the blanks' });
        if (await blanks.isVisible().catch(() => false)) {
          await d.click(blanks, { ms: 500 });
          await d.sleep(500);
          const blank = page.getByRole('button', { name: /^Show word/ }).first();
          if (await blank.isVisible().catch(() => false)) await d.click(blank, { ms: 500 });
        }
        await d.hold(1600);
        await d.clear();
        const present = page.getByRole('button', { name: 'Present', exact: true });
        if (await present.isVisible().catch(() => false)) {
          await d.click(present, { ms: 500 });
          await d.hold(3000);
          await page.keyboard.press('Escape');
          await d.sleep(700);
        }
        await d.click(page.getByRole('button', { name: 'Back to the set' }).first(), { ms: 500 });
        await d.sleep(600);
        await backToTools();

        // ── Bible Quiz ──────────────────────────────────────────────────────
        d.mark('quiz');
        await openTool('Bible Quiz');
        const start = page.getByRole('button', { name: 'Start', exact: true });
        await start.waitFor({ timeout: 15000 });
        await d.sleep(600);
        await show(page.locator('div.card', { has: start }), 'Single player', { where: 'above' });
        await d.caption({ chip: 'BIBLE QUIZ', title: 'A quiz to play on your own', text: 'Single player deals 10 or 20 questions. Harder questions are worth more, and every point counts toward the members\' leaderboard.' });
        await d.hold(2600);
        await d.click(page.getByRole('button', { name: 'Easy', exact: true }), { ms: 500 });
        await d.sleep(300);
        await d.clear();
        await d.click(start, { ms: 500 });

        const question = page.locator('div.card', { hasText: /Question \d+ of \d+/ });
        const answer = async () => {
          await question.waitFor({ timeout: 15000 });
          await d.sleep(900);
          const typed = question.getByLabel('Your answer');
          if (await typed.isVisible().catch(() => false)) {
            await d.click(typed, { ms: 500 });
            await d.type('Moses', 80);
            await d.click(question.getByRole('button', { name: 'Answer', exact: true }), { ms: 400 });
          } else {
            await d.click(question.locator('div.grid button').first(), { ms: 600 });
          }
          await question.getByRole('status').first().waitFor({ timeout: 10000 });
          await d.sleep(500);
        };
        await answer();
        await show(question.getByRole('status').first(), 'Marked straight away', { where: 'below' });
        await d.caption({ chip: 'BIBLE QUIZ', title: 'Right or not, you learn', text: 'Each answer is marked at once, with the right answer and where to find it. If a question looks wrong, flag it for the quiz keeper.' });
        await d.hold(4000);
        await d.clear();
        await d.click(question.getByRole('button', { name: 'Next', exact: true }), { ms: 500 });
        await answer();
        await d.hold(1200);

        d.mark('leaderboard');
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
        await d.sleep(500);
        await d.click(page.getByRole('tab', { name: 'Leaderboard' }), { ms: 500 });
        const board = page.getByRole('table', { name: 'Leaderboard' });
        await board.waitFor({ timeout: 15000 }).catch(() => {});
        await d.sleep(600);
        const me = board.locator('tr', { hasText: '(you)' });
        if (await me.isVisible().catch(() => false)) await show(me, 'Your points so far', { where: 'below' });
        await d.caption({ chip: 'BIBLE QUIZ', title: 'The members\' leaderboard', text: 'Everyone who plays single player is ranked by points, for all time or this month. Classroom mode sets up teams for a class instead.' });
        await d.hold(4000);
        await d.clear();
        await backToTools();

        // ── Bible Jeopardy ──────────────────────────────────────────────────
        d.mark('jeopardy');
        await openTool('Bible Jeopardy');
        const newGame = page.getByRole('button', { name: 'New game', exact: true });
        await newGame.waitFor({ timeout: 15000 });
        const firstGame = page.locator('main ul > li > button').first();
        await firstGame.waitFor({ timeout: 15000 });
        await d.sleep(500);
        await show([page.getByRole('link', { name: 'Download the template' }).first(), newGame], 'Template, then upload', { where: 'below' });
        await d.caption({ chip: 'FOR TEACHERS', title: 'Bible Jeopardy', text: 'Fill in the Excel template, then upload it with New game. Every game is kept here, with its own link, for anyone to play.' });
        await d.hold(4000);
        await d.clear();
        await d.click(firstGame, { ms: 600 });
        const play = page.getByRole('button', { name: 'Play this game' });
        await play.waitFor({ timeout: 15000 });
        await d.sleep(800);
        await d.click(play, { ms: 500 });
        const begin = page.getByRole('button', { name: 'Start the game' });
        await begin.waitFor({ timeout: 15000 });
        await d.sleep(500);
        await d.caption({ chip: 'BIBLE JEOPARDY', title: 'Play it on the classroom screen', text: 'Name the teams and start. Pick a clue, show the answer, and score each team. Daily Doubles and Final Jeopardy are built in.' });
        await d.hold(1800);
        await d.click(begin, { ms: 500 });
        await d.sleep(600);
        await d.click(page.getByRole('button', { name: / for 100$/ }).first(), { ms: 600 });
        await d.sleep(600);
        const reveal = page.getByRole('button', { name: 'Show the answer' });
        if (await reveal.isVisible().catch(() => false)) {
          await d.hold(1800);
          await d.click(reveal, { ms: 500 });
          await d.sleep(500);
          const right = page.getByRole('button', { name: /^Team 1 right$/ });
          if (await right.isVisible().catch(() => false)) await d.click(right, { ms: 500 });
          await d.hold(1400);
          await d.click(page.getByRole('button', { name: 'Back to the board' }), { ms: 500 });
        }
        await d.hold(2000);
        await d.clear();
      },
    },
  ],
};
