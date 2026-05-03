export interface Song {
  id: string;
  source: MusicSource;
  title: string;
  artist: string;
  album?: string;
  imgUrl?: string;
  duration?: number;
}

export interface QueueItem {
  id: number;
  songId: string;
  source: MusicSource;
  title: string;
  artist: string;
  album: string | null;
  imgUrl: string | null;
  userId: string;
  userName: string | null;
  status: 'pending' | 'playing' | 'done' | 'skipped';
  createdAt: string;
}

export interface FallbackPlaylist {
  id: number;
  name: string;
  songs: Song[];
  isActive: boolean;
  createdAt: string;
}

export interface PlaybackState {
  currentQueueItemId: number | null;
  currentFallbackIndex: number;
  mode: 'queue_first' | 'fallback_only';
  volume: number;
  isPlaying: boolean;
}

export type MusicSource = 'netease' | 'tencent' | 'kugou' | 'kuwo' | 'migu' | 'baidu';

export interface SearchResult {
  songs: Song[];
  total: number;
}

export interface WsMessage {
  type: 'queue_update' | 'play_song' | 'playback_state' | 'fallback_update';
  data: unknown;
}
