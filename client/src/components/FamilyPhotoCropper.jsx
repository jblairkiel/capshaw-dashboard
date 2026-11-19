import { useRef, useState } from 'react';
import { photoUrl, defaultCrop, clampCrop, cropToFile } from '../lib/photos';

// Picking one person out of the family photo: a square to drag over their face
// and resize from its corner, by mouse, finger or arrow keys. Saving crops it
// in the browser and uploads it as the person's own photo, so everywhere that
// shows their face (directory, contacts, Member Match) gets just them.
//
// The crop is a copy: replacing the family photo later leaves it as it was,
// and cropping again (or "Use the family photo") changes it.

export default function FamilyPhotoCropper({ person, onCropped, onClose, busy, saveError }) {
  const img = useRef(null);
  const frame = useRef(null);
  const drag = useRef(null);
  const [natural, setNatural] = useState(null);
  const [crop, setCrop] = useState(null);
  const [error, setError] = useState('');
  const first = person.name?.split(/\s+/)[0] || 'them';

  function loaded(e) {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    setNatural({ w, h });
    setCrop(defaultCrop(w, h));
  }

  // Screen pixels to photo pixels: the photo is drawn smaller than it is.
  const scale = () => natural.w / frame.current.getBoundingClientRect().width;

  function start(mode) {
    return e => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      drag.current = { mode, x: e.clientX, y: e.clientY, crop, k: scale() };
    };
  }

  function move(e) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.x) * d.k;
    const dy = (e.clientY - d.y) * d.k;
    const next = d.mode === 'move'
      ? { ...d.crop, x: d.crop.x + dx, y: d.crop.y + dy }
      : { ...d.crop, size: d.crop.size + Math.max(dx, dy) };
    setCrop(clampCrop(next, natural.w, natural.h));
  }

  function end() { drag.current = null; }

  function key(e) {
    if (!crop) return;
    const step = Math.max(2, Math.round(natural.w / 100)) * (e.shiftKey ? 5 : 1);
    const moves = {
      ArrowLeft:  { x: crop.x - step }, ArrowRight: { x: crop.x + step },
      ArrowUp:    { y: crop.y - step }, ArrowDown:  { y: crop.y + step },
      '+': { size: crop.size + step }, '=': { size: crop.size + step }, '-': { size: crop.size - step },
    };
    if (!moves[e.key]) return;
    e.preventDefault();
    setCrop(clampCrop({ ...crop, ...moves[e.key] }, natural.w, natural.h));
  }

  async function save() {
    setError('');
    try {
      onCropped(await cropToFile(img.current, crop, `${first.toLowerCase()}.jpg`));
    } catch (err) {
      setError(err.message);
    }
  }

  const pct = v => `${(v / (natural?.w || 1)) * 100}%`;
  const pctY = v => `${(v / (natural?.h || 1)) * 100}%`;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={`Crop ${first} from the family photo`} className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-church-navy">Crop {first} from the family photo</h3>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="overflow-y-auto p-4 space-y-3">
          <p className="text-xs text-gray-500">
            Drag the square over {first}&apos;s face and drag its corner to make it bigger or smaller.
            Arrow keys move it, and + and − resize it.
          </p>

          <div
            ref={frame}
            className="relative select-none touch-none mx-auto w-full"
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            <img
              ref={img}
              src={photoUrl(person, 'family')}
              alt={`${person.name?.split(/\s+/).at(-1) ?? ''} family`}
              onLoad={loaded}
              onError={() => setError('The family photo could not be loaded')}
              draggable={false}
              className="block w-full h-auto rounded-lg"
            />
            {crop && (
              <div
                role="slider"
                tabIndex={0}
                aria-label={`Square around ${first}`}
                aria-valuetext={`${crop.size} pixels at ${crop.x}, ${crop.y}`}
                onKeyDown={key}
                onPointerDown={start('move')}
                className="absolute cursor-move outline-none border-2 border-white rounded-md focus-visible:ring-2 focus-visible:ring-church-gold"
                style={{
                  left: pct(crop.x), top: pctY(crop.y), width: pct(crop.size), height: pctY(crop.size),
                  // Everything outside the square is dimmed.
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                }}
              >
                <span
                  aria-hidden="true"
                  onPointerDown={start('resize')}
                  className="absolute -right-2 -bottom-2 w-5 h-5 rounded-full bg-church-gold border-2 border-white cursor-nwse-resize"
                />
              </div>
            )}
          </div>
          {(error || saveError) && <p className="text-xs text-red-600">{error || saveError}</p>}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 border border-gray-200">Cancel</button>
          <button onClick={save} disabled={!crop || busy} className="btn-primary text-sm disabled:opacity-50">
            {busy ? 'Saving…' : `Use as ${first}'s photo`}
          </button>
        </div>
      </div>
    </div>
  );
}
