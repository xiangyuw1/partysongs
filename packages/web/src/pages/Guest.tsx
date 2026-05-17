import { useState, useEffect, useCallback } from 'react';
import { searchSongs, addToQueue, getQueue, type Song, type QueueItem } from '../api';
import { getUserId, getUserName, setUserName } from '../utils';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePlaybackSync } from '../hooks/usePlaybackSync';

const SOURCE_OPTIONS = [
  { value: 'all', label: '全部' },
  { value: 'netease', label: '网易云' },
  { value: 'joox', label: 'JOOX' },
];

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

  // Shared playback sync — handles interpolation + lyrics
  const {
    song: currentSong,
    position,
    duration,
    isPaused,
    currentLyricText,
    handleSync,
  } = usePlaybackSync();

  useEffect(() => {
    getQueue().then(setQueue).catch(() => {});
  }, []);

  const handleWs = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'queue_update') {
      setQueue(msg.data as QueueItem[]);
    } else if (msg.type === 'playback_position') {
      handleSync(msg.data as { position: number; duration: number; song: Song | null; isPaused: boolean });
    }
  }, [handleSync]);
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

      {currentSong && (
        <div className="mb-4 bg-slate-800 rounded-lg p-3 border border-slate-700">
          <div className="flex items-center gap-3 mb-2">
            {currentSong.imgUrl ? (
              <img src={currentSong.imgUrl} alt="" className="w-10 h-10 rounded object-cover" />
            ) : (
              <div className="w-10 h-10 rounded bg-slate-700 flex items-center justify-center text-slate-500">♪</div>
            )}
            <div className="flex-1 min-w-0">
              <div className="truncate font-medium text-sm">{currentSong.title}</div>
              <div className="truncate text-xs text-slate-400">{currentSong.artist}</div>
            </div>
            <span className="text-xs text-slate-500">{isPaused ? '⏸' : '▶'}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="w-10 text-right tabular-nums">{formatTime(position)}</span>
            <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-500 rounded-full"
                style={{ width: `${duration > 0 ? Math.min(position / duration, 1) * 100 : 0}%` }}
              />
            </div>
            <span className="w-10 tabular-nums">{formatTime(duration)}</span>
          </div>
          <div className="mt-2 text-center text-sm text-slate-300 truncate min-h-[1.25rem]">
            {currentLyricText}
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
                <span className="text-xs text-slate-500 px-1">{song.source}</span>
                <button
                  onClick={() => handleRequest(song)}
                  className="shrink-0 bg-purple-600 hover:bg-purple-700 px-3 py-1 rounded text-sm"
                >
                  点歌
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm text-slate-400 mb-2">当前队列</h3>
        {queue.filter(q => q.status === 'pending').length === 0 ? (
          <p className="text-slate-500 text-sm">暂无歌曲，快来点一首吧！</p>
        ) : (
          <div className="space-y-1">
            {queue.filter(q => q.status === 'pending').map((item, i) => (
              <div key={item.id} className="flex items-center gap-3 bg-slate-800 rounded-lg p-3">
                <span className="text-slate-500 text-sm w-5 text-right">{i + 1}</span>
                {item.imgUrl ? (
                  <img src={item.imgUrl} alt="" className="w-8 h-8 rounded object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded bg-slate-700 flex items-center justify-center text-slate-500 text-xs">♪</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate text-sm">{item.title}</div>
                  <div className="truncate text-xs text-slate-400">{item.artist}</div>
                </div>
                {item.userName && (
                  <span className="text-xs text-slate-500">{item.userName}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
