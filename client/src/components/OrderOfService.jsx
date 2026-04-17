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
    <div className="fixed inset-0 z-50 overflow-auto bg-church-cream flex flex-col">

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
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/20 text-gray-300 hover:text-white hover:border-white/50 text-sm transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="hidden sm:inline">Exit</span>
        </button>
      </div>

      {/* Document content */}
      <div className="flex-1 flex justify-center px-4 py-8 sm:py-12">
        <div
          className="presentation-content w-full max-w-3xl"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>

      {/* Footer */}
      <div className="bg-church-navy/10 border-t border-church-gold/20 text-center py-2">
        <p className="text-xs text-gray-400">Press <kbd className="px-1.5 py-0.5 bg-gray-200 rounded text-gray-600 text-xs font-mono">Esc</kbd> to exit</p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function OrderOfService() {
  const [docList, setDocList]         = useState([]);
  const [currentDoc, setCurrentDoc]   = useState(null);
  const [html, setHtml]               = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState('');
  const [listLoaded, setListLoaded]   = useState(false);
  const [presenting, setPresenting]   = useState(false);
  const fileRef = useRef();

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
          html={html}
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
                  <div className="flex gap-2 shrink-0">
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
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
