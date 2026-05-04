import { useState, useEffect, useCallback, useRef } from 'react';
import { Howl } from 'howler';
import { getPlayerUrl, requestNext, type Song } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';

export default function Player() {
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [status, setStatus] = useState('等待开始...');
  const [started, setStarted] = useState(false);
  const howlRef = useRef<Howl | null>(null);
  const playingRef = useRef(false);
  const retryCountRef = useRef(0);

  function playSong(song: Song) {
    stopCurrent();
    setStatus(`获取播放链接: ${song.title}...`);

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
    if (howlRef.current) {
      howlRef.current.stop();
      howlRef.current.unload();
      howlRef.current = null;
    }
    playingRef.current = false;
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
              className="w-48 h-48 rounded-2xl shadow-2xl mb-6 object-cover"
            />
          )}
          <h1 className="text-3xl font-bold mb-2">{currentSong.title}</h1>
          <p className="text-xl text-slate-400 mb-2">{currentSong.artist}</p>
          {currentSong.album && <p className="text-sm text-slate-500">{currentSong.album}</p>}
          <div className="mt-8 flex items-center gap-2">
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
