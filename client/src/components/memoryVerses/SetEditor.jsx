import { useState } from 'react';
import Dialog from '../Dialog';
import { DIFFICULTY_LABEL, AUDIENCE_LABEL, parsePasted } from './games';

// Making a set, or changing one: its title and how it is filed (category,
// difficulty, age group, translation, tags), and its verses in order.
// Verses can be typed one by one or pasted in a block, a reference on one
// line and its words on the next.

const field = 'mt-1 block w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-church-gold';
const label = 'text-xs font-medium text-gray-500 uppercase tracking-wide';
const blank = () => ({ reference: '', text: '' });

export default function SetEditor({ meta, set, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    title: set?.title || '',
    description: set?.description || '',
    category: set?.category || 'Christian Living',
    difficulty: set?.difficulty || 'beginner',
    audience: set?.audience || 'everyone',
    translation: set?.translation || meta.defaultTranslation,
    tags: (set?.tags || []).join(', '),
    verses: set?.verses?.length ? set.verses.map(v => ({ reference: v.reference, text: v.text })) : [blank()],
  }));
  const [paste, setPaste] = useState('');
  const [pasting, setPasting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const put = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const putVerse = (i, key, value) => setForm(f => ({ ...f, verses: f.verses.map((v, k) => (k === i ? { ...v, [key]: value } : v)) }));
  const move = (i, by) => setForm(f => {
    const verses = [...f.verses];
    const [v] = verses.splice(i, 1);
    verses.splice(Math.max(0, Math.min(verses.length, i + by)), 0, v);
    return { ...f, verses };
  });

  function addPasted() {
    const found = parsePasted(paste);
    if (!found.length) { setError('Put each reference on its own line, with the verse\'s words on the lines after it'); return; }
    setForm(f => ({ ...f, verses: [...f.verses.filter(v => v.reference || v.text), ...found] }));
    setPaste(''); setPasting(false); setError('');
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const res = await fetch(set?.id ? `/api/memory-verses/sets/${set.id}` : '/api/memory-verses/sets', {
        method: set?.id ? 'PUT' : 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, verses: form.verses.filter(v => v.reference || v.text) }),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.success) throw new Error(json.error || 'Something went wrong');
      onSaved(json.set);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Dialog title={set?.id ? `Change "${set.title}"` : 'Make a new set'} subtitle="Every member can find it in the library and practise it" onClose={onClose} width="max-w-2xl">
      <form onSubmit={save} className="space-y-4">
        <label className="block"><span className={label}>Title</span>
          <input required value={form.title} onChange={e => put('title', e.target.value)} className={field} placeholder="e.g. Verses for VBS week" />
        </label>
        <label className="block"><span className={label}>About this set</span>
          <textarea value={form.description} onChange={e => put('description', e.target.value)} rows={2} className={field} placeholder="Who it is for, or what it goes with" />
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block"><span className={label}>Category</span>
            <select value={form.category} onChange={e => put('category', e.target.value)} className={field}>
              {meta.categories.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="block"><span className={label}>Difficulty</span>
            <select value={form.difficulty} onChange={e => put('difficulty', e.target.value)} className={field}>
              {meta.difficulties.map(d => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
            </select>
          </label>
          <label className="block"><span className={label}>For</span>
            <select value={form.audience} onChange={e => put('audience', e.target.value)} className={field}>
              {meta.audiences.map(a => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
            </select>
          </label>
          <label className="block"><span className={label}>Translation</span>
            <input value={form.translation} onChange={e => put('translation', e.target.value)} className={field} list="memory-translations" />
            <datalist id="memory-translations">{['NASB 1995', 'KJV', 'NKJV', 'ESV', 'ASV', ...meta.translations].filter((t, i, all) => all.indexOf(t) === i).map(t => <option key={t} value={t} />)}</datalist>
          </label>
        </div>
        <label className="block"><span className={label}>Tags <span className="normal-case text-gray-400">(comma between, to help people find it)</span></span>
          <input value={form.tags} onChange={e => put('tags', e.target.value)} className={field} placeholder="vbs, summer, short" />
        </label>

        <fieldset className="border-0 p-0 m-0">
          <legend className={`${label} mb-1`}>Verses, in order</legend>
          <ol className="space-y-2">
            {form.verses.map((v, i) => (
              <li key={i} className="rounded-lg border border-gray-200 p-2.5 space-y-1.5" aria-label={`Verse ${i + 1}`}>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400 w-5">{i + 1}.</span>
                  <input value={v.reference} onChange={e => putVerse(i, 'reference', e.target.value)} aria-label={`Verse ${i + 1} reference`}
                    className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm" placeholder="John 3:16" />
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move verse ${i + 1} up`} className="text-gray-400 disabled:opacity-30 px-1">↑</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === form.verses.length - 1} aria-label={`Move verse ${i + 1} down`} className="text-gray-400 disabled:opacity-30 px-1">↓</button>
                  <button type="button" onClick={() => setForm(f => ({ ...f, verses: f.verses.length > 1 ? f.verses.filter((_, k) => k !== i) : [blank()] }))}
                    aria-label={`Remove verse ${i + 1}`} className="text-xs text-red-600 underline">Remove</button>
                </div>
                <textarea value={v.text} onChange={e => putVerse(i, 'text', e.target.value)} rows={2} aria-label={`Verse ${i + 1} words`}
                  className="w-full border border-gray-200 rounded px-2 py-1 text-sm" placeholder="The words of the verse, exactly as in your translation" />
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <button type="button" onClick={() => put('verses', [...form.verses, blank()])} className="text-church-navy underline">+ Add a verse</button>
            <button type="button" onClick={() => setPasting(p => !p)} className="text-church-navy underline">Paste several at once</button>
          </div>
          {pasting && (
            <div className="mt-2 space-y-2">
              <textarea value={paste} onChange={e => setPaste(e.target.value)} rows={6} aria-label="Verses to paste" className={field}
                placeholder={'John 3:16\nFor God so loved the world…\n\nRomans 3:23\nfor all have sinned…'} />
              <button type="button" onClick={addPasted} className="text-sm px-3 py-1.5 rounded-lg border border-church-gold text-church-navy">Add these verses</button>
            </div>
          )}
        </fieldset>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 rounded-lg border border-gray-200 text-gray-600">Cancel</button>
          <button type="submit" disabled={busy} className="btn-primary text-sm disabled:opacity-50">{busy ? 'Saving…' : set?.id ? 'Save changes' : 'Add to the library'}</button>
        </div>
      </form>
    </Dialog>
  );
}
