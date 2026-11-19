import { useRef, useState } from 'react';
import PersonPhoto from './PersonPhoto';
import FamilyPhotoCropper from './FamilyPhotoCropper';
import { photoUrl } from '../lib/photos';

// Putting up and taking down photos. Two kinds, kept apart on the server:
//
//   family — one picture for everybody at the address. Changing it changes it
//            for the whole household at once.
//   own    — one person's picture. Optional: anybody without one is shown with
//            the family photo instead, everywhere faces appear.
//
// Who may use these is the server's call (routes/profile.js): the directory's
// keeper for anybody, a member for their own household.

const API = '/api/profile';

async function sendPhoto(url, { method, file }) {
  const options = { method, credentials: 'include' };
  if (file) {
    const body = new FormData();
    body.append('photo', file);
    options.body = body;
  }
  const res  = await fetch(url, options);
  const json = await res.json().catch(() => ({}));
  if (!json.success) throw new Error(json.error || 'Something went wrong');
  return json;
}

function usePhotoAction(onDone) {
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');
  async function run(url, options) {
    setBusy(true); setError('');
    try { onDone(await sendPhoto(url, options)); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return { busy, error, run };
}

function UploadButton({ label, disabled, onFile }) {
  const input = useRef(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="text-xs font-medium px-3 py-1.5 rounded-lg border border-church-gold text-church-navy hover:bg-church-gold/10 disabled:opacity-50"
      >
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        aria-label={label}
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
    </>
  );
}

function RemoveButton({ label, disabled, onClick }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
    >
      {label}
    </button>
  );
}

// ─── One person's own photo ───────────────────────────────────────────────────

export function OwnPhotoEditor({ person, canEdit, onSaved }) {
  const [cropping, setCropping] = useState(false);
  const { busy, error, run } = usePhotoAction(json => { setCropping(false); onSaved(json.person); });
  const url = `${API}/person/${person.id}/photo`;
  const first = person.name?.split(/\s+/)[0] || 'them';

  const status = person.has_own_photo
    ? 'Their own photo is shown in the directory, contacts and Member Match.'
    : person.has_family_photo
      ? `No photo of just ${first}, so the family photo is shown instead.`
      : 'No photo yet. Initials are shown instead.';

  return (
    <div className="space-y-2" role="group" aria-label={`Photo of ${person.name}`}>
      <h4 className="text-sm font-semibold text-church-navy">Photo</h4>
      <div className="flex items-center gap-3">
        <PersonPhoto person={person} size={72} />
        <div className="min-w-0 space-y-2">
          <p className="text-xs text-gray-500">{status}</p>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <UploadButton
                label={person.has_own_photo ? 'Replace photo' : `Add a photo of ${first}`}
                disabled={busy}
                onFile={file => run(url, { method: 'PUT', file })}
              />
              {person.has_family_photo && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCropping(true)}
                  className="text-xs font-medium px-3 py-1.5 rounded-lg border border-church-gold text-church-navy hover:bg-church-gold/10 disabled:opacity-50"
                >
                  Crop from family photo
                </button>
              )}
              {person.has_own_photo && (
                <RemoveButton
                  label={person.has_family_photo ? 'Use the family photo' : 'Remove photo'}
                  disabled={busy}
                  onClick={() => run(url, { method: 'DELETE' })}
                />
              )}
            </div>
          )}
        </div>
      </div>
      {busy && <p className="text-xs text-gray-400">Saving…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
      {cropping && (
        <FamilyPhotoCropper
          person={person}
          busy={busy}
          saveError={error}
          onCropped={file => run(url, { method: 'PUT', file })}
          onClose={() => setCropping(false)}
        />
      )}
    </div>
  );
}

// ─── The family photo ─────────────────────────────────────────────────────────

// A wide picture of the family, the way a family portrait is taken. `person`
// is anybody in the household: the server finds the rest by address.
export function FamilyPhoto({ person, className = '' }) {
  const [failed, setFailed] = useState(null);
  const src = person && photoUrl(person, 'family');
  if (!person?.has_family_photo || failed === src) {
    return (
      <div className={`flex items-center justify-center bg-church-navy/5 text-gray-400 text-xs ${className}`}>
        No family photo yet
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={`${person.name?.split(/\s+/).at(-1) ?? ''} family`}
      loading="lazy"
      onError={() => setFailed(src)}
      className={`object-contain bg-church-navy/5 ${className}`}
    />
  );
}

export function FamilyPhotoEditor({ person, householdSize = 1, canEdit, onSaved }) {
  const { busy, error, run } = usePhotoAction(onSaved);
  const url = `${API}/person/${person.id}/family-photo`;

  return (
    <div className="card space-y-3" role="region" aria-label="Family photo">
      <div>
        <h3 className="font-semibold text-church-navy text-sm">Family photo</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          One picture for everybody at your address{householdSize > 1 ? ` (${householdSize} people)` : ''}.
          Anyone without a photo of their own is shown with this one.
        </p>
      </div>
      <FamilyPhoto person={person} className="w-full aspect-[16/9] max-h-72 rounded-lg" />
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <UploadButton
            label={person.has_family_photo ? 'Replace family photo' : 'Add a family photo'}
            disabled={busy}
            onFile={file => run(url, { method: 'PUT', file })}
          />
          {person.has_family_photo && (
            <RemoveButton label="Remove family photo" disabled={busy} onClick={() => run(url, { method: 'DELETE' })} />
          )}
        </div>
      )}
      {busy && <p className="text-xs text-gray-400">Saving…</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
