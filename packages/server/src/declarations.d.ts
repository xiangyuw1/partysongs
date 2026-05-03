declare module '@meting/core' {
  class Meting {
    constructor(server?: string);
    search(keyword: string, options?: { limit?: number; page?: number; type?: number }): Promise<any>;
    url(id: string): Promise<any>;
    song(id: string): Promise<any>;
    playlist(id: string): Promise<any>;
    album(id: string): Promise<any>;
    artist(id: string): Promise<any>;
    lyric(id: string): Promise<any>;
    pic(id: string): Promise<any>;
    site(server: string): Meting;
    cookie(cookie: string): Meting;
    format(enable: boolean): Meting;
  }
  export default Meting;
}

declare module 'migu-music-api' {
  function migu(action: string, params?: Record<string, any>): Promise<any>;
  export default migu;
}
