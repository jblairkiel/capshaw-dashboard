// The Bible class tools: question sets with their questions, and the extra
// questions the stadium game draws on.
const { searchTextOf } = require('../../lib/jeopardy');

const SETS = [
  ['Genesis 1-2', '3rd-4th', [
    ['On which day was light made?', 'The first day'],
    ['What was made on the seventh day?', 'Nothing — God rested'],
    ['Who was the first man?', 'Adam'],
  ]],
  ['Luke 15', '5th-6th', [
    ['How many sheep did the shepherd have?', 'A hundred'],
    ['What did the younger son ask his father for?', 'His share of the inheritance'],
    ['Who was glad when the son came home?', 'His father'],
  ]],
  ['Acts 2', '7th-8th', [
    ['What day was it when the Spirit came?', 'Pentecost'],
    ['Who preached to the crowd?', 'Peter'],
    ['How many were added that day?', 'About three thousand'],
  ]],
];

const GAME = [
  ['Who led Israel out of Egypt?', 'Moses'],
  ['What is the first book of the New Testament?', 'Matthew'],
  ['Who baptised Jesus?', 'John'],
  ['How many books are in the Bible?', 'Sixty-six'],
];

// A Bible Jeopardy board, as if uploaded from the template: two categories
// with a Daily Double each, and a Final.
const JEOPARDY = {
  title: 'Genesis review',
  categories: [
    ['In the Beginning', [
      [100, 'Made on the first day.', 'What is light?'],
      [200, 'The garden God planted in the east.', 'What is Eden?', true],
      [300, 'The first woman.', 'Who is Eve?'],
    ]],
    ['The Flood', [
      [100, 'He built an ark of gopher wood.', 'Who is Noah?'],
      [200, 'Days and nights it rained.', 'What is forty?'],
      [300, 'The sign of God\'s promise never to flood the earth again.', 'What is a rainbow?', true],
    ]],
    ['Abraham', [
      [100, 'The city Abram was called out of.', 'What is Ur?'],
      [200, 'The son of the promise.', 'Who is Isaac?'],
      [300, 'The mountain where Abraham was told to offer his son.', 'What is Moriah?'],
    ]],
  ],
  final: { category: 'Joseph', clue: 'The country where Joseph became second only to Pharaoh.', answer: 'What is Egypt?' },
};

module.exports = {
  id:    'bible-class',
  label: 'Bible Class',
  area:  'bible-class',
  page:  'Bible Class · Stadium Game and Bible Jeopardy',
  order: 80,
  describe: 'Question sets with their questions, extra questions for the game, and a Bible Jeopardy board.',
  tables: ['question_sets', 'questions', 'custom_game_questions', 'jeopardy_games'],

  generate({ insert, random, scale }) {
    for (let i = 0; i < scale; i++) {
      for (const [passage, grade, questions] of SETS) {
        const setId = insert('question_sets', { passage, grade }, `${passage} (${grade})`);
        for (const [question, answer] of questions) {
          insert('questions', {
            set_id: setId, question, answer,
            type: 'short-answer',
            hint: random.chance(0.4) ? 'Have a look at the first few verses.' : '',
          }, question);
        }
      }
    }

    const board = {
      categories: JEOPARDY.categories.map(([name, clues]) => ({
        name, clues: clues.map(([points, clue, answer, daily = false]) => ({ points, clue, answer, daily })),
      })),
      final: JEOPARDY.final,
    };
    insert('jeopardy_games', {
      title: JEOPARDY.title, board: JSON.stringify(board), search_text: searchTextOf(board), created_by_name: 'Sample data',
    }, JEOPARDY.title);

    for (const [question, answer] of GAME) {
      insert('custom_game_questions', {
        type: 'short-answer', question, answer, options: '', hint: '',
      }, question);
    }
  },
};
