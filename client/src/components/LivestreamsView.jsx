import { useState, useEffect, useCallback } from 'react';

const API = '/api/livestreams';

function when(published) {
  if (!published) return '';
  const d = new Date(published);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function VideoCard({ video }) {
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className="card p-0 overflow-hidden flex flex-col hover:shadow-lg transition-shadow group"
    >
      <div className="relative bg-church-navy aspect-video overflow-hidden">
        {video.thumbnail && (
          <img
            src={video.thumbnail}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform"
          />
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="w-12 h-12 rounded-full bg-black/55 flex items-center justify-center">
            <svg className="w-5 h-5 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </span>
      </div>
      <div className="p-4 flex-1">
        <p className="font-medium text-church-navy leading-snug">{video.title}</p>
        <p className="text-xs text-gray-400 mt-1">
          {when(video.published)}
          {video.views !== null && video.views !== undefined && (
            <> · {video.views.toLocaleString()} view{video.views === 1 ? '' : 's'}</>
          )}
        </p>
      </div>
    </a>
  );
}

// Sermons used to be a table scraped off the church website. They are streamed
// now, so this page is the channel itself: the most recent services, newest
// first, each one a click away from playing on YouTube.
export default function LivestreamsView() {
  const [state, setState] = useState({ loading: true, videos: [], channel: null, warning: '', error: '' });

  const load = useCallback(async (refresh = false) => {
    setState(s => ({ ...s, loading: true, error: '' }));
    try {
      const res = await fetch(`${API}${refresh ? '?refresh=1' : ''}`, { credentials: 'include' });
      const j   = await res.json();
      if (!j.success) throw new Error(j.error || 'Could not load the channel');
      setState({ loading: false, videos: j.videos || [], channel: j.channel, warning: j.warning || '', error: '' });
    } catch (err) {
      setState(s => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { loading, videos, channel, warning, error } = state;
  const channelUrl = channel?.url || 'https://www.youtube.com/@CapshawChurch';

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="section-heading mb-1">Recent Livestreams</h2>
          <p className="text-sm text-gray-500">Every service, streamed on our YouTube channel.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="px-3 py-2 rounded-lg text-sm font-medium border border-gray-300 text-gray-600 hover:border-church-navy hover:text-church-navy transition-colors disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <a
            href={channelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary text-sm inline-flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 00.5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 002.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 002.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z" />
            </svg>
            Watch on YouTube
          </a>
        </div>
      </div>

      {error && (
        <div className="card border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      )}

      {loading && !videos.length && (
        <div className="card flex items-center justify-center h-48 text-gray-400">Loading the channel…</div>
      )}

      {!loading && videos.length === 0 && (
        <div className="card text-center py-12 space-y-2">
          <p className="text-church-navy font-medium">Nothing to show here just yet.</p>
          <p className="text-sm text-gray-500">
            {warning
              ? 'We could not reach YouTube — the channel itself is still there.'
              : 'The latest services are always on the channel.'}
          </p>
          <a href={channelUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-church-navy underline">
            youtube.com/@CapshawChurch
          </a>
        </div>
      )}

      {videos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {videos.map(v => <VideoCard key={v.id} video={v} />)}
        </div>
      )}
    </div>
  );
}
