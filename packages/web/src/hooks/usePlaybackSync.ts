import { useEffect, useRef, useCallback, useState } from 'react';
import { getLyrics, type Song } from '../api';
import { parseLrc, findCurrentLyricLine, type LyricLine } from '../utils';

interface PlaybackState {
  position: number;
  duration: number;
  song: Song | null;
  isPaused: boolean;
  receivedAt: number; // performance.now() timestamp
}

interface UsePlaybackSyncReturn {
  /** Current song (from latest server sync) */
  song: Song | null;
  /** Interpolated playback position (smooth, updates every frame) */
  position: number;
  /** Song duration */
  duration: number;
  /** Whether playback is paused */
  isPaused: boolean;
  /** Current lyric text (updates smoothly with position) */
  currentLyricText: string;
  /** Current lyric line index (-1 if none) */
  currentLyricIndex: number;
  /** All parsed lyric lines for the current song */
  lyrics: LyricLine[];
  /**
   * Call this when receiving a `playback_position` WebSocket message.
   * The hook will snap to the server position and continue interpolating.
   */
  handleSync: (data: { position: number; duration: number; song: Song | null; isPaused: boolean }) => void;
  /**
   * Override the displayed position (e.g., during admin seek).
   * Pass null to resume normal interpolation.
   */
  setOverridePosition: (pos: number | null) => void;
}

/**
 * Shared playback synchronization hook for Guest and Admin pages.
 *
 * Receives periodic `playback_position` WebSocket broadcasts from the Player,
 * then interpolates locally via requestAnimationFrame for smooth progress display.
 * Also handles lyrics fetching and current-line tracking.
 */
export function usePlaybackSync(): UsePlaybackSyncReturn {
  const [song, setSong] = useState<Song | null>(null);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPaused, setIsPaused] = useState(true);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLyricIndex, setCurrentLyricIndex] = useState(-1);
  const [currentLyricText, setCurrentLyricText] = useState('');

  // Refs for the RAF loop (avoid stale closures)
  const stateRef = useRef<PlaybackState>({
    position: 0,
    duration: 0,
    song: null,
    isPaused: true,
    receivedAt: 0,
  });
  const lyricsRef = useRef<LyricLine[]>([]);
  const overrideRef = useRef<number | null>(null);
  const rafRef = useRef(0);
  const lastLyricIdxRef = useRef(-2); // -2 = uninitialized, -1 = no lyric

  // The RAF tick function — runs every frame
  const tick = useCallback(() => {
    const s = stateRef.current;
    const override = overrideRef.current;

    let displayPos: number;
    if (override !== null) {
      // Admin is seeking — show override position
      displayPos = override;
    } else if (!s.song || s.isPaused) {
      // No song or paused — show exact server position
      displayPos = s.position;
    } else {
      // Playing — interpolate from server position
      const elapsed = (performance.now() - s.receivedAt) / 1000;
      displayPos = Math.min(s.position + elapsed, s.duration);
    }

    // Update position state (triggers re-render)
    setPosition(displayPos);

    // Update current lyric line
    const lines = lyricsRef.current;
    if (lines.length > 0 && s.song && !s.isPaused) {
      const idx = findCurrentLyricLine(lines, displayPos);
      if (idx !== lastLyricIdxRef.current) {
        lastLyricIdxRef.current = idx;
        setCurrentLyricIndex(idx);
        setCurrentLyricText(idx >= 0 ? lines[idx].text : '');
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  // Start/stop the RAF loop
  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  // Fetch lyrics when song changes
  useEffect(() => {
    if (!song) {
      setLyrics([]);
      lyricsRef.current = [];
      setCurrentLyricIndex(-1);
      setCurrentLyricText('');
      lastLyricIdxRef.current = -2;
      return;
    }
    // Reset lyrics immediately
    setLyrics([]);
    lyricsRef.current = [];
    setCurrentLyricIndex(-1);
    setCurrentLyricText('');
    lastLyricIdxRef.current = -2;

    getLyrics(song.source, song.id, song.title, song.artist).then((data) => {
      if (!data?.lyric) return;
      const parsed = parseLrc(data.lyric);
      lyricsRef.current = parsed;
      setLyrics(parsed);
    }).catch(() => {});
  }, [song?.source, song?.id]);

  // Called when receiving playback_position from WebSocket
  const handleSync = useCallback((data: { position: number; duration: number; song: Song | null; isPaused: boolean }) => {
    const now = performance.now();

    // Check if song changed
    const prevSong = stateRef.current.song;
    const songChanged = (!prevSong && data.song) ||
      (prevSong && !data.song) ||
      (prevSong && data.song && (prevSong.id !== data.song.id || prevSong.source !== data.song.source));

    // If we received a new position from server, clear any seek override
    // (Player has acknowledged the seek and is reporting the new position)
    if (overrideRef.current !== null) {
      overrideRef.current = null;
    }

    stateRef.current = {
      position: data.position,
      duration: data.duration,
      song: data.song,
      isPaused: data.isPaused,
      receivedAt: now,
    };

    // Update React state for song/duration/paused (these don't need per-frame updates)
    if (songChanged) {
      setSong(data.song);
    }
    setDuration(data.duration);
    setIsPaused(data.isPaused);

    // When paused, update position and lyric immediately
    if (data.isPaused) {
      setPosition(data.position);
      const lines = lyricsRef.current;
      if (lines.length > 0) {
        const idx = findCurrentLyricLine(lines, data.position);
        if (idx !== lastLyricIdxRef.current) {
          lastLyricIdxRef.current = idx;
          setCurrentLyricIndex(idx);
          setCurrentLyricText(idx >= 0 ? lines[idx].text : '');
        }
      }
    }
  }, []);

  // Override position for admin seeking
  const setOverridePosition = useCallback((pos: number | null) => {
    overrideRef.current = pos;
  }, []);

  return {
    song,
    position,
    duration,
    isPaused,
    currentLyricText,
    currentLyricIndex,
    lyrics,
    handleSync,
    setOverridePosition,
  };
}
