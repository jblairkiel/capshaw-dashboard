// The Memory Verses sets every congregation starts with.
//
// Written into the database once at start-up (schema.js), each by its `slug`:
// a set already there is never touched again, so an admin's corrections stick,
// and a set added to this list later appears on the next start. Never change a
// slug — it is how a set is recognised as already there.
//
// The text is the New American Standard Bible (1995). The Lockman Foundation
// lets up to 500 verses be quoted without written permission, with the notice
// below shown wherever they are; these sets come to well under a hundred. Keep
// it that way, and check any change against a printed NASB.

const TRANSLATION = 'NASB 1995';

const NOTICE = 'Scripture quotations taken from the New American Standard Bible® (NASB), Copyright © 1960, 1962, 1963, 1968, 1971, 1972, 1973, 1975, 1977, 1995 by The Lockman Foundation. Used by permission. www.Lockman.org';

const v = (reference, text) => ({ reference, text });

const SETS = [
  {
    slug: 'first-verses',
    title: 'First Verses',
    description: 'Short, well-loved verses for the youngest classes — a good first set for anyone.',
    category: 'Christian Living', difficulty: 'beginner', audience: 'children',
    tags: ['short', 'favorites'],
    verses: [
      v('Genesis 1:1', 'In the beginning God created the heavens and the earth.'),
      v('1 John 4:19', 'We love, because He first loved us.'),
      v('Philippians 4:13', 'I can do all things through Him who strengthens me.'),
      v('Psalm 119:105', 'Your word is a lamp to my feet And a light to my path.'),
      v('Psalm 118:24', 'This is the day which the LORD has made; Let us rejoice and be glad in it.'),
      v('Ephesians 4:32', 'Be kind to one another, tender-hearted, forgiving each other, just as God in Christ also has forgiven you.'),
      v('Colossians 3:20', 'Children, be obedient to your parents in all things, for this is well-pleasing to the Lord.'),
      v('John 3:16', 'For God so loved the world, that He gave His only begotten Son, that whoever believes in Him shall not perish, but have eternal life.'),
    ],
  },
  {
    slug: 'fruit-of-the-spirit',
    title: 'Living Like Jesus',
    description: 'The fruit of the Spirit, the greatest commandments, and how a Christian treats others.',
    category: 'Christian Living', difficulty: 'intermediate', audience: 'youth',
    tags: ['character', 'commandments'],
    verses: [
      v('Galatians 5:22-23', 'But the fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faithfulness, gentleness, self-control; against such things there is no law.'),
      v('Matthew 7:12', 'In everything, therefore, treat people the same way you want them to treat you, for this is the Law and the Prophets.'),
      v('Micah 6:8', 'He has told you, O man, what is good; And what does the LORD require of you But to do justice, to love kindness, And to walk humbly with your God?'),
      v('Colossians 3:23', 'Whatever you do, do your work heartily, as for the Lord rather than for men,'),
      v('1 Timothy 4:12', 'Let no one look down on your youthfulness, but rather in speech, conduct, love, faith and purity, show yourself an example of those who believe.'),
      v('Matthew 22:37-39', 'And He said to him, "\'You shall love the Lord your God with all your heart, and with all your soul, and with all your mind.\' This is the great and foremost commandment. The second is like it, \'You shall love your neighbor as yourself.\'"'),
    ],
  },
  {
    slug: 'way-of-salvation',
    title: 'The Way of Salvation',
    description: 'What the New Testament says a person must do to be saved: hear, believe, repent, confess, be baptized, and remain faithful.',
    category: 'Salvation', difficulty: 'intermediate', audience: 'everyone',
    tags: ['plan of salvation', 'baptism', 'faith'],
    verses: [
      v('Romans 10:17', 'So faith comes from hearing, and hearing by the word of Christ.'),
      v('Hebrews 11:6', 'And without faith it is impossible to please Him, for he who comes to God must believe that He is and that He is a rewarder of those who seek Him.'),
      v('Romans 3:23', 'for all have sinned and fall short of the glory of God,'),
      v('Romans 6:23', 'For the wages of sin is death, but the free gift of God is eternal life in Christ Jesus our Lord.'),
      v('Romans 10:9-10', 'that if you confess with your mouth Jesus as Lord, and believe in your heart that God raised Him from the dead, you will be saved; for with the heart a person believes, resulting in righteousness, and with the mouth he confesses, resulting in salvation.'),
      v('Acts 2:38', 'Peter said to them, "Repent, and each of you be baptized in the name of Jesus Christ for the forgiveness of your sins; and you will receive the gift of the Holy Spirit."'),
      v('Mark 16:16', 'He who has believed and has been baptized shall be saved; but he who has disbelieved shall be condemned.'),
      v('Galatians 3:27', 'For all of you who were baptized into Christ have clothed yourselves with Christ.'),
      v('Revelation 2:10b', 'Be faithful until death, and I will give you the crown of life.'),
    ],
  },
  {
    slug: 'great-commission',
    title: 'Go Into All the World',
    description: 'The Great Commission and being ready to share the gospel.',
    category: 'Sharing the Gospel', difficulty: 'intermediate', audience: 'youth',
    tags: ['evangelism', 'great commission'],
    verses: [
      v('Mark 16:15', 'And He said to them, "Go into all the world and preach the gospel to all creation."'),
      v('Matthew 28:19-20', 'Go therefore and make disciples of all the nations, baptizing them in the name of the Father and the Son and the Holy Spirit, teaching them to observe all that I commanded you; and lo, I am with you always, even to the end of the age.'),
      v('Romans 1:16', 'For I am not ashamed of the gospel, for it is the power of God for salvation to everyone who believes, to the Jew first and also to the Greek.'),
      v('Matthew 5:16', 'Let your light shine before men in such a way that they may see your good works, and glorify your Father who is in heaven.'),
      v('1 Peter 3:15', 'but sanctify Christ as Lord in your hearts, always being ready to make a defense to everyone who asks you to give an account for the hope that is in you, yet with gentleness and reverence;'),
    ],
  },
  {
    slug: 'the-lords-church',
    title: 'The Lord\'s Church',
    description: 'The church Jesus built: its foundation, its head, its oneness, and what it devoted itself to.',
    category: 'The Church', difficulty: 'intermediate', audience: 'adults',
    tags: ['church', 'unity'],
    verses: [
      v('Matthew 16:18', 'I also say to you that you are Peter, and upon this rock I will build My church; and the gates of Hades will not overpower it.'),
      v('Acts 2:42', 'They were continually devoting themselves to the apostles\' teaching and to fellowship, to the breaking of bread and to prayer.'),
      v('Romans 16:16', 'Greet one another with a holy kiss. All the churches of Christ greet you.'),
      v('Colossians 1:18', 'He is also head of the body, the church; and He is the beginning, the firstborn from the dead, so that He Himself will come to have first place in everything.'),
      v('Acts 20:28', 'Be on guard for yourselves and for all the flock, among which the Holy Spirit has made you overseers, to shepherd the church of God which He purchased with His own blood.'),
      v('Ephesians 4:4-6', 'There is one body and one Spirit, just as also you were called in one hope of your calling; one Lord, one faith, one baptism, one God and Father of all who is over all and through all and in all.'),
    ],
  },
  {
    slug: 'spirit-and-truth',
    title: 'In Spirit and Truth',
    description: 'Worship as the New Testament describes it: singing, the Lord\'s Supper, and assembling together.',
    category: 'Worship', difficulty: 'intermediate', audience: 'everyone',
    tags: ['singing', 'lord\'s supper', 'assembly'],
    verses: [
      v('John 4:24', 'God is spirit, and those who worship Him must worship in spirit and truth.'),
      v('Ephesians 5:19', 'speaking to one another in psalms and hymns and spiritual songs, singing and making melody with your heart to the Lord;'),
      v('Colossians 3:16', 'Let the word of Christ richly dwell within you, with all wisdom teaching and admonishing one another with psalms and hymns and spiritual songs, singing with thankfulness in your hearts to God.'),
      v('Acts 20:7', 'On the first day of the week, when we were gathered together to break bread, Paul began talking to them, intending to leave the next day, and he prolonged his message until midnight.'),
      v('1 Corinthians 11:26', 'For as often as you eat this bread and drink the cup, you proclaim the Lord\'s death until He comes.'),
      v('Hebrews 10:24-25', 'and let us consider how to stimulate one another to love and good deeds, not forsaking our own assembling together, as is the habit of some, but encouraging one another; and all the more as you see the day drawing near.'),
    ],
  },
  {
    slug: 'teach-us-to-pray',
    title: 'Teach Us to Pray',
    description: 'The Lord\'s model prayer, verse by verse, and what Paul and James teach about prayer.',
    category: 'Prayer', difficulty: 'intermediate', audience: 'everyone',
    tags: ['lord\'s prayer', 'sermon on the mount'],
    verses: [
      v('Matthew 6:9', 'Pray, then, in this way: \'Our Father who is in heaven, Hallowed be Your name.'),
      v('Matthew 6:10', 'Your kingdom come. Your will be done, On earth as it is in heaven.'),
      v('Matthew 6:11', 'Give us this day our daily bread.'),
      v('Matthew 6:12', 'And forgive us our debts, as we also have forgiven our debtors.'),
      v('Matthew 6:13', 'And do not lead us into temptation, but deliver us from evil. For Yours is the kingdom and the power and the glory forever. Amen.\''),
      v('1 Thessalonians 5:16-18', 'Rejoice always; pray without ceasing; in everything give thanks; for this is God\'s will for you in Christ Jesus.'),
      v('Philippians 4:6-7', 'Be anxious for nothing, but in everything by prayer and supplication with thanksgiving let your requests be made known to God. And the peace of God, which surpasses all comprehension, will guard your hearts and your minds in Christ Jesus.'),
      v('James 5:16b', 'The effective prayer of a righteous man can accomplish much.'),
    ],
  },
  {
    slug: 'psalm-23',
    title: 'Psalm 23',
    description: 'The Shepherd Psalm, the whole of it — six verses to learn as one passage.',
    category: 'Psalms & Wisdom', difficulty: 'intermediate', audience: 'everyone',
    tags: ['psalms', 'whole passage', 'comfort'],
    verses: [
      v('Psalm 23:1', 'The LORD is my shepherd, I shall not want.'),
      v('Psalm 23:2', 'He makes me lie down in green pastures; He leads me beside quiet waters.'),
      v('Psalm 23:3', 'He restores my soul; He guides me in the paths of righteousness For His name\'s sake.'),
      v('Psalm 23:4', 'Even though I walk through the valley of the shadow of death, I fear no evil, for You are with me; Your rod and Your staff, they comfort me.'),
      v('Psalm 23:5', 'You prepare a table before me in the presence of my enemies; You have anointed my head with oil; My cup overflows.'),
      v('Psalm 23:6', 'Surely goodness and lovingkindness will follow me all the days of my life, And I will dwell in the house of the LORD forever.'),
    ],
  },
  {
    slug: 'proverbs',
    title: 'Wisdom from Proverbs',
    description: 'Short sayings about trusting God, speaking gently, and choosing friends.',
    category: 'Psalms & Wisdom', difficulty: 'beginner', audience: 'youth',
    tags: ['proverbs', 'wisdom', 'short'],
    verses: [
      v('Proverbs 1:7', 'The fear of the LORD is the beginning of knowledge; Fools despise wisdom and instruction.'),
      v('Proverbs 3:5-6', 'Trust in the LORD with all your heart And do not lean on your own understanding. In all your ways acknowledge Him, And He will make your paths straight.'),
      v('Proverbs 15:1', 'A gentle answer turns away wrath, But a harsh word stirs up anger.'),
      v('Proverbs 16:3', 'Commit your works to the LORD And your plans will be established.'),
      v('Proverbs 27:17', 'Iron sharpens iron, So one man sharpens another.'),
      v('Proverbs 22:6', 'Train up a child in the way he should go, Even when he is old he will not depart from it.'),
    ],
  },
  {
    slug: 'word-of-god',
    title: 'The Word of God',
    description: 'What the Bible says about itself: inspired, living, lasting, and worth hiding in your heart.',
    category: 'Scripture', difficulty: 'intermediate', audience: 'youth',
    tags: ['inspiration', 'bible study'],
    verses: [
      v('Psalm 119:11', 'Your word I have treasured in my heart, That I may not sin against You.'),
      v('Isaiah 40:8', 'The grass withers, the flower fades, But the word of our God stands forever.'),
      v('2 Timothy 3:16-17', 'All Scripture is inspired by God and profitable for teaching, for reproof, for correction, for training in righteousness; so that the man of God may be adequate, equipped for every good work.'),
      v('2 Timothy 2:15', 'Be diligent to present yourself approved to God as a workman who does not need to be ashamed, accurately handling the word of truth.'),
      v('Romans 15:4', 'For whatever was written in earlier times was written for our instruction, so that through perseverance and the encouragement of the Scriptures we might have hope.'),
      v('Hebrews 4:12', 'For the word of God is living and active and sharper than any two-edged sword, and piercing as far as the division of soul and spirit, of both joints and marrow, and able to judge the thoughts and intentions of the heart.'),
    ],
  },
  {
    slug: 'comfort-in-hard-times',
    title: 'Comfort in Hard Times',
    description: 'Promises to hold on to through worry, grief and illness.',
    category: 'Comfort & Hope', difficulty: 'intermediate', audience: 'adults',
    tags: ['comfort', 'hope', 'anxiety'],
    verses: [
      v('Psalm 46:1', 'God is our refuge and strength, A very present help in trouble.'),
      v('1 Peter 5:7', 'casting all your anxiety on Him, because He cares for you.'),
      v('Matthew 11:28', 'Come to Me, all who are weary and heavy-laden, and I will give you rest.'),
      v('John 14:1', 'Do not let your heart be troubled; believe in God, believe also in Me.'),
      v('Romans 8:28', 'And we know that God causes all things to work together for good to those who love God, to those who are called according to His purpose.'),
      v('2 Corinthians 4:17', 'For momentary, light affliction is producing for us an eternal weight of glory far beyond all comparison,'),
      v('Isaiah 41:10', 'Do not fear, for I am with you; Do not anxiously look about you, for I am your God. I will strengthen you, surely I will help you, Surely I will uphold you with My righteous right hand.'),
    ],
  },
  {
    slug: 'old-testament-favorites',
    title: 'Old Testament Favorites',
    description: 'Great verses from the Law, the history books, the prophets and the wisdom books.',
    category: 'Old Testament', difficulty: 'intermediate', audience: 'everyone',
    tags: ['law', 'prophets', 'history'],
    verses: [
      v('Deuteronomy 6:4-5', 'Hear, O Israel! The LORD is our God, the LORD is one! You shall love the LORD your God with all your heart and with all your soul and with all your might.'),
      v('Joshua 1:9', 'Have I not commanded you? Be strong and courageous! Do not tremble or be dismayed, for the LORD your God is with you wherever you go.'),
      v('Joshua 24:15b', 'but as for me and my house, we will serve the LORD.'),
      v('Lamentations 3:22-23', 'The LORD\'S lovingkindnesses indeed never cease, For His compassions never fail. They are new every morning; Great is Your faithfulness.'),
      v('Ecclesiastes 12:13', 'The conclusion, when all has been heard, is: fear God and keep His commandments, because this applies to every person.'),
      v('Isaiah 53:5', 'But He was pierced through for our transgressions, He was crushed for our iniquities; The chastening for our well-being fell upon Him, And by His scourging we are healed.'),
    ],
  },
  {
    slug: 'beatitudes',
    title: 'The Beatitudes',
    description: 'The opening of the Sermon on the Mount, Matthew 5:3-12 — ten verses to learn in order.',
    category: 'Life of Christ', difficulty: 'advanced', audience: 'everyone',
    tags: ['sermon on the mount', 'whole passage'],
    verses: [
      v('Matthew 5:3', 'Blessed are the poor in spirit, for theirs is the kingdom of heaven.'),
      v('Matthew 5:4', 'Blessed are those who mourn, for they shall be comforted.'),
      v('Matthew 5:5', 'Blessed are the gentle, for they shall inherit the earth.'),
      v('Matthew 5:6', 'Blessed are those who hunger and thirst for righteousness, for they shall be satisfied.'),
      v('Matthew 5:7', 'Blessed are the merciful, for they shall receive mercy.'),
      v('Matthew 5:8', 'Blessed are the pure in heart, for they shall see God.'),
      v('Matthew 5:9', 'Blessed are the peacemakers, for they shall be called sons of God.'),
      v('Matthew 5:10', 'Blessed are those who have been persecuted for the sake of righteousness, for theirs is the kingdom of heaven.'),
      v('Matthew 5:11', 'Blessed are you when people insult you and persecute you, and falsely say all kinds of evil against you because of Me.'),
      v('Matthew 5:12', 'Rejoice and be glad, for your reward in heaven is great; for in the same way they persecuted the prophets who were before you.'),
    ],
  },
  {
    slug: 'love-chapter',
    title: 'Love Is Patient',
    description: 'What love is and is not, from 1 Corinthians 13 — a passage to learn as a whole.',
    category: 'Christian Living', difficulty: 'advanced', audience: 'adults',
    tags: ['love', 'whole passage'],
    verses: [
      v('1 Corinthians 13:4', 'Love is patient, love is kind and is not jealous; love does not brag and is not arrogant,'),
      v('1 Corinthians 13:5', 'does not act unbecomingly; it does not seek its own, is not provoked, does not take into account a wrong suffered,'),
      v('1 Corinthians 13:6', 'does not rejoice in unrighteousness, but rejoices with the truth;'),
      v('1 Corinthians 13:7', 'bears all things, believes all things, hopes all things, endures all things.'),
      v('1 Corinthians 13:8a', 'Love never fails;'),
    ],
  },
];

module.exports = { SETS, TRANSLATION, NOTICE };
