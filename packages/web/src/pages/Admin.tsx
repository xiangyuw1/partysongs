import { useState, useEffect, useCallback, useRef, type MouseEvent, type TouchEvent } from 'react';
import { getQueue, removeFromQueue, clearQueue, shuffleQueue, reorderQueue, searchSongs, adminFetch, type QueueItem, type Song } from '../api';
import { getAdminPassword, setAdminPassword } from '../utils';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePlaybackSync } from '../hooks/usePlaybackSync';

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Admin() {
  const [password, setPassword] = useState(getAdminPassword());
  const [loggedIn, setLoggedIn] = useState(!!getAdminPassword());
  const [loginError, setLoginError] = useState('');
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [tab, setTab] = useState<'queue' | 'fallback' | 'settings'>('queue');

  // Shared playback sync — handles interpolation + lyrics
  const {
    song: playerSong,
    position: playerPosition,
    duration: playerDuration,
    isPaused: playerPaused,
    currentLyricText,
    handleSync,
    setOverridePosition,
  } = usePlaybackSync();

  // Admin seeking state
  const [adminSeeking, setAdminSeeking] = useState(false);
  const adminSeekValueRef = useRef(0);
  const adminProgressBarRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef(password);
  passwordRef.current = password;

  // Fallback playlist creation
  const [fbName, setFbName] = useState('');
  const [fbQuery, setFbQuery] = useState('');
  const [fbResults, setFbResults] = useState<Song[]>([]);
  const [fbSongs, setFbSongs] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);

  // Import from URL
  const [importUrl, setImportUrl] = useState('');
  const [importMode, setImportMode] = useState<'fallback' | 'queue'>('fallback');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');

  useEffect(() => {
    if (loggedIn) loadData();
  }, [loggedIn]);

  const handleWs = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'queue_update') setQueue(msg.data as QueueItem[]);
    if (msg.type === 'fallback_update') setPlaylists(msg.data as any[]);
    if (msg.type === 'playback_position') {
      handleSync(msg.data as { position: number; duration: number; song: Song | null; isPaused: boolean });
    }
  }, [handleSync]);
  const { connected } = useWebSocket(handleWs);

  // Periodically request player to report position (for late-joining admin clients)
  useEffect(() => {
    if (!connected || !loggedIn) return;
    adminFetch('/playback', passwordRef.current, {
      method: 'POST',
      body: JSON.stringify({ action: 'report_position' }),
    }).catch(() => {});
    const timer = setInterval(() => {
      adminFetch('/playback', passwordRef.current, {
        method: 'POST',
        body: JSON.stringify({ action: 'report_position' }),
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [connected, loggedIn]);

  async function handleLogin() {
    setLoginError('');
    try {
      await adminFetch('/state', password);
      setAdminPassword(password);
      setLoggedIn(true);
    } catch (e: any) {
      setLoginError(e.message || '密码错误');
    }
  }

  async function loadData() {
    try {
      const [q, pl] = await Promise.all([
        getQueue(),
        adminFetch('/fallback', password),
      ]);
      setQueue(q);
      setPlaylists(Array.isArray(pl) ? pl : []);
    } catch (e: any) {
      if (e.message?.includes('密码')) {
        setLoggedIn(false);
        setLoginError(e.message);
      }
    }
  }

  async function handleSkip(id: number) {
    await removeFromQueue(id);
  }

  async function handleNext() {
    await adminFetch('/next', password, { method: 'POST' });
  }

  async function handleShuffle() {
    await shuffleQueue();
  }

  async function handleClear() {
    if (!confirm('确定清空所有待播歌曲？')) return;
    await clearQueue();
  }

  const [dragId, setDragId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);

  async function handleReorder(fromId: number, toId: number) {
    if (fromId === toId) return;
    setQueue((prev) => {
      const items = prev.filter((q) => q.status === 'pending');
      const fromIdx = items.findIndex((i) => i.id === fromId);
      const toIdx = items.findIndex((i) => i.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const [moved] = items.splice(fromIdx, 1);
      items.splice(toIdx, 0, moved);
      const playing = prev.filter((q) => q.status === 'playing');
      return [...playing, ...items];
    });
    await reorderQueue(fromId, toId);
  }

  async function handlePauseResume() {
    if (!playerSong) {
      await adminFetch('/playback', password, {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      });
    } else {
      await adminFetch('/playback', password, {
        method: 'POST',
        body: JSON.stringify({ action: playerPaused ? 'resume' : 'pause' }),
      });
    }
  }

  async function handleAdminSeek(position: number) {
    await adminFetch('/playback', password, {
      method: 'POST',
      body: JSON.stringify({ action: 'seek', position }),
    });
  }

  function adminSeekFromEvent(e: MouseEvent<HTMLDivElement> | TouchEvent<HTMLDivElement>) {
    const bar = adminProgressBarRef.current;
    if (!bar || playerDuration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const seekTo = ratio * playerDuration;
    adminSeekValueRef.current = seekTo;
    setOverridePosition(seekTo);
  }

  useEffect(() => {
    if (!adminSeeking) return;

    function handleMove(e: globalThis.MouseEvent | globalThis.TouchEvent) {
      const bar = adminProgressBarRef.current;
      if (!bar || playerDuration <= 0) return;
      const rect = bar.getBoundingClientRect();
      const clientX = 'touches' in e ? (e as globalThis.TouchEvent).touches[0]?.clientX ?? (e as globalThis.TouchEvent).changedTouches[0]?.clientX : (e as globalThis.MouseEvent).clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const seekTo = ratio * playerDuration;
      adminSeekValueRef.current = seekTo;
      setOverridePosition(seekTo);
    }

    function handleUp() {
      handleAdminSeek(adminSeekValueRef.current);
      setOverridePosition(null);
      setAdminSeeking(false);
    }

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    document.addEventListener('touchmove', handleMove, { passive: true });
    document.addEventListener('touchend', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleUp);
    };
  }, [adminSeeking, playerDuration, setOverridePosition]);

  async function handleActivateFallback(id: number) {
    await adminFetch(`/fallback/${id}/activate`, password, { method: 'PUT' });
    loadData();
  }

  async function handleDeactivateFallback() {
    await adminFetch('/fallback/deactivate', password, { method: 'PUT' });
    loadData();
  }

  async function handleDeleteFallback(id: number) {
    await adminFetch(`/fallback/${id}`, password, { method: 'DELETE' });
    loadData();
  }

  async function handleSearchFallback() {
    if (!fbQuery.trim()) return;
    setSearching(true);
    const res = await searchSongs(fbQuery.trim());
    setFbResults(res.songs ?? []);
    setSearching(false);
  }

  function addSongToFallback(song: Song) {
    if (fbSongs.find((s) => s.id === song.id && s.source === song.source)) return;
    setFbSongs([...fbSongs, song]);
  }

  function removeSongFromFallback(index: number) {
    setFbSongs(fbSongs.filter((_, i) => i !== index));
  }

  async function handleCreateFallback() {
    if (!fbName.trim() || fbSongs.length === 0) return;
    try {
      await adminFetch('/fallback', password, {
        method: 'POST',
        body: JSON.stringify({ name: fbName.trim(), songs: fbSongs }),
      });
      setFbName('');
      setFbSongs([]);
      setFbResults([]);
      setFbQuery('');
      loadData();
    } catch (e: any) {
      alert(e.message || '创建失败');
    }
  }

  async function handleImportPlaylist() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError('');
    try {
      await adminFetch('/import-playlist', password, {
        method: 'POST',
        body: JSON.stringify({ url: importUrl.trim(), mode: importMode }),
      });
      setImportUrl('');
      loadData();
    } catch (e: any) {
      setImportError(e.message || '导入失败');
    }
    setImporting(false);
  }

  if (!loggedIn) {
    return (
      <div className="max-w-md mx-auto p-4">
        <h1 className="text-xl font-bold mb-4">管理员登录</h1>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="输入管理密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-2"
          />
          <button onClick={handleLogin} className="bg-purple-600 hover:bg-purple-700 px-4 py-2 rounded-lg">
            登录
          </button>
        </div>
        {loginError && <p className="text-red-400 text-sm mt-2">{loginError}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      {/* Now playing */}
      <div className="mb-4 bg-slate-800 rounded-lg p-3 border border-slate-700">
        <div className="flex items-center gap-3 mb-2">
          {playerSong?.imgUrl ? (
            <img src={playerSong.imgUrl} alt="" className="w-10 h-10 rounded object-cover" />
          ) : (
            <div className="w-10 h-10 rounded bg-slate-700 flex items-center justify-center text-slate-500">♪</div>
          )}
          <div className="flex-1 min-w-0">
            <div className="truncate font-medium text-sm">{playerSong?.title ?? '未在播放'}</div>
            <div className="truncate text-xs text-slate-400">{playerSong?.artist ?? ''}</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handlePauseResume}
              className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm"
            >
              {playerPaused ? '▶' : '⏸'}
            </button>
            <button
              onClick={handleNext}
              className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-sm"
            >
              ⏭
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div
            ref={adminProgressBarRef}
            className="relative w-full h-4 flex items-center cursor-pointer group"
            onClick={adminSeekFromEvent}
            onMouseDown={(e) => {
              adminSeekFromEvent(e);
              setAdminSeeking(true);
            }}
            onTouchStart={(e) => {
              adminSeekFromEvent(e);
              setAdminSeeking(true);
            }}
          >
            <div className="relative w-full h-1 bg-slate-700 rounded-full">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-fuchsia-500 rounded-full"
                style={{ width: playerDuration > 0 ? `${(playerPosition / playerDuration) * 100}%` : '0%' }}
              />
              <div
                className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md transition-opacity ${
                  adminSeeking ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                style={{ left: playerDuration > 0 ? `calc(${(playerPosition / playerDuration) * 100}% - 6px)` : '-6px' }}
              />
            </div>
          </div>
          <div className="flex justify-between mt-1 text-xs text-slate-500 tabular-nums">
            <span>{formatTime(playerPosition)}</span>
            <span>{formatTime(playerDuration)}</span>
          </div>
          <div className="mt-2 text-center text-sm text-slate-300 truncate min-h-[1.25rem]">
            {currentLyricText}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(['queue', 'fallback', 'settings'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm ${tab === t ? 'bg-purple-600' : 'bg-slate-800 hover:bg-slate-700'}`}
          >
            {t === 'queue' ? '队列' : t === 'fallback' ? '备用列表' : '设置'}
          </button>
        ))}
      </div>

      {tab === 'queue' && (
        <div>
          {queue.filter(q => q.status !== 'done' && q.status !== 'skipped').length > 0 && (
            <div className="flex gap-2 mb-3">
              <button
                onClick={handleShuffle}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 rounded-lg text-sm"
              >
                打乱顺序
              </button>
              <button
                onClick={handleClear}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-lg text-sm"
              >
                清空队列
              </button>
            </div>
          )}
          <div className="space-y-1">
            {queue.filter(q => q.status !== 'done' && q.status !== 'skipped').map((item) => (
              <div
                key={item.id}
                draggable={item.status === 'pending'}
                onDragStart={() => item.status === 'pending' && setDragId(item.id)}
                onDragOver={(e) => {
                  if (item.status === 'pending') {
                    e.preventDefault();
                    setDragOverId(item.id);
                  }
                }}
                onDrop={() => {
                  if (dragId !== null && item.status === 'pending') {
                    handleReorder(dragId, item.id);
                  }
                  setDragId(null);
                  setDragOverId(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDragOverId(null);
                }}
                className={`flex items-center gap-3 bg-slate-800 rounded-lg p-3 ${
                  item.status === 'playing' ? 'border border-purple-500' : ''
                } ${dragOverId === item.id ? 'border-t-2 border-t-purple-400' : ''}`}
              >
                {item.status === 'pending' && (
                  <span className="text-slate-500 text-sm cursor-grab active:cursor-grabbing select-none sm:inline hidden">⠿</span>
                )}
                {item.status === 'playing' && (
                  <span className="text-purple-400 text-sm">▶</span>
                )}
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
                  <span className="text-xs text-slate-500 hidden sm:inline">{item.userName}</span>
                )}
                {item.status === 'pending' && (
                  <>
                    <div className="flex gap-1 sm:hidden">
                      <button onClick={() => {
                        const pending = queue.filter(q => q.status === 'pending');
                        const firstId = pending[0]?.id;
                        if (firstId && firstId !== item.id) handleReorder(item.id, firstId);
                      }} className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-xs" title="移到最前">⤒</button>
                      <button onClick={() => {
                        const pending = queue.filter(q => q.status === 'pending');
                        const idx = pending.findIndex(q => q.id === item.id);
                        if (idx > 0) handleReorder(item.id, pending[idx - 1].id);
                      }} className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-xs" title="上移">↑</button>
                      <button onClick={() => {
                        const pending = queue.filter(q => q.status === 'pending');
                        const idx = pending.findIndex(q => q.id === item.id);
                        if (idx < pending.length - 1) handleReorder(item.id, pending[idx + 1].id);
                      }} className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-xs" title="下移">↓</button>
                      <button onClick={() => {
                        const pending = queue.filter(q => q.status === 'pending');
                        const lastId = pending[pending.length - 1]?.id;
                        if (lastId && lastId !== item.id) handleReorder(item.id, lastId);
                      }} className="px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-xs" title="移到最后">⤓</button>
                    </div>
                    <button
                      onClick={() => handleSkip(item.id)}
                      className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs"
                    >
                      移除
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'fallback' && (
        <div>
          {/* Active fallback indicator */}
          {playlists.some((p: any) => p.active) && (
            <div className="mb-3 p-2 bg-purple-900/30 border border-purple-700 rounded-lg flex items-center justify-between">
              <span className="text-sm text-purple-300">
                当前备用: {playlists.find((p: any) => p.active)?.name}
              </span>
              <button
                onClick={handleDeactivateFallback}
                className="px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs"
              >
                取消激活
              </button>
            </div>
          )}

          {/* Existing playlists */}
          {playlists.length > 0 && (
            <div className="mb-4 space-y-1">
              {playlists.map((pl: any) => (
                <div key={pl.id} className="flex items-center gap-3 bg-slate-800 rounded-lg p-3">
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-sm">{pl.name}</div>
                    <div className="text-xs text-slate-400">{pl.song_count} 首歌</div>
                  </div>
                  {!pl.active && (
                    <button
                      onClick={() => handleActivateFallback(pl.id)}
                      className="px-2 py-1 bg-purple-600 hover:bg-purple-700 rounded text-xs"
                    >
                      激活
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteFallback(pl.id)}
                    className="px-2 py-1 bg-red-600 hover:bg-red-700 rounded text-xs"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Import from URL */}
          <div className="mb-4 p-3 bg-slate-800 rounded-lg border border-slate-700">
            <h3 className="text-sm font-medium mb-2">从链接导入</h3>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="粘贴歌单链接..."
                value={importUrl}
                onChange={(e) => setImportUrl(e.target.value)}
                className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm"
              />
              <select
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as 'fallback' | 'queue')}
                className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm"
              >
                <option value="fallback">备用列表</option>
                <option value="queue">播放队列</option>
              </select>
              <button
                onClick={handleImportPlaylist}
                disabled={importing}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded text-sm"
              >
                {importing ? '...' : '导入'}
              </button>
            </div>
            {importError && <p className="text-red-400 text-xs">{importError}</p>}
          </div>

          {/* Create new playlist */}
          <div className="p-3 bg-slate-800 rounded-lg border border-slate-700">
            <h3 className="text-sm font-medium mb-2">创建备用列表</h3>
            <input
              type="text"
              placeholder="列表名称"
              value={fbName}
              onChange={(e) => setFbName(e.target.value)}
              className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm mb-2"
            />
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="搜索添加歌曲..."
                value={fbQuery}
                onChange={(e) => setFbQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchFallback()}
                className="flex-1 bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm"
              />
              <button
                onClick={handleSearchFallback}
                disabled={searching}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded text-sm"
              >
                {searching ? '...' : '搜索'}
              </button>
            </div>

            {fbResults.length > 0 && (
              <div className="mb-2 space-y-1 max-h-40 overflow-y-auto">
                {fbResults.map((song, i) => (
                  <div key={`${song.source}-${song.id}-${i}`} className="flex items-center gap-2 p-2 hover:bg-slate-700 rounded">
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm">{song.title}</div>
                      <div className="truncate text-xs text-slate-400">{song.artist}</div>
                    </div>
                    <button
                      onClick={() => addSongToFallback(song)}
                      className="px-2 py-0.5 bg-purple-600 hover:bg-purple-700 rounded text-xs"
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            )}

            {fbSongs.length > 0 && (
              <div className="mb-2 space-y-1">
                {fbSongs.map((song, i) => (
                  <div key={`fb-${song.source}-${song.id}-${i}`} className="flex items-center gap-2 p-2 bg-slate-700 rounded">
                    <span className="text-xs text-slate-500">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm">{song.title}</div>
                      <div className="truncate text-xs text-slate-400">{song.artist}</div>
                    </div>
                    <button
                      onClick={() => removeSongFromFallback(i)}
                      className="px-1.5 py-0.5 bg-red-600 hover:bg-red-700 rounded text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={handleCreateFallback}
              disabled={!fbName.trim() || fbSongs.length === 0}
              className="w-full px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded text-sm"
            >
              创建 ({fbSongs.length} 首)
            </button>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-4">
          <div className="p-3 bg-slate-800 rounded-lg border border-slate-700">
            <h3 className="text-sm font-medium mb-2">播放模式</h3>
            <p className="text-xs text-slate-400">队列优先 → 备用列表循环</p>
          </div>
          <div className="p-3 bg-slate-800 rounded-lg border border-slate-700">
            <button
              onClick={() => {
                sessionStorage.removeItem('admin_password');
                setLoggedIn(false);
                setPassword('');
              }}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-sm"
            >
              退出登录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
