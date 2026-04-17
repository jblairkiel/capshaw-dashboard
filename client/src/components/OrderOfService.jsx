import { useState, useRef } from 'react';
import axios from 'axios';

const API = '/api';

export default function OrderOfService() {
  const [docList, setDocList]       = useState([]);
  const [currentDoc, setCurrentDoc] = useState(null);
  const [html, setHtml]             = useState('');
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [listLoaded, setListLoaded] = useState(false);
  const fileRef = useRef();

  async function loadDocList() {
    try {
      const { data } = await axios.get(`${API}/documents`);
      setDocList(data.files || []);
      setListLoaded(true);
    } catch {
      setError('Could not load document list.');
    }
  }

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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
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
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-center">Upload or select a Word document<br />to view the Order of Service</p>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-church-gold"></div>
            </div>
          )}
          {html && !loading && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="section-heading mb-0">
                  {currentDoc?.replace(/^\d+-/, '') || 'Order of Service'}
                </h2>
                <button onClick={() => window.print()} className="btn-gold text-sm">
                  Print
                </button>
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
  );
}
