import { useState, useEffect, useCallback, useRef } from 'react';
import { searchSongs, addToQueue, getQueue, type Song, type QueueItem } from '../api';
import { getUserId, getUserName, setUserName } from '../utils';
import { useWebSocket } from '../hooks/useWebSocket';

const SOURCE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'netease', label: '网易云' },
  { value: 'joox', label: 'JOOX' },
];

interface PlaybackData {
  position: number;
  duration: number;
  song: Song | null;
  isPaused: boolean;
  receivedAt: number;
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Guest() {
  const [query, setQuery] = useState('');
  const [source, setSource] = useState('all');
  const [results, setResults] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [name, setName] = useState(getUserName());
  const [toast, setToast] = useState('');
  const [playback, setPlayback] = useState<PlaybackData | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const posTextRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    getQueue().then(setQueue).catch(() => {});
  }, []);

  const handleWs = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'queue_update') {
      setQueue(msg.data as QueueItem[]);
    } else if (msg.type === 'playback_position') {
      const d = msg.data as { position: number; duration: number; song: Song | null; isPaused: boolean };
      setPlayback({ ...d, receivedAt: performance.now() });
    }
  }, []);
  useWebSocket(handleWs);

  function showToast(text: string) {
    setToast(text);
    setTimeout(() => setToast(''), 2000);
  }

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await searchSongs(query.trim(), source === 'all' ? undefined : source);
      setResults(res.songs ?? []);
    } catch {
      showToast('搜索失败');
    }
    setSearching(false);
  }

  async function handleRequest(song: Song) {
    if (name) setUserName(name);
    try {
      await addToQueue(song, getUserId(), name || undefined);
      showToast(`已点歌：${song.title}`);
    } catch {
      showToast('点歌失败');
    }
  }

  // Animate progress bar between server updates
  useEffect(() => {
    cancelAnimationFrame(rafRef.current);

    if (!playback?.song || playback.isPaused) {
      if (progressRef.current && playback) {
        const ratio = playback.duration > 0 ? Math.min(playback.position / playback.duration, 1) : 0;
        progressRef.current.style.width = `${ratio * 100}%`;
      }
      if (posTextRef.current && playback) {
        posTextRef.current.textContent = formatTime(playback.position);
      }
      return;
    }

    function tick() {
      if (!playback?.song || playback.isPaused) return;
      const elapsed = (performance.now() - playback.receivedAt) / 1000;
      const pos = Math.min(playback.position + elapsed, playback.duration);
      const ratio = playback.duration > 0 ? pos / playback.duration : 0;
      if (progressRef.current) {
        progressRef.current.style.width = `${ratio * 100}%`;
      }
      if (posTextRef.current) {
        posTextRef.current.textContent = formatTime(pos);
      }
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playback]);

  return (
    <div className="max-w-2xl mx-auto p-4">
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-lg z-50 text-sm">
          {toast}
        </div>
      )}

      <div className="mb-4">
        <input
          type="text"
          placeholder="你的昵称（选填）"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-sm mb-3"
        />
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="搜索歌曲、歌手..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-2"
          />
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm"
          >
            {SOURCE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <button
            onClick={handleSearch}
            disabled={searching}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-4 py-2 rounded-lg font-medium"
          >
            {searching ? '...' : '搜索'}
          </button>
        </div>
      </div>

      {playback?.song && (
        <div className="mb-4 bg-slate-800 rounded-lg p-3 border border-slate-700">
          <div className="flex items-center gap-3 mb-2">
            {playback.song.imgUrl ? (
              <img src={playback.song.imgUrl} alt="" className="w-10 h-10 rounded object-cover" />
            ) : (
              <div className="w-10 h-10 rounded bg-slate-700 flex items-center justify-center text-slate-500">♪</div>
            )}
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium text-sm">{playback.song.title}</div>
              <div className="truncate text-xs text-slate-400">{playback.song.artist}</div>
            </div>
            <span className="text-xs text-slate-500">{playback.isPaused ? '⏸' : '▶'}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span ref={posTextRef} className="w-10 text-right tabular-nums">{formatTime(playback.position)}</span>
            <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
              <div ref={progressRef} className="h-full bg-purple-500 rounded-full" style={{ width: `${playback.duration > 0 ? Math.min(playback.position / playback.duration, 1) * 100 : 0}%` }} />
            </div>
            <span className="w-10 tabular-nums">{formatTime(playback.duration)}</span>
          </div>
        </div>
      )}

      {results.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm text-slate-400 mb-2">搜索结果</h3>
          <div className="space-y-1">
            {results.map((song, i) => (
              <div
                key={`${song.source}-${song.id}-${i}`}
                className="flex items-center gap-3 bg-slate-800 rounded-lg p-3 hover:bg-slate-700 transition-colors"
              >
                {song.imgUrl ? (
                  <img src={song.imgUrl} alt="" className="w-10 h-10 rounded object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded bg-slate-700 flex items-center justify-center text-slate-500">♪</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium text-sm">{song.title}</div>
                  <div className="truncate text-xs text-slate-400">
                    {song.artist}{song.album ? ` · ${song.album}` : ''}
                  </div>
                </div>
                <span className="text-xs text-slate-500 px-2">{song.source}</span>
                <button
                  onClick={() => handleRequest(song)}
                  className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg shrink-0"
                >
                  点歌
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm text-slate-400 mb-2">当前队列 ({queue.filter(q => q.status === 'pending').length} 首)</h3>
        {queue.length === 0 ? (
          <p className="text-slate-500 text-sm">还没有人点歌，快来第一首！</p>
        ) : (
          <div className="space-y-1">
            {queue.filter(q => q.status !== 'done' && q.status !== 'skipped').map((item, i) => (
              <div
                key={item.id}
                className={`flex items-center gap-3 rounded-lg p-3 text-sm ${
                  item.status === 'playing' ? 'bg-purple-900/50 border border-purple-600' : 'bg-slate-800'
                }`}
              >
                <span className="text-slate-500 w-6 text-center">
                  {item.status === 'playing' ? '▶' : i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-slate-400"> - {item.artist}</span>
                </div>
                <span className="text-xs text-slate-500">{item.userName || '匿名'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
