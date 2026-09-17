// The Bible class tools: question sets with their questions, and the extra
// questions the stadium game draws on.
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

module.exports = {
  id:    'bible-class',
  label: 'Bible Class',
  area:  'bible-class',
  page:  'Bible Class · Stadium Game',
  order: 80,
  describe: 'Question sets with their questions, and extra questions for the game.',
  tables: ['question_sets', 'questions', 'custom_game_questions'],

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

    for (const [question, answer] of GAME) {
      insert('custom_game_questions', {
        type: 'short-answer', question, answer, options: '', hint: '',
      }, question);
    }
  },
};
