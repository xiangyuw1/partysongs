import { useState, useEffect, useCallback, useRef, useMemo, type MouseEvent, type TouchEvent } from 'react';
import { Howl } from 'howler';
import QRCode from 'react-qr-code';
import { getPlayerUrl, requestNext, getLyrics, sendPlaybackPosition, notifySongStarted, type Song } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';
import { parseLrc, findCurrentLyricLine, type LyricLine } from '../utils';

const PLAYER_STATE_KEY = 'partysongs_player_state';

// Wake Lock to prevent screen from sleeping
let wakeLock: WakeLockSentinel | null = null;

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('[WakeLock] Screen wake lock acquired');
      wakeLock.addEventListener('release', () => {
        console.log('[WakeLock] Screen wake lock released');
        wakeLock = null;
      });
    }
  } catch (err) {
    console.warn('[WakeLock] Failed to acquire:', err);
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
}

// Media Session API for background playback support
function updateMediaSession(
  song: Song | null,
  howl?: Howl | null,
  callbacks?: { onPlay?: () => void; onPause?: () => void; onNext?: () => void }
) {
  if (!('mediaSession' in navigator)) return;

  if (!song) {
    navigator.mediaSession.metadata = null;
    return;
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist,
    album: song.album || '',
    artwork: song.imgUrl ? [{ src: song.imgUrl, sizes: '300x300', type: 'image/jpeg' }] : [],
  });

  // Action handlers for lock screen / notification controls
  // Use callbacks to properly update Player state (playingRef, pausedRef, etc.)
  navigator.mediaSession.setActionHandler('play', () => {
    if (callbacks?.onPlay) {
      callbacks.onPlay();
    } else if (howl && !howl.playing()) {
      howl.play();
    }
  });
  navigator.mediaSession.setActionHandler('pause', () => {
    if (callbacks?.onPause) {
      callbacks.onPause();
    } else if (howl && howl.playing()) {
      howl.pause();
    }
  });
  navigator.mediaSession.setActionHandler('previoustrack', null);
  navigator.mediaSession.setActionHandler('nexttrack', () => {
    if (callbacks?.onNext) {
      callbacks.onNext();
    } else if (typeof (window as any).__playerHandleEnded === 'function') {
      (window as any).__playerHandleEnded();
    }
  });
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function Player() {
  const guestUrl = useMemo(() => `${window.location.origin}/guest`, []);

  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [status, setStatus] = useState('等待开始...');
  const [started, setStarted] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [activeLine, setActiveLine] = useState(-1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const howlRef = useRef<Howl | null>(null);
  const playingRef = useRef(false);
  const retryCountRef = useRef(0);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const lyricsRef = useRef<LyricLine[]>([]);
  const handleEndedRef = useRef<() => void>(() => {});
  const progressBarRef = useRef<HTMLDivElement>(null);
  const [seeking, setSeeking] = useState(false);
  const seekValueRef = useRef(0);
  const seekingRef = useRef(false);
  const currentSongRef = useRef<Song | null>(null);
  const lastSaveRef = useRef(0);
  const pausedRef = useRef(false);
  const lastBroadcastRef = useRef(0);
  const togglePauseRef = useRef<() => void>(() => {});
  const startedRef = useRef(false);
  const reportPositionRef = useRef<() => void>(() => {});
  const playGenRef = useRef(0);
  const [bgSuspended, setBgSuspended] = useState(false);
  // Preload next song for seamless background advancement
  const preloadedSongRef = useRef<{ song: Song; queueItemId?: number } | null>(null);
  const preloadTriggeredRef = useRef(false);

  function fetchLyrics(song: Song) {
    setLyrics([]);
    lyricsRef.current = [];
    setActiveLine(-1);
    getLyrics(song.source, song.id, song.title, song.artist).then((data) => {
      if (!data?.lyric) return;
      const parsed = parseLrc(data.lyric);
      lyricsRef.current = parsed;
      setLyrics(parsed);
    });
  }

  function startProgressSync() {
    cancelAnimationFrame(rafRef.current);
    // Reset preload state for new song
    preloadedSongRef.current = null;
    preloadTriggeredRef.current = false;

    const tick = () => {
      const howl = howlRef.current;
      if (howl && (playingRef.current || pausedRef.current) && !seekingRef.current) {
        const t = howl.seek() as number;
        const dur = howl.duration();
        setCurrentTime(t);
        setDuration(dur);

        if (playingRef.current) {
          const lines = lyricsRef.current;
          const idx = findCurrentLyricLine(lines, t);
          setActiveLine((prev) => (idx !== prev ? idx : prev));

          // Preload next song when approaching end (10 seconds remaining)
          // This ensures seamless playback on Android where async requests may fail in background
          if (!preloadTriggeredRef.current && dur > 0 && (dur - t) < 10) {
            preloadTriggeredRef.current = true;
            console.log('[Player] Preloading next song...');
            requestNext().then((next) => {
              if (next?.song) {
                preloadedSongRef.current = next;
                console.log('[Player] Next song preloaded:', next.song.title);
              }
            }).catch((err) => {
              console.warn('[Player] Preload failed:', err);
            });
          }
        }

        const now = performance.now();
        if (now - lastSaveRef.current > 1000) {
          lastSaveRef.current = now;
          const song = currentSongRef.current;
          if (song) {
            try {
              localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify({ song, position: t }));
            } catch { /* quota exceeded, ignore */ }
          }
        }
        if (now - lastBroadcastRef.current > 1000) {
          lastBroadcastRef.current = now;
          sendPlaybackPosition({
            position: t,
            duration: dur,
            song: currentSongRef.current,
            isPaused: pausedRef.current,
          });
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    if (!lyricsContainerRef.current || activeLine < 0) return;
    const container = lyricsContainerRef.current;
    const activeEl = container.children[activeLine] as HTMLElement | undefined;
    if (!activeEl) return;
    const containerRect = container.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const offset = container.scrollTop + (activeRect.top - containerRect.top) - container.clientHeight / 2 + activeRect.height / 2;
    container.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
  }, [activeLine]);

  function playSong(song: Song, seekTo?: number) {
    stopCurrent();
    const gen = ++playGenRef.current;
    setStatus(`获取播放链接: ${song.title}...`);
    fetchLyrics(song);

    getPlayerUrl(song).then((url) => {
      if (gen !== playGenRef.current) return;
      if (!url) {
        setStatus(`无法播放: ${song.title}，跳过`);
        console.warn('No URL for:', song.title, song.source);
        retryCountRef.current = 0;
        setTimeout(() => handleEnded(), 2000);
        return;
      }

      setCurrentSong(song);
      setStatus(seekTo != null ? `继续播放: ${song.title} - ${song.artist}` : `正在播放: ${song.title} - ${song.artist}`);
      retryCountRef.current = 0;

      const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
      const formats = ext === 'm4a' ? ['m4a', 'mp4'] : ext === 'mp3' ? ['mp3'] : undefined;

      const howl = new Howl({
        src: [url],
        html5: true,
        ...(formats ? { format: formats } : {}),
        onend: () => handleEnded(),
        onload: () => {
          // Notify server about song start for timeout detection
          const dur = howl.duration();
          if (dur > 0) {
            notifySongStarted(song, dur);
          }
        },
        onloaderror: (_id, err) => {
          console.error('Load error:', err);
          setStatus(`播放失败: ${song.title}，跳过`);
          setTimeout(() => handleEnded(), 2000);
        },
      });

      howlRef.current = howl;
      playingRef.current = true;
      pausedRef.current = false;
      howl.play();

      // Add direct Audio element listener for reliable background playback
      // The native 'ended' event fires even when JS is throttled in background
      // This bypasses Howler.js callback chain which may break when suspended
      const audioNode = (howl as any)._sounds?.[0]?._node as HTMLAudioElement | undefined;
      if (audioNode) {
        const onNativeEnded = () => {
          console.log('[Player] Native audio ended event fired');
          audioNode.removeEventListener('ended', onNativeEnded);
          handleEndedRef.current();
        };
        audioNode.addEventListener('ended', onNativeEnded);
        // Store for cleanup
        (howl as any).__nativeEndedListener = onNativeEnded;
      }

      // Update Media Session for background playback
      // Pass callbacks that properly update Player state (not just howl.play/pause)
      updateMediaSession(song, howl, {
        onPlay: () => {
          if (pausedRef.current) {
            togglePauseRef.current();
          }
        },
        onPause: () => {
          if (playingRef.current) {
            togglePauseRef.current();
          }
        },
        onNext: () => {
          handleEndedRef.current();
        },
      });
      if (seekTo != null && seekTo > 0) {
        howl.seek(seekTo);
      }
      startProgressSync();
    }).catch((err) => {
      if (gen !== playGenRef.current) return;
      console.error('getPlayerUrl error:', err);
      setStatus(`获取链接失败: ${song.title}，跳过`);
      setTimeout(() => handleEnded(), 2000);
    });
  }

  function stopCurrent() {
    cancelAnimationFrame(rafRef.current);
    if (howlRef.current) {
      // Clean up native audio listener if exists
      const listener = (howlRef.current as any).__nativeEndedListener;
      if (listener) {
        const audioNode = (howlRef.current as any)._sounds?.[0]?._node as HTMLAudioElement | undefined;
        if (audioNode) {
          audioNode.removeEventListener('ended', listener);
        }
      }
      howlRef.current.stop();
      howlRef.current.unload();
      howlRef.current = null;
    }
    playingRef.current = false;
    pausedRef.current = false;
    setPaused(false);
    setCurrentTime(0);
    setDuration(0);
    setLyrics([]);
    setActiveLine(-1);
  }

  function togglePause() {
    const howl = howlRef.current;
    if (!howl) return;
    if (pausedRef.current) {
      howl.play();
      playingRef.current = true;
      pausedRef.current = false;
      setPaused(false);
      setStatus(`正在播放: ${currentSongRef.current?.title ?? ''} - ${currentSongRef.current?.artist ?? ''}`);
    } else {
      howl.pause();
      playingRef.current = false;
      pausedRef.current = true;
      setPaused(true);
      setStatus('已暂停');
    }
    sendPlaybackPosition({
      position: howl.seek() as number,
      duration: howl.duration(),
      song: currentSongRef.current,
      isPaused: pausedRef.current,
    });
  }

  async function handleEnded() {
    stopCurrent();
    updateMediaSession(null); // Clear media session
    try { localStorage.removeItem(PLAYER_STATE_KEY); } catch { /* ignore */ }

    // Use preloaded song if available (seamless background advancement)
    const preloaded = preloadedSongRef.current;
    preloadedSongRef.current = null;
    preloadTriggeredRef.current = false;

    if (preloaded?.song) {
      console.log('[Player] Using preloaded song:', preloaded.song.title);
      setStatus(`正在播放: ${preloaded.song.title} - ${preloaded.song.artist}`);
      playSong(preloaded.song);
      return;
    }

    // No preload — request next song (may fail in background)
    setStatus('请求下一首...');
    try {
      const next = await requestNext();
      if (next?.song) {
        playSong(next.song);
      } else {
        setStatus('队列为空，等待点歌...');
        setCurrentSong(null);
        sendPlaybackPosition({ position: 0, duration: 0, song: null, isPaused: true });
      }
    } catch {
      retryCountRef.current += 1;
      if (retryCountRef.current > 3) {
        setStatus('请求失败，请刷新页面');
        return;
      }
      setStatus(`请求失败，${retryCountRef.current}秒后重试...`);
      setTimeout(() => handleEnded(), retryCountRef.current * 1000);
    }
  }

  handleEndedRef.current = handleEnded;
  // Expose handleEnded for Media Session nexttrack handler
  (window as any).__playerHandleEnded = handleEnded;
  togglePauseRef.current = togglePause;

  function reportPosition() {
    const howl = howlRef.current;
    sendPlaybackPosition({
      position: howl ? (howl.seek() as number) : 0,
      duration: howl ? howl.duration() : 0,
      song: currentSongRef.current,
      isPaused: pausedRef.current,
    });
  }
  reportPositionRef.current = reportPosition;

  useEffect(() => {
    startedRef.current = started;
  }, [started]);

  function seekFromEvent(e: MouseEvent<HTMLDivElement> | TouchEvent<HTMLDivElement>) {
    const bar = progressBarRef.current;
    const howl = howlRef.current;
    if (!bar || !howl) return;
    const rect = bar.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX : e.clientX;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const seekTo = ratio * howl.duration();
    howl.seek(seekTo);
    setCurrentTime(seekTo);
  }

  useEffect(() => {
    seekingRef.current = seeking;
  }, [seeking]);

  useEffect(() => {
    currentSongRef.current = currentSong;
  }, [currentSong]);

  useEffect(() => {
    if (!seeking) return;

    function handleMove(e: globalThis.MouseEvent | globalThis.TouchEvent) {
      const bar = progressBarRef.current;
      const howl = howlRef.current;
      if (!bar || !howl) return;
      const rect = bar.getBoundingClientRect();
      const clientX = 'touches' in e ? (e as globalThis.TouchEvent).touches[0]?.clientX ?? (e as globalThis.TouchEvent).changedTouches[0]?.clientX : (e as globalThis.MouseEvent).clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const seekTo = ratio * howl.duration();
      seekValueRef.current = seekTo;
      setCurrentTime(seekTo);
    }

    function handleUp() {
      const howl = howlRef.current;
      if (howl) {
        howl.seek(seekValueRef.current);
      }
      setSeeking(false);
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
  }, [seeking]);

  const handleWs = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'skip') {
      handleEndedRef.current();
    }
    if (msg.type === 'playback_control') {
      const { action, position } = msg.data as { action: string; position?: number };
      if (action === 'pause') {
        if (howlRef.current && playingRef.current) togglePauseRef.current();
      } else if (action === 'resume') {
        if (howlRef.current && pausedRef.current) {
          togglePauseRef.current();
        } else if (!howlRef.current && startedRef.current) {
          handleEndedRef.current();
        }
      } else if (action === 'start') {
        if (!howlRef.current && startedRef.current) {
          handleEndedRef.current();
        }
      } else if (action === 'seek' && position != null) {
        const howl = howlRef.current;
        if (howl && document.visibilityState === 'visible') {
          // Only apply seek when visible — ignore while in background
          howl.seek(position);
          setCurrentTime(position);
        }
      } else if (action === 'report_position') {
        reportPositionRef.current();
      }
    }
  }, []);
  useWebSocket(handleWs);

  function handleStart() {
    setStarted(true);
    requestWakeLock();

    let saved: { song: Song; position: number } | null = null;
    try {
      const raw = localStorage.getItem(PLAYER_STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.song?.id && parsed?.song?.source && typeof parsed.position === 'number' && parsed.position > 2) {
          saved = parsed;
        }
      }
    } catch { /* ignore parse errors */ }

    if (saved) {
      setStatus(`恢复上次播放: ${saved.song.title}...`);
      playSong(saved.song, saved.position);
    } else {
      setStatus('请求第一首歌...');
      requestNext().then((res) => {
        if (res?.song) {
          playSong(res.song);
        } else {
          setStatus('队列为空，等待点歌...');
        }
      });
    }
  }

  useEffect(() => {
    // Handle visibility change to re-acquire wake lock and sync playback state
    async function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && startedRef.current) {
        requestWakeLock();
        setBgSuspended(false);

        const howl = howlRef.current;

        // If howl is currently playing (e.g., resumed via Media Session lock screen controls),
        // don't trigger handleEnded — the song is already playing.
        if (howl && (playingRef.current || howl.playing())) {
          console.log('[Player] Resuming from background, howl is active');
          // Just sync the position to server
          const t = howl.seek() as number;
          sendPlaybackPosition({
            position: t,
            duration: howl.duration(),
            song: currentSongRef.current,
            isPaused: pausedRef.current,
          });
          return;
        }

        // Howl is not playing — it may have been suspended by the browser
        // Try to resume playback
        if (howl && pausedRef.current) {
          // Was paused before going to background — leave it paused
          console.log('[Player] Was paused before background, staying paused');
          return;
        }

        if (howl && !playingRef.current) {
          // Howl exists but not playing — browser may have suspended it
          console.log('[Player] Howl exists but not playing, attempting resume');
          try {
            howl.play();
            playingRef.current = true;
            pausedRef.current = false;
            setPaused(false);
            setStatus(`正在播放: ${currentSongRef.current?.title ?? ''} - ${currentSongRef.current?.artist ?? ''}`);
          } catch (e) {
            console.warn('[Player] Failed to resume playback:', e);
            setStatus('播放已暂停，请点击播放按钮恢复');
          }
          return;
        }

        // No howl — check if song should have ended
        try {
          const res = await fetch('/api/player/check-ended');
          const data = await res.json();

          if (data.shouldAdvance) {
            console.log('[Player] Song should have ended while suspended, requesting next');
            handleEndedRef.current();
          } else if (data.reason === 'still_playing') {
            console.log(`[Player] Song still playing, ${data.remaining}s remaining`);
          }
        } catch {
          // Ignore errors
        }
      } else if (document.visibilityState === 'hidden') {
        // Going to background — mark as potentially suspended
        setBgSuspended(true);
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Background keepalive - send periodic requests to prevent connection timeout
    // This helps maintain connectivity when screen is off on Android
    let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

    function startKeepalive() {
      if (keepaliveTimer) return;
      keepaliveTimer = setInterval(async () => {
        try {
          // Lightweight request to keep connection alive
          await fetch('/api/queue', { method: 'GET' });
        } catch {
          // Ignore errors - connection might be temporarily unavailable
        }
      }, 25000); // Every 25 seconds
    }

    function stopKeepalive() {
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
    }

    // Start keepalive when playback starts
    if (startedRef.current) {
      startKeepalive();
    }

    // Listen for started state changes via a MutationObserver-like approach
    // We'll use a simpler polling approach since we have access to startedRef
    const startedCheckInterval = setInterval(() => {
      if (startedRef.current && !keepaliveTimer) {
        startKeepalive();
      } else if (!startedRef.current && keepaliveTimer) {
        stopKeepalive();
      }
    }, 1000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(startedCheckInterval);
      stopKeepalive();
      releaseWakeLock();
      stopCurrent();
    };
  }, []);

  if (!started) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] p-4 text-center">
        <div className="text-6xl mb-6">🎵</div>
        <h1 className="text-2xl font-bold mb-4">PartySongs 播放端</h1>
        <p className="text-slate-400 mb-8">点击下方按钮开始播放</p>
        <button
          onClick={handleStart}
          className="bg-purple-600 hover:bg-purple-700 text-white text-lg px-8 py-3 rounded-xl font-medium transition-colors"
        >
          开始播放
        </button>

        <div className="mt-10 flex flex-col items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
          <div className="bg-white p-2 rounded-lg shadow-lg">
            <QRCode value={guestUrl} size={80} />
          </div>
          <span className="text-xs text-slate-400">扫码点歌</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-4 text-center">
      {currentSong ? (
        <>
          {currentSong.imgUrl && (
            <img
              src={currentSong.imgUrl}
              alt={currentSong.title}
              className="w-48 h-48 rounded-2xl shadow-2xl mb-4 object-cover"
            />
          )}
          <h1 className="text-3xl font-bold mb-1">{currentSong.title}</h1>
          <p className="text-xl text-slate-400 mb-1">{currentSong.artist}</p>
          {currentSong.album && <p className="text-sm text-slate-500 mb-4">{currentSong.album}</p>}

          <div
            ref={lyricsContainerRef}
            className="w-full max-w-xl h-64 overflow-y-auto scroll-smooth my-4 scrollbar-hide"
            style={{ maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)' }}
          >
            {lyrics.length > 0 ? (
              lyrics.map((line, i) => (
                <p
                  key={`${line.time}-${i}`}
                  className={`py-1.5 px-4 transition-all duration-300 ${
                    i === activeLine
                      ? 'text-white text-lg font-semibold scale-105'
                      : 'text-slate-500 text-base'
                  }`}
                >
                  {line.text}
                </p>
              ))
            ) : (
              <p className="text-slate-500 text-base py-4">暂无歌词</p>
            )}
          </div>

          <div className="w-full max-w-xl mt-2 mb-2 px-4">
            <div
              ref={progressBarRef}
              className="relative w-full h-5 flex items-center cursor-pointer group"
              onClick={seekFromEvent}
              onMouseDown={(e) => {
                seekFromEvent(e);
                setSeeking(true);
              }}
              onTouchStart={(e) => {
                seekFromEvent(e);
                setSeeking(true);
              }}
            >
              <div className="relative w-full h-1.5 bg-slate-700/60 rounded-full">
                <div
                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-purple-500 to-fuchsia-500 rounded-full"
                  style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
                />
                <div
                  className={`absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md transition-opacity ${
                    seeking ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  style={{ left: duration > 0 ? `calc(${(currentTime / duration) * 100}% - 6px)` : '-6px' }}
                />
              </div>
            </div>
            <div className="flex justify-between mt-1 text-xs text-slate-500 tabular-nums">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <button
            onClick={togglePause}
            className="mt-2 mb-2 w-10 h-10 flex items-center justify-center rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-600 transition-colors"
            title={paused ? '继续播放' : '暂停'}
          >
            {paused ? (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white ml-0.5">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-white">
                <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
              </svg>
            )}
          </button>

          <div className="mt-2 flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${bgSuspended ? 'bg-amber-400' : 'bg-green-400 animate-pulse'}`} />
            <span className="text-sm text-slate-400">{status}</span>
          </div>

          {bgSuspended && (
            <p className="mt-2 text-xs text-amber-400/80">
              息屏后台播放可能受限，如播放暂停请点击播放按钮恢复
            </p>
          )}
        </>
      ) : (
        <div className="text-center">
          <div className="text-6xl mb-4">🎵</div>
          <h1 className="text-2xl font-bold mb-2">PartySongs 播放端</h1>
          <p className="text-slate-400">{status}</p>
        </div>
      )}

      <div className="fixed bottom-4 right-4 flex flex-col items-center gap-1.5 opacity-60 hover:opacity-100 transition-opacity">
        <div className="bg-white p-2 rounded-lg shadow-lg">
          <QRCode value={guestUrl} size={80} />
        </div>
        <span className="text-xs text-slate-400">扫码点歌</span>
      </div>
    </div>
  );
}
