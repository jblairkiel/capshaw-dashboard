import { useState } from 'react';
import QuestionGenerator from './QuestionGenerator';
import QuestionLibrary from './QuestionLibrary';
import LessonPlanner from './LessonPlanner';
import StadiumGame from './StadiumGame';

// ─── App registry ─────────────────────────────────────────────────────────────

const APPS = [
  {
    id:          'question-generator',
    title:       'Question Generator',
    description: 'Generate age-appropriate comprehension, application, and discussion questions from any Bible passage.',
    component:   QuestionGenerator,
    available:   true,
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    id:          'question-library',
    title:       'Question Library',
    description: 'Browse, search, and reuse saved question sets by passage or grade level.',
    component:   QuestionLibrary,
    available:   true,
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
      </svg>
    ),
  },
  {
    id:          'lesson-planner',
    title:       'Lesson Planner',
    description: 'Build a structured lesson plan — objectives, activities, and discussion points — around any scripture.',
    component:   LessonPlanner,
    available:   true,
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
      </svg>
    ),
  },
  {
    id:          'memory-verse',
    title:       'Memory Verse Helper',
    description: 'Activities, fill-in-the-blank worksheets, and tips to help students memorize scripture.',
    available:   false,
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
  {
    id:          'trivia-builder',
    title:       'Bible Trivia Builder',
    description: 'Create a ready-to-play trivia game from a book, chapter, or topic for class review.',
    available:   false,
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    ),
  },
  {
    id:          'stadium-game',
    title:       'Bible Bowl Stadium',
    description: 'Race your team around the stadium by answering Bible trivia! First to 3 laps wins.',
    component:   StadiumGame,
    available:   true,
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
          d="M3 12l9-9 9 9M5 10v9a1 1 0 001 1h4v-5h4v5h4a1 1 0 001-1v-9" />
      </svg>
    ),
  },
];

// ─── Tile ─────────────────────────────────────────────────────────────────────

function AppTile({ app, onOpen }) {
  return (
    <div
      onClick={() => app.available && onOpen()}
      className={`card flex flex-col gap-4 transition-all duration-150 ${
        app.available
          ? 'cursor-pointer hover:shadow-lg hover:-translate-y-0.5 hover:border-church-gold/60 active:translate-y-0'
          : 'opacity-55 cursor-default'
      }`}
    >
      {/* Icon */}
      <div className="w-12 h-12 rounded-xl bg-church-navy flex items-center justify-center text-church-gold">
        {app.icon}
      </div>

      {/* Text */}
      <div className="flex-1">
        <h3 className="font-semibold text-church-navy">{app.title}</h3>
        <p className="text-sm text-gray-500 mt-1 leading-relaxed">{app.description}</p>
      </div>

      {/* CTA */}
      {app.available ? (
        <div className="flex">
          <span className="btn-primary text-sm px-4 py-1.5 pointer-events-none">Open</span>
        </div>
      ) : (
        <span className="text-xs text-gray-400 border border-gray-200 rounded-lg px-3 py-1.5 self-start">
          Coming Soon
        </span>
      )}
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function BibleClassView({ user }) {
  const [activeId, setActiveId] = useState(null);
  const activeApp = APPS.find(a => a.id === activeId);

  if (activeApp) {
    const Component = activeApp.component;
    return (
      <div className="space-y-4">
        {/* Breadcrumb / back */}
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setActiveId(null)}
            className="flex items-center gap-1 text-church-navy hover:text-church-gold transition-colors font-medium"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Bible Class Apps
          </button>
          <span className="text-gray-300">/</span>
          <span className="text-gray-500">{activeApp.title}</span>
        </div>

        <Component user={user} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h2 className="section-heading mb-0">Bible Class Apps</h2>
        <p className="text-sm text-gray-400 hidden sm:block">Powered by AI</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {APPS.map(app => (
          <AppTile key={app.id} app={app} onOpen={() => setActiveId(app.id)} />
        ))}
      </div>
    </div>
  );
}
