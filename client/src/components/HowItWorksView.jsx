import { useState, useEffect } from 'react';
import { call } from '../lib/groups';
import WorkflowChart from './WorkflowChart';

// ─── How It Works ──────────────────────────────────────────────────────────────
//
// The portal's documentation, written for the person using it. The words live
// on the server (server/lib/howItWorks.js), which sends each reader only what
// they may read — the admin sections never reach anybody else — and builds the
// PDF from the same sections, so the page and the download always agree.
//
// Keeping it current is a server change: see the note at the top of that file.

// "**bold** and plain" → text with <strong>s.
function Rich({ text }) {
  return String(text || '').split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part, i) =>
    part.startsWith('**')
      ? <strong key={i} className="text-church-navy">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>);
}

// Every box on a documentation chart is a real part of how it works, so they
// are all drawn as "done" rather than some looking not-yet-reached.
function Diagram({ chart }) {
  const visited = (chart.nodes || []).filter(n => n.kind === 'step').map(n => n.id);
  return <WorkflowChart chart={chart} visited={visited} legend={false} />;
}

function Block({ block }) {
  if (block.p !== undefined) return <p className="text-sm text-gray-600 leading-relaxed"><Rich text={block.p} /></p>;
  if (block.list) {
    return (
      <ul className="list-disc pl-5 space-y-1.5 text-sm text-gray-600">
        {block.list.map((item, i) => <li key={i}><Rich text={item} /></li>)}
      </ul>
    );
  }
  if (block.steps) {
    return (
      <ol className="list-decimal pl-5 space-y-1.5 text-sm text-gray-600 marker:text-church-gold marker:font-semibold">
        {block.steps.map((item, i) => <li key={i}><Rich text={item} /></li>)}
      </ol>
    );
  }
  if (block.note) {
    return (
      <p className="text-sm text-gray-700 bg-church-cream/60 border-l-4 border-church-gold rounded-r-lg px-3 py-2">
        <Rich text={block.note} />
      </p>
    );
  }
  if (block.table) {
    return (
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm border-collapse min-w-[28rem]">
          <thead>
            <tr>{block.table.head.map(h => <th key={h} className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-200 px-2 py-1.5">{h}</th>)}</tr>
          </thead>
          <tbody>
            {block.table.rows.map((row, r) => (
              <tr key={r} className="border-b border-gray-100 align-top">
                {row.map((cell, c) => (
                  <td key={c} className={`px-2 py-1.5 ${c === 0 ? 'font-medium text-church-navy whitespace-nowrap sm:whitespace-normal' : 'text-gray-600'}`}><Rich text={cell} /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.chart) return <Diagram chart={block.chart} />;
  if (block.workflow) {
    return (
      <>
        {block.intro && <p className="text-sm text-gray-600 leading-relaxed"><Rich text={block.intro} /></p>}
        <Diagram chart={block.chart} />
      </>
    );
  }
  return null;
}

const anchor = id => `how-${id}`;

function jumpTo(id) {
  document.getElementById(anchor(id))?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

function Contents({ sections }) {
  const parts = [
    ['For everyone', sections.filter(s => s.audience === 'everyone')],
    ['For admins', sections.filter(s => s.audience === 'admins')],
  ].filter(([, list]) => list.length);

  return (
    <nav className="card" aria-label="Contents">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-2">Contents</h2>
      <div className={`grid gap-4 ${parts.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {parts.map(([title, list]) => (
          <div key={title}>
            <p className="text-xs font-semibold text-church-gold uppercase tracking-wide mb-1">{title}</p>
            <ol className="space-y-1">
              {list.map(s => (
                <li key={s.id}>
                  <a href={`#${anchor(s.id)}`} onClick={e => { e.preventDefault(); jumpTo(s.id); }}
                    className="text-sm text-church-navy hover:underline">{s.title}</a>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </nav>
  );
}

export default function HowItWorksView() {
  const [data, setData]   = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    call('/api/how-it-works').then(setData).catch(e => setError(e.message));
  }, []);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-church-navy">How It Works</h1>
          <p className="text-sm text-gray-500 mt-1">
            What the portal does, where to find it, and who can change what.
          </p>
        </div>
        {data && (
          <a href="/api/how-it-works/pdf" download
            className="shrink-0 px-3 py-1.5 text-sm rounded-lg border border-church-navy text-church-navy hover:bg-church-cream">
            Download PDF
          </a>
        )}
      </div>

      {error && <div className="card text-sm text-red-600">{error}</div>}
      {!data && !error && <div className="card text-sm text-gray-400">Loading…</div>}

      {data && (
        <>
          {data.admin && (
            <p className="text-xs text-gray-500">
              You are seeing the sections for admins as well; members see only the first part, and their PDF leaves the rest out.
            </p>
          )}
          <Contents sections={data.sections} />
          {data.sections.map((s, i) => (
            <div key={s.id}>
              {s.audience === 'admins' && data.sections[i - 1]?.audience !== 'admins' && (
                <h2 className="text-xs font-semibold text-church-gold uppercase tracking-wide mb-3 mt-2">For admins</h2>
              )}
              <section id={anchor(s.id)} aria-labelledby={`${anchor(s.id)}-title`} className="card space-y-3 scroll-mt-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 id={`${anchor(s.id)}-title`} className="section-heading mb-0">{s.title}</h2>
                  {s.audience === 'admins' && <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">Admins only</span>}
                </div>
                {s.blocks.map((b, j) => <Block key={j} block={b} />)}
              </section>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
