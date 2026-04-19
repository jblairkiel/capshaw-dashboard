import { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = '/api';

// ─── Presentation overlay ─────────────────────────────────────────────────────

function PresentationMode({ html, title, onClose }) {
  // Escape key exits
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Request native fullscreen; silently ignore if blocked
  useEffect(() => {
    document.documentElement.requestFullscreen?.().catch(() => {});
    return () => {
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, []);

  const displayTitle = title
    ?.replace(/^\d+-/, '')
    .replace(/\.[^.]+$/, '')
    .replace(/_/g, ' ') || 'Order of Service';

  return (
    <div className="fixed inset-0 z-50 overflow-auto flex flex-col" style={{ backgroundColor: '#f9f6f0' }}>

      {/* Top bar */}
      <div className="bg-church-navy sticky top-0 z-10 px-6 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"
            className="w-6 h-6 text-church-gold shrink-0">
            <path d="M11 2h2v7h7v2h-7v11h-2V11H4V9h7V2z" />
          </svg>
          <div>
            <p className="text-church-gold text-xs tracking-widest uppercase font-medium leading-none">
              Capshaw Church of Christ
            </p>
            <p className="text-white font-serif font-semibold text-base leading-tight mt-0.5">
              {displayTitle}
            </p>
          </div>
        </div>
      </div>

      {/* Document content */}
      <div className="flex-1 flex justify-center px-4 py-8 sm:py-12">
        <div
          className="presentation-content w-full max-w-3xl"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

    </div>
  );
}

// ─── Job-assignment helpers ───────────────────────────────────────────────────

const JOB_TERM_OVERRIDES = {
  Communion: ['communion', 'lord', 'supper'],
  Usher:     ['usher'],
  Visuals:   ['visual', 'powerpoint', 'slides'],
  Speaker:   ['sermon', 'speaker', 'message'],
  Sermon:    ['sermon', 'speaker', 'message'],
};

function jobTerms(name) {
  return JOB_TERM_OVERRIDES[name]
    ?? name.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
}

function groupJobs(assignments) {
  const map = new Map();
  for (const a of assignments) {
    let key = a.job;
    if (/^communion/i.test(key)) key = 'Communion';
    else if (/^usher/i.test(key))   key = 'Usher';
    else if (/^visual/i.test(key))  key = 'Visuals';
    if (!map.has(key)) map.set(key, { terms: jobTerms(key), names: [] });
    map.get(key).names.push(a.name);
  }
  return [...map.values()];
}

function fuzzyScore(terms, text) {
  const t = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  return terms.filter(w => t.includes(w)).length / terms.length;
}

const _MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function nearestSundayDate(ja) {
  const [mon, yr] = ja.month.split(' ');
  const mi = _MONTHS.indexOf(mon);
  if (mi < 0) return null;
  const today = new Date();
  const sundays = [...new Set(
    ja.assignments.filter(a => a.service === 'Sunday Worship').map(a => a.date)
  )];
  let best = null, bestDiff = Infinity;
  for (const ds of sundays) {
    const day = parseInt(ds.match(/(\d+)\s*$/)?.[1] ?? 0);
    if (!day) continue;
    const diff = Math.abs(new Date(parseInt(yr), mi, day) - today);
    if (diff < bestDiff) { bestDiff = diff; best = ds; }
  }
  return best;
}

function applyAssignments(htmlString, groups) {
  const doc = new DOMParser().parseFromString(htmlString, 'text/html');
  const els = [...doc.querySelectorAll('p, li, td, h1, h2, h3, h4, h5')]
    .filter(el => el.textContent.trim().length >= 3);
  const used = new Set();
  let hits = 0;
  for (const g of groups) {
    let best = null, top = 0;
    for (const el of els) {
      if (used.has(el)) continue;
      const s = fuzzyScore(g.terms, el.textContent);
      if (s > top) { top = s; best = el; }
    }
    if (best && top >= 0.5) {
      used.add(best); hits++;
      const sp = doc.createElement('span');
      sp.dataset.jobAssignment = '';
      sp.style.cssText = 'color:#1a2744;font-weight:600;margin-left:.5em;font-style:normal';
      sp.textContent = '\u2014 ' + g.names.join(', ');
      best.appendChild(sp);
    }
  }
  return { html: doc.body.innerHTML, hits, total: groups.length };
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OrderOfService() {
  const [docList, setDocList]         = useState([]);
  const [currentDoc, setCurrentDoc]   = useState(null);
  const [html, setHtml]               = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [listLoaded, setListLoaded]   = useState(false);
  const [presenting,   setPresenting]   = useState(false);
  const [annotated,    setAnnotated]    = useState('');
  const [annotating,   setAnnotating]   = useState(false);
  const [annotateInfo, setAnnotateInfo] = useState('');
  const fileRef = useRef();

  useEffect(() => { setAnnotated(''); setAnnotateInfo(''); }, [html]);

  async function handleAssignJobs() {
    setAnnotating(true);
    setAnnotateInfo('');
    try {
      const { data } = await axios.get('/api/members/data');
      const ja = data.data.jobAssignments;
      const dateStr = nearestSundayDate(ja);
      if (!dateStr) { setAnnotateInfo('No Sunday Worship assignments found.'); return; }
      const forService = ja.assignments.filter(
        a => (a.date === dateStr && a.service === 'Sunday Worship') || a.service === 'All Month'
      );
      const groups = groupJobs(forService);
      const { html: newHtml, hits, total } = applyAssignments(html, groups);
      setAnnotated(newHtml);
      setAnnotateInfo(`${dateStr} \u00b7 ${hits}/${total} matched`);
    } catch {
      setAnnotateInfo('Could not load assignments.');
    } finally {
      setAnnotating(false);
    }
  }

  const loadDocList = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/documents`);
      setDocList(data.files || []);
      setListLoaded(true);
    } catch {
      setError('Could not load document list.');
    }
  }, []);

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setLoading(true);
    setError('');
    try {
      const form = new FormData();
      form.append('document', file);
      const { data } = await axios.post(`${API}/documents/upload`, form);
      if (data.success) {
        setCurrentDoc(data.filename);
        setHtml(data.html);
        loadDocList();
      } else {
        setError(data.error || 'Upload failed');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Upload error');
    } finally {
      setLoading(false);
      fileRef.current.value = '';
    }
  }

  async function handleOpenDoc(filename) {
    setLoading(true);
    setError('');
    try {
      const { data } = await axios.get(`${API}/documents/${filename}`);
      if (data.success) {
        setCurrentDoc(data.filename);
        setHtml(data.html);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not open document');
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(filename) {
    if (!confirm('Delete this document?')) return;
    try {
      await axios.delete(`${API}/documents/${filename}`);
      if (currentDoc === filename) { setCurrentDoc(null); setHtml(''); }
      loadDocList();
    } catch {
      setError('Delete failed');
    }
  }

  const displayName = currentDoc?.replace(/^\d+-/, '').replace(/\.[^.]+$/, '').replace(/_/g, ' ')
    || 'Order of Service';

  return (
    <>
      {presenting && (
        <PresentationMode
          html={annotated || html}
          title={currentDoc}
          onClose={() => setPresenting(false)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">

        {/* Sidebar */}
        <aside className="lg:col-span-1 space-y-4">
          <div className="card">
            <h2 className="section-heading">Upload Document</h2>
            <p className="text-sm text-gray-500 mb-3">
              Upload a Word (.docx) file for the Order of Service.
            </p>
            <label className="block">
              <span className="sr-only">Choose file</span>
              <input
                ref={fileRef}
                type="file"
                accept=".docx,.doc"
                onChange={handleUpload}
                className="block w-full text-sm text-gray-600
                  file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0
                  file:text-sm file:bg-church-navy file:text-white
                  hover:file:bg-opacity-90 cursor-pointer"
              />
            </label>
            {loading && <p className="text-sm text-church-gold mt-2 animate-pulse">Processing...</p>}
            {error   && <p className="text-sm text-red-600 mt-2">{error}</p>}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h2 className="section-heading mb-0">Saved Docs</h2>
              <button onClick={loadDocList} className="text-xs text-church-navy hover:underline">
                {listLoaded ? 'Refresh' : 'Load'}
              </button>
            </div>
            {!listLoaded && (
              <p className="text-sm text-gray-400">Click &quot;Load&quot; to see saved documents.</p>
            )}
            {listLoaded && docList.length === 0 && (
              <p className="text-sm text-gray-400">No documents uploaded yet.</p>
            )}
            <ul className="space-y-2">
              {docList.map((f) => (
                <li key={f.filename} className="flex items-start justify-between gap-2 text-sm">
                  <button
                    onClick={() => handleOpenDoc(f.filename)}
                    className={`text-left truncate hover:text-church-gold transition-colors ${
                      currentDoc === f.filename ? 'text-church-gold font-medium' : 'text-church-navy'
                    }`}
                    title={f.displayName}
                  >
                    {f.displayName}
                  </button>
                  <button
                    onClick={() => handleDelete(f.filename)}
                    className="flex-shrink-0 text-red-400 hover:text-red-600 text-xs"
                    title="Delete"
                  >
                    &#x2715;
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        {/* Document Viewer */}
        <section className="lg:col-span-3">
          <div className="card min-h-[500px]">
            {!html && !loading && (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-center">Upload or select a Word document<br />to view the Order of Service</p>
              </div>
            )}
            {loading && (
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-church-gold" />
              </div>
            )}
            {html && !loading && (
              <>
                <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                  <h2 className="section-heading mb-0 min-w-0 truncate">{displayName}</h2>
                  <div className="flex items-start gap-2 shrink-0 flex-wrap justify-end">
                    {!annotated ? (
                      <button
                        onClick={handleAssignJobs}
                        disabled={annotating}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-church-navy hover:border-church-gold hover:text-church-gold transition-colors disabled:opacity-50"
                      >
                        {annotating
                          ? <span className="animate-spin inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
                          : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        }
                        {annotating ? 'Assigning\u2026' : 'Assign Jobs'}
                      </button>
                    ) : (
                      <div className="flex flex-col items-end gap-0.5">
                        <button
                          onClick={() => { setAnnotated(''); setAnnotateInfo(''); }}
                          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-500 hover:border-red-300 hover:text-red-500 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Clear
                        </button>
                        {annotateInfo && <p className="text-xs text-gray-400">{annotateInfo}</p>}
                      </div>
                    )}
                    <button
                      onClick={() => setPresenting(true)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-church-navy text-church-gold border border-church-gold/40 hover:bg-church-gold hover:text-church-navy transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Present
                    </button>
                    <button onClick={() => window.print()} className="btn-gold text-sm">
                      Print
                    </button>
                  </div>
                </div>
                <div
                  className="docx-content prose max-w-none"
                  dangerouslySetInnerHTML={{ __html: annotated || html }}
                />
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
