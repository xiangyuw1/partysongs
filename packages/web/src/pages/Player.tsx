import { useState, useEffect, useCallback, useRef } from 'react';
import { Howl } from 'howler';
import { getPlayerUrl, requestNext, getLyrics, type Song } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';

interface LyricLine {
  time: number;
  text: string;
}

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split('\n')) {
    const matches = [...raw.matchAll(/\[(\d{2}):(\d{2})\.(\d{2,3})\]/g)];
    if (!matches.length) continue;
    const text = raw.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();
    if (!text) continue;
    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const ms = parseInt(m[3].padEnd(3, '0'), 10);
      lines.push({ time: min * 60 + sec + ms / 1000, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

export default function Player() {
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [status, setStatus] = useState('等待开始...');
  const [started, setStarted] = useState(false);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [activeLine, setActiveLine] = useState(-1);
  const howlRef = useRef<Howl | null>(null);
  const playingRef = useRef(false);
  const retryCountRef = useRef(0);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const lyricsRef = useRef<LyricLine[]>([]);

  function fetchLyrics(song: Song) {
    setLyrics([]);
    lyricsRef.current = [];
    setActiveLine(-1);
    getLyrics(song.source, song.id).then((data) => {
      if (!data?.lyric) return;
      const parsed = parseLrc(data.lyric);
      lyricsRef.current = parsed;
      setLyrics(parsed);
    });
  }

  function startLyricsSync() {
    cancelAnimationFrame(rafRef.current);
    const tick = () => {
      const howl = howlRef.current;
      if (howl && playingRef.current) {
        const t = howl.seek() as number;
        const lines = lyricsRef.current;
        let idx = -1;
        for (let i = lines.length - 1; i >= 0; i--) {
          if (t >= lines[i].time) {
            idx = i;
            break;
          }
        }
        setActiveLine((prev) => (idx !== prev ? idx : prev));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    if (lyrics.length > 0 && playingRef.current) {
      startLyricsSync();
    }
  }, [lyrics]);

  useEffect(() => {
    if (!lyricsContainerRef.current || activeLine < 0) return;
    const container = lyricsContainerRef.current;
    const activeEl = container.children[activeLine] as HTMLElement | undefined;
    if (!activeEl) return;
    const containerH = container.clientHeight;
    const offset = activeEl.offsetTop - containerH / 2 + activeEl.clientHeight / 2;
    container.scrollTo({ top: offset, behavior: 'smooth' });
  }, [activeLine]);

  function playSong(song: Song) {
    stopCurrent();
    setStatus(`获取播放链接: ${song.title}...`);
    fetchLyrics(song);

    getPlayerUrl(song).then((url) => {
      if (!url) {
        setStatus(`无法播放: ${song.title}，跳过`);
        console.warn('No URL for:', song.title, song.source);
        retryCountRef.current = 0;
        setTimeout(() => handleEnded(), 2000);
        return;
      }

      setCurrentSong(song);
      setStatus(`正在播放: ${song.title} - ${song.artist}`);
      retryCountRef.current = 0;

      const ext = url.split('?')[0].split('.').pop()?.toLowerCase();
      const formats = ext === 'm4a' ? ['m4a', 'mp4'] : ext === 'mp3' ? ['mp3'] : undefined;

      const howl = new Howl({
        src: [url],
        html5: true,
        ...(formats ? { format: formats } : {}),
        onend: () => handleEnded(),
        onloaderror: (_id, err) => {
          console.error('Load error:', err);
          setStatus(`播放失败: ${song.title}，跳过`);
          setTimeout(() => handleEnded(), 2000);
        },
      });

      howlRef.current = howl;
      playingRef.current = true;
      howl.play();
    }).catch((err) => {
      console.error('getPlayerUrl error:', err);
      setStatus(`获取链接失败: ${song.title}，跳过`);
      setTimeout(() => handleEnded(), 2000);
    });
  }

  function stopCurrent() {
    cancelAnimationFrame(rafRef.current);
    if (howlRef.current) {
      howlRef.current.stop();
      howlRef.current.unload();
      howlRef.current = null;
    }
    playingRef.current = false;
    setLyrics([]);
    setActiveLine(-1);
  }

  async function handleEnded() {
    stopCurrent();
    setStatus('请求下一首...');
    try {
      const next = await requestNext();
      if (next?.song) {
        playSong(next.song);
      } else {
        setStatus('队列为空，等待点歌...');
        setCurrentSong(null);
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

  const handleWs = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'play_song') {
      const data = msg.data as { song: Song } | null;
      if (data?.song) {
        retryCountRef.current = 0;
        playSong(data.song);
      } else {
        stopCurrent();
        setCurrentSong(null);
        setStatus('等待点歌...');
      }
    }
  }, []);
  useWebSocket(handleWs);

  function handleStart() {
    setStarted(true);
    setStatus('请求第一首歌...');
    requestNext().then((res) => {
      if (res?.song) {
        playSong(res.song);
      } else {
        setStatus('队列为空，等待点歌...');
      }
    });
  }

  useEffect(() => {
    return () => stopCurrent();
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
            className="w-full max-w-xl h-64 overflow-y-auto scroll-smooth my-4 mask-fade"
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

          <div className="mt-4 flex items-center gap-2">
            <span className="inline-block w-2 h-2 bg-green-400 rounded-full animate-pulse" />
            <span className="text-sm text-slate-400">{status}</span>
          </div>
        </>
      ) : (
        <div className="text-center">
          <div className="text-6xl mb-4">🎵</div>
          <h1 className="text-2xl font-bold mb-2">PartySongs 播放端</h1>
          <p className="text-slate-400">{status}</p>
        </div>
      )}
    </div>
  );
}
