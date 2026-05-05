import { useState, useEffect, useCallback, useRef, type MouseEvent, type TouchEvent } from 'react';
import { getQueue, removeFromQueue, searchSongs, adminFetch, importPlaylist, type QueueItem, type Song } from '../api';
import { getAdminPassword, setAdminPassword } from '../utils';
import { useWebSocket } from '../hooks/useWebSocket';

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

  // Player sync state
  const [playerPosition, setPlayerPosition] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerSong, setPlayerSong] = useState<Song | null>(null);
  const [playerPaused, setPlayerPaused] = useState(true);
  const [adminSeeking, setAdminSeeking] = useState(false);
  const adminSeekValueRef = useRef(0);
  const adminProgressBarRef = useRef<HTMLDivElement>(null);
  const playerPositionRef = useRef(0);
  const playerDurationRef = useRef(0);

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
      const d = msg.data as { position: number; duration: number; song: Song | null; isPaused: boolean };
      playerPositionRef.current = d.position;
      playerDurationRef.current = d.duration;
      if (!adminSeekingRef.current) {
        setPlayerPosition(d.position);
      }
      setPlayerDuration(d.duration);
      setPlayerSong(d.song);
      setPlayerPaused(d.isPaused);
    }
  }, []);
  const { connected } = useWebSocket(handleWs);
  const passwordRef = useRef(password);
  passwordRef.current = password;
  const adminSeekingRef = useRef(false);

  useEffect(() => {
    adminSeekingRef.current = adminSeeking;
  }, [adminSeeking]);

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
    setPlayerPosition(seekTo);
  }

  useEffect(() => {
    if (!adminSeeking) return;

    function handleMove(e: globalThis.MouseEvent | globalThis.TouchEvent) {
      const bar = adminProgressBarRef.current;
      if (!bar || playerDurationRef.current <= 0) return;
      const rect = bar.getBoundingClientRect();
      const clientX = 'touches' in e ? (e as globalThis.TouchEvent).touches[0]?.clientX ?? (e as globalThis.TouchEvent).changedTouches[0]?.clientX : (e as globalThis.MouseEvent).clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const seekTo = ratio * playerDurationRef.current;
      adminSeekValueRef.current = seekTo;
      setPlayerPosition(seekTo);
    }

    function handleUp() {
      handleAdminSeek(adminSeekValueRef.current);
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
  }, [adminSeeking]);

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

  function removeSongFromFallback(idx: number) {
    setFbSongs(fbSongs.filter((_, i) => i !== idx));
  }

  async function handleSaveFallback() {
    if (!fbName.trim() || fbSongs.length === 0) return;
    await adminFetch('/fallback', password, {
      method: 'POST',
      body: JSON.stringify({ name: fbName, songs: fbSongs }),
    });
    setFbName('');
    setFbSongs([]);
    setFbQuery('');
    setFbResults([]);
    loadData();
  }

  async function handleImportPlaylist() {
    if (!importUrl.trim()) return;
    setImporting(true);
    setImportError('');
    try {
      await importPlaylist(password, importUrl.trim(), importMode);
      setImportUrl('');
      loadData();
      if (importMode === 'queue') {
        setTab('queue');
      }
    } catch (e: any) {
      setImportError(e.message || '导入失败');
    } finally {
      setImporting(false);
    }
  }

  if (!loggedIn) {
    return (
      <div className="max-w-sm mx-auto p-4 mt-20">
        <h2 className="text-xl font-bold mb-4">管理员登录</h2>
        <input
          type="password"
          placeholder="输入管理密码"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setLoginError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 mb-3"
        />
        {loginError && (
          <p className="text-red-400 text-sm mb-3">{loginError}</p>
        )}
        <button onClick={handleLogin} className="w-full bg-purple-600 hover:bg-purple-700 py-2 rounded-lg font-medium">
          登录
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
      {/* Playback control bar */}
      <div className="bg-slate-800 rounded-xl p-4 mb-4">
        <div className="flex items-center gap-4">
          {playerSong?.imgUrl && (
            <img
              src={playerSong.imgUrl}
              alt={playerSong.title}
              className="w-14 h-14 rounded-lg object-cover flex-shrink-0"
            />
          )}
          <div className="flex-1 min-w-0">
            {playerSong ? (
              <>
                <p className="font-medium text-sm truncate">{playerSong.title}</p>
                <p className="text-xs text-slate-400 truncate">{playerSong.artist}</p>
              </>
            ) : (
              <p className="text-sm text-slate-500">未在播放</p>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handlePauseResume}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-purple-600 hover:bg-purple-700 transition-colors"
              title={!playerSong ? '开始播放' : playerPaused ? '继续播放' : '暂停'}
            >
              {!playerSong ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white ml-0.5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : playerPaused ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white ml-0.5">
                  <path d="M8 5v14l11-7z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
                  <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                </svg>
              )}
            </button>
            <button
              onClick={handleNext}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-slate-700 hover:bg-slate-600 border border-slate-600 transition-colors"
              title="下一首"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white">
                <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
              </svg>
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
          <div className="space-y-1">
            {queue.filter(q => q.status !== 'done' && q.status !== 'skipped').map((item) => (
              <div
                key={item.id}
                className={`flex items-center gap-3 rounded-lg p-3 text-sm ${
                  item.status === 'playing' ? 'bg-purple-900/50 border border-purple-600' : 'bg-slate-800'
                }`}
              >
                <span className="text-slate-500 w-6 text-center">
                  {item.status === 'playing' ? '▶' : '#'}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-slate-400"> - {item.artist}</span>
                  <span className="text-xs text-slate-500 ml-2">({item.userName || '匿名'})</span>
                </div>
                {item.status === 'pending' && (
                  <button
                    onClick={() => handleSkip(item.id)}
                    className="text-red-400 hover:text-red-300 text-xs px-2 py-1"
                  >
                    删除
                  </button>
                )}
              </div>
            ))}
            {queue.filter(q => q.status !== 'done' && q.status !== 'skipped').length === 0 && (
              <p className="text-slate-500 text-sm">队列为空</p>
            )}
          </div>
        </div>
      )}

      {tab === 'fallback' && (
        <div>
          <div className="mb-4 space-y-2">
            {playlists.map((pl) => (
              <div key={pl.id} className="flex items-center gap-3 bg-slate-800 rounded-lg p-3">
                <div className="flex-1">
                  <span className="font-medium text-sm">{pl.name}</span>
                  <span className="text-xs text-slate-400 ml-2">({pl.songs?.length ?? 0} 首)</span>
                  {pl.isActive && <span className="text-xs text-green-400 ml-2">● 活跃</span>}
                </div>
                {pl.isActive ? (
                  <button onClick={handleDeactivateFallback} className="text-yellow-400 text-xs px-2 py-1">停用</button>
                ) : (
                  <button onClick={() => handleActivateFallback(pl.id)} className="text-green-400 text-xs px-2 py-1">激活</button>
                )}
                <button onClick={() => handleDeleteFallback(pl.id)} className="text-red-400 text-xs px-2 py-1">删除</button>
              </div>
            ))}
          </div>

          <div className="border-t border-slate-700 pt-4">
            <h3 className="font-medium mb-2">从链接导入</h3>
            <input
              type="text"
              placeholder="粘贴歌单链接 (网易云/QQ音乐/酷狗/酷我/咪咕)"
              value={importUrl}
              onChange={(e) => { setImportUrl(e.target.value); setImportError(''); }}
              onKeyDown={(e) => e.key === 'Enter' && handleImportPlaylist()}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-sm mb-2"
            />
            <div className="flex gap-2 mb-2">
              <label className="flex items-center gap-1 text-sm text-slate-300">
                <input
                  type="radio"
                  name="importMode"
                  value="fallback"
                  checked={importMode === 'fallback'}
                  onChange={() => setImportMode('fallback')}
                  className="accent-purple-500"
                />
                备用歌单
              </label>
              <label className="flex items-center gap-1 text-sm text-slate-300">
                <input
                  type="radio"
                  name="importMode"
                  value="queue"
                  checked={importMode === 'queue'}
                  onChange={() => setImportMode('queue')}
                  className="accent-purple-500"
                />
                加入队列
              </label>
            </div>
            {importError && (
              <p className="text-red-400 text-xs mb-2">{importError}</p>
            )}
            <button
              onClick={handleImportPlaylist}
              disabled={!importUrl.trim() || importing}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 py-2 rounded-lg text-sm font-medium"
            >
              {importing ? '导入中...' : '开始导入'}
            </button>
          </div>

          <div className="border-t border-slate-700 pt-4 mt-4">
            <h3 className="font-medium mb-2">创建备用列表</h3>
            <input
              type="text"
              placeholder="列表名称"
              value={fbName}
              onChange={(e) => setFbName(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-sm mb-2"
            />
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                placeholder="搜索歌曲添加..."
                value={fbQuery}
                onChange={(e) => setFbQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearchFallback()}
                className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-sm"
              />
              <button
                onClick={handleSearchFallback}
                disabled={searching}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 px-3 py-2 rounded-lg text-sm"
              >
                {searching ? '...' : '搜索'}
              </button>
            </div>

            {fbResults.length > 0 && (
              <div className="space-y-1 mb-3 max-h-48 overflow-y-auto">
                {fbResults.slice(0, 10).map((song, i) => (
                  <div key={`${song.source}-${song.id}-${i}`} className="flex items-center gap-2 bg-slate-800 rounded p-2 text-sm">
                    <div className="flex-1 truncate">
                      {song.title} <span className="text-slate-400">- {song.artist}</span>
                    </div>
                    <button onClick={() => addSongToFallback(song)} className="text-green-400 text-xs px-2">+</button>
                  </div>
                ))}
              </div>
            )}

            {fbSongs.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-slate-400 mb-1">已选 {fbSongs.length} 首：</p>
                <div className="space-y-1">
                  {fbSongs.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 bg-slate-700 rounded p-2 text-sm">
                      <span className="flex-1 truncate">{s.title} - {s.artist}</span>
                      <button onClick={() => removeSongFromFallback(i)} className="text-red-400 text-xs">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={handleSaveFallback}
              disabled={!fbName.trim() || fbSongs.length === 0}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 py-2 rounded-lg text-sm font-medium"
            >
              保存备用列表
            </button>
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-4">
          <div className="bg-slate-800 rounded-lg p-4">
            <h3 className="font-medium mb-2">音源信息</h3>
            <p className="text-sm text-slate-400">
              音乐数据由 <a href="https://music.gdstudio.xyz" target="_blank" rel="noopener noreferrer" className="text-purple-400 underline">GD音乐台</a> 聚合 API 提供，
              当前可用音源：网易云音乐、JOOX。
            </p>
            <p className="text-xs text-slate-500 mt-2">
              数据来源：GD音乐台(music.gdstudio.xyz) — 基于 Meting &amp; MKOnlineMusicPlayer，由 metowolf &amp; mengkun 原创，GD Studio 修改维护。
            </p>
            <p className="text-xs text-slate-500 mt-1">
              本平台仅供学习交流使用，严禁商用。音乐版权归各平台及版权方所有。
            </p>
            <p className="text-xs text-slate-500 mt-1">
              访问限制：5分钟内不超过50次请求
            </p>
          </div>
          <div>
            <p className="text-sm text-slate-400">管理密码通过环境变量 ADMIN_PASSWORD 设置。</p>
            <p className="mt-2 text-sm text-slate-400">播放端打开 <code className="bg-slate-800 px-1 rounded">/player</code> 页面即可。</p>
          </div>
        </div>
      )}
    </div>
  );
}
