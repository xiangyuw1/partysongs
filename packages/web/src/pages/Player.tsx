import { useState, useEffect, useCallback, useRef } from 'react';
import { Howl } from 'howler';
import { getPlayerUrl, requestNext, type Song } from '../api';
import { useWebSocket } from '../hooks/useWebSocket';

export default function Player() {
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [status, setStatus] = useState('等待开始...');
  const howlRef = useRef<Howl | null>(null);
  const playingRef = useRef(false);

  function playSong(song: Song) {
    stopCurrent();
    setStatus(`获取播放链接: ${song.title}...`);

    getPlayerUrl(song).then((url) => {
      if (!url) {
        setStatus(`无法播放: ${song.title}，跳过`);
        setTimeout(() => handleEnded(), 2000);
        return;
      }

      setCurrentSong(song);
      setStatus(`正在播放: ${song.title} - ${song.artist}`);

      const howl = new Howl({
        src: [url],
        html5: true,
        format: ['mp3'],
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
      setStatus('请求失败，重试中...');
      setTimeout(() => handleEnded(), 3000);
    }
  }

  const handleWs = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'play_song') {
      const data = msg.data as { song: Song } | null;
      if (data?.song) {
        playSong(data.song);
      } else {
        stopCurrent();
        setCurrentSong(null);
        setStatus('等待点歌...');
      }
    }
  }, []);
  useWebSocket(handleWs);

  useEffect(() => {
    requestNext().then((res) => {
      if (res?.song) {
        playSong(res.song);
      }
    });
    return () => stopCurrent();
  }, []);

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
