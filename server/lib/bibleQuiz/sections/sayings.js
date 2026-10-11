const { mc } = require('../dsl');

module.exports = {
  id: 'sayings', label: 'Who Said It?',
  questions: [
    mc('E', 'Luke 1:38', 'Who said, "Behold the maidservant of the Lord! Let it be to me according to your word"?', 'Mary', ['Elizabeth', 'Hannah', 'Anna']),
    mc('E', 'John 1:29', 'Who said, "Behold! The Lamb of God who takes away the sin of the world!"?', 'John the Baptist', ['Peter', 'Andrew', 'Simeon']),
    mc('E', 'Matthew 16:16', 'Who said, "You are the Christ, the Son of the living God"?', 'Peter', ['John', 'Thomas', 'Judas']),
    mc('M', '1 Samuel 3:10', 'Who said, "Speak, for Your servant hears"?', 'Samuel', ['Eli', 'David', 'Isaiah']),
    mc('M', 'Isaiah 6:8', 'Who said, "Here am I! Send me"?', 'Isaiah', ['Jeremiah', 'Moses', 'Gideon']),
    mc('M', 'Genesis 4:9', 'Who asked, "Am I my brother\'s keeper?"', 'Cain', ['Esau', 'Joseph', 'Abel']),
    mc('M', 'John 20:28', 'Who said to the risen Jesus, "My Lord and my God!"?', 'Thomas', ['Peter', 'Mary Magdalene', 'Nathanael']),
    mc('M', 'Esther 4:16', 'Who said, "If I perish, I perish!"?', 'Esther', ['Ruth', 'Daniel', 'Mordecai']),
    mc('H', 'Luke 2:25-29', 'Who said, "Lord, now You are letting Your servant depart in peace"?', 'Simeon', ['Zacharias', 'Anna', 'Joseph']),
    mc('H', '2 Timothy 4:7', 'Who wrote, "I have fought the good fight, I have finished the race, I have kept the faith"?', 'Paul', ['Peter', 'Timothy', 'John']),
    mc('M', 'Matthew 27:24', 'Who washed his hands before the crowd, saying, "I am innocent of the blood of this just Person"?', 'Pilate', ['Herod', 'Caiaphas', 'Judas']),
    mc('H', 'John 1:45-46', 'Who asked, "Can anything good come out of Nazareth?"', 'Nathanael', ['Philip', 'Nicodemus', 'Thomas']),
    mc('M', '1 Samuel 17:45', 'Who said, "You come to me with a sword… but I come to you in the name of the LORD of hosts"?', 'David', ['Saul', 'Jonathan', 'Samson']),
    mc('H', 'Daniel 3:16-18', 'Who told the king, "Our God whom we serve is able to deliver us… But if not…"?', 'Shadrach, Meshach and Abednego', ['Daniel', 'Nehemiah', 'Ezra']),
  ],
};
