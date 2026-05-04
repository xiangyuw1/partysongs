import { useState, useEffect, useCallback } from 'react';
import { getQueue, removeFromQueue, searchSongs, adminFetch, type QueueItem, type Song } from '../api';
import { getAdminPassword, setAdminPassword } from '../utils';
import { useWebSocket } from '../hooks/useWebSocket';

export default function Admin() {
  const [password, setPassword] = useState(getAdminPassword());
  const [loggedIn, setLoggedIn] = useState(!!getAdminPassword());
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [tab, setTab] = useState<'queue' | 'fallback' | 'settings'>('queue');

  // Fallback playlist creation
  const [fbName, setFbName] = useState('');
  const [fbQuery, setFbQuery] = useState('');
  const [fbResults, setFbResults] = useState<Song[]>([]);
  const [fbSongs, setFbSongs] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);

  // QQ Cookie
  const [qqCookie, setQqCookie] = useState('');
  const [qqConnected, setQqConnected] = useState(false);

  // QR Login
  const [qrImage, setQrImage] = useState('');
  const [qrSessionKey, setQrSessionKey] = useState('');
  const [qrStatus, setQrStatus] = useState('');
  const [qrError, setQrError] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [qrNickname, setQrNickname] = useState('');
  const [qrStep, setQrStep] = useState<'qr' | 'auth' | 'paste'>('qr');

  useEffect(() => {
    if (loggedIn) loadData();
  }, [loggedIn]);

  const handleWs = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'queue_update') setQueue(msg.data as QueueItem[]);
    if (msg.type === 'fallback_update') setPlaylists(msg.data as any[]);
  }, []);
  useWebSocket(handleWs);

  function handleLogin() {
    setAdminPassword(password);
    setLoggedIn(true);
  }

  async function loadData() {
    try {
      const [q, pl, qq] = await Promise.all([
        getQueue(),
        adminFetch('/fallback', password),
        adminFetch('/qq-cookie', password),
      ]);
      setQueue(q);
      setPlaylists(Array.isArray(pl) ? pl : []);
      setQqConnected(qq?.connected ?? false);
    } catch {}
  }

  async function handleSkip(id: number) {
    await removeFromQueue(id);
  }

  async function handleSkipCurrent() {
    await adminFetch('/skip', password, { method: 'POST' });
  }

  async function handleNext() {
    await adminFetch('/next', password, { method: 'POST' });
  }

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

  async function handleSaveQqCookie() {
    if (!qqCookie.trim()) return;
    await adminFetch('/qq-cookie', password, {
      method: 'POST',
      body: JSON.stringify({ cookie: qqCookie.trim() }),
    });
    setQqCookie('');
    setQqConnected(true);
    setQrStep('qr');
    setQrImage('');
    setQrSessionKey('');
  }

  async function handleDisconnectQq() {
    await adminFetch('/qq-cookie', password, { method: 'DELETE' });
    setQqConnected(false);
  }

  async function handleStartQrLogin() {
    setQrLoading(true);
    setQrError('');
    setQrStatus('');
    setQrNickname('');
    setQrStep('qr');
    try {
      const data = await adminFetch('/qq-login/qr', password, { method: 'POST' });
      if (data?.qrImage && data?.sessionKey) {
        setQrImage(data.qrImage);
        setQrSessionKey(data.sessionKey);
        setQrStatus('pending');
      } else {
        setQrError('获取二维码失败');
      }
    } catch {
      setQrError('获取二维码失败');
    }
    setQrLoading(false);
  }

  useEffect(() => {
    if (!qrSessionKey || !qrStatus || qrStatus === 'expired' || qrStatus === 'failed') return;
    if (qrStep !== 'qr') return;

    const timer = setInterval(async () => {
      try {
        const data = await adminFetch(`/qq-login/qr/${qrSessionKey}`, password);
        if (data?.status) {
          setQrStatus(data.status);
          if (data.nickname) setQrNickname(data.nickname);
          if (data.error) setQrError(data.error);
          if (data.status === 'confirmed' && data.redirectUrl) {
            // QR scan success! Open the redirect URL for browser-side OAuth
            setQrStep('auth');
            window.open(data.redirectUrl, '_blank');
          }
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [qrSessionKey, qrStatus, qrStep, password]);

  if (!loggedIn) {
    return (
      <div className="max-w-sm mx-auto p-4 mt-20">
        <h2 className="text-xl font-bold mb-4">管理员登录</h2>
        <input
          type="password"
          placeholder="输入管理密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 mb-3"
        />
        <button onClick={handleLogin} className="w-full bg-purple-600 hover:bg-purple-700 py-2 rounded-lg font-medium">
          登录
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-4">
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
          <div className="flex gap-2 mb-4">
            <button onClick={handleSkipCurrent} className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm">
              跳过当前
            </button>
            <button onClick={handleNext} className="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded-lg text-sm">
              播放下一首
            </button>
          </div>
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
        <div className="space-y-6">
          <div>
            <h3 className="font-medium mb-2">QQ音乐 VIP 登录</h3>
            {qqConnected ? (
              <div className="flex items-center gap-3 bg-green-900/30 border border-green-700 rounded-lg p-3">
                <span className="text-green-400 text-sm">已连接</span>
                <button onClick={handleDisconnectQq} className="text-red-400 text-xs hover:text-red-300 ml-auto">
                  断开连接
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                {/* QR Code Login */}
                <div className="bg-slate-800/50 rounded-lg p-4">
                  <h4 className="text-sm font-medium mb-2">扫码登录（推荐）</h4>

                  {qrStep === 'qr' && !qrImage && (
                    <>
                      <p className="text-xs text-slate-400 mb-3">使用QQ手机版扫码，自动完成登录。</p>
                      <button onClick={handleStartQrLogin} disabled={qrLoading}
                        className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 py-2 rounded-lg text-sm font-medium">
                        {qrLoading ? '生成二维码...' : '生成登录二维码'}
                      </button>
                    </>
                  )}

                  {qrStep === 'qr' && qrImage && (
                    <div className="flex flex-col items-center gap-3">
                      <div className="bg-white p-2 rounded-lg">
                        <img src={qrImage} alt="QQ登录二维码" className="w-48 h-48" />
                      </div>
                      {qrStatus === 'pending' && <p className="text-xs text-slate-400">请使用QQ手机版扫描二维码</p>}
                      {qrStatus === 'scanned' && <p className="text-xs text-yellow-400">已扫码，请在手机上确认{qrNickname ? ` (${qrNickname})` : ''}</p>}
                      {qrStatus === 'expired' && (
                        <div className="text-center">
                          <p className="text-xs text-red-400 mb-2">二维码已过期</p>
                          <button onClick={() => { setQrStep('qr'); handleStartQrLogin(); }} className="text-xs text-purple-400 underline">重新获取</button>
                        </div>
                      )}
                      {qrStatus === 'failed' && (
                        <div className="text-center">
                          <p className="text-xs text-red-400 mb-2">{qrError || '登录失败'}</p>
                          <button onClick={() => { setQrStep('qr'); handleStartQrLogin(); }} className="text-xs text-purple-400 underline">重试</button>
                        </div>
                      )}
                    </div>
                  )}

                  {qrStep === 'auth' && (
                    <div className="text-center space-y-3">
                      <p className="text-xs text-green-400">扫码成功！({qrNickname})</p>
                      <p className="text-xs text-slate-400">
                        已在新标签页打开QQ音乐授权页面。<br />
                        完成授权后，请在QQ音乐页面按 <kbd className="bg-slate-700 px-1 rounded">F12</kbd> 打开控制台，输入：
                      </p>
                      <code className="block bg-slate-900 p-2 rounded text-xs text-green-300 select-all">document.cookie</code>
                      <p className="text-xs text-slate-400">复制输出结果粘贴到下方：</p>
                      <textarea
                        placeholder="粘贴从QQ音乐页面复制的Cookie..."
                        value={qqCookie}
                        onChange={(e) => setQqCookie(e.target.value)}
                        rows={3}
                        className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-xs font-mono"
                      />
                      <button onClick={handleSaveQqCookie} disabled={!qqCookie.trim()}
                        className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 py-2 rounded-lg text-sm font-medium">
                        连接QQ音乐
                      </button>
                      <button onClick={() => { setQrStep('qr'); setQrImage(''); setQrSessionKey(''); setQqCookie(''); }}
                        className="text-xs text-slate-500 hover:text-slate-400">取消</button>
                    </div>
                  )}
                </div>

                {/* Manual Cookie Paste (fallback) */}
                <details className="group">
                  <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400">
                    手动粘贴Cookie（备用方式）
                  </summary>
                  <div className="mt-2">
                    <p className="text-xs text-slate-400 mb-2">
                      浏览器打开 <a href="https://y.qq.com" target="_blank" className="text-purple-400 underline">y.qq.com</a> 并登录
                      → F12 → Console → 输入 <code className="bg-slate-800 px-1">document.cookie</code> → 复制粘贴
                    </p>
                    <textarea
                      placeholder="粘贴QQ音乐Cookie..."
                      value={qqCookie}
                      onChange={(e) => setQqCookie(e.target.value)}
                      rows={3}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 text-sm mb-2 font-mono text-xs"
                    />
                    <button
                      onClick={handleSaveQqCookie}
                      disabled={!qqCookie.trim()}
                      className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-50 py-2 rounded-lg text-sm font-medium"
                    >
                      连接QQ音乐
                    </button>
                  </div>
                </details>
              </div>
            )}
          </div>

          <div className="border-t border-slate-700 pt-4">
            <p className="text-sm text-slate-400">管理密码通过环境变量 ADMIN_PASSWORD 设置。</p>
            <p className="mt-2 text-sm text-slate-400">播放端打开 <code className="bg-slate-800 px-1 rounded">/player</code> 页面即可。</p>
          </div>
        </div>
      )}
    </div>
  );
}
