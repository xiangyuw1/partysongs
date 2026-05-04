import crypto from 'node:crypto';
import { setQqCookie } from './qqmusic.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const APPID = '716027609';
const DAID = '383';
const PT_3RD_AID = '100497308';

interface LoginSession {
  key: string;
  status: 'pending' | 'scanned' | 'confirmed' | 'expired' | 'failed';
  qrImage: string;
  qrsig: string;
  ptqrtoken: number;
  pt_login_sig: string;
  cookies: Record<string, string>;
  createdAt: number;
  error?: string;
  uin?: string;
  nickname?: string;
  redirectUrl?: string;
}

const sessions = new Map<string, LoginSession>();
const SESSION_TTL = 180_000;

function hash33(s: string): number {
  let e = 0;
  for (const c of s) {
    e += (e << 5) + c.charCodeAt(0);
  }
  return 2147483647 & e;
}

function extractCookiesFromHeaders(headers: Headers, jar: Record<string, string>) {
  const setCookies: string[] = [];
  if (typeof headers.getSetCookie === 'function') {
    setCookies.push(...headers.getSetCookie());
  } else {
    const single = headers.get('set-cookie');
    if (single) setCookies.push(single);
  }

  for (const sc of setCookies) {
    const pair = sc.split(';')[0];
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    const key = pair.slice(0, eqIdx).trim();
    const val = pair.slice(eqIdx + 1).trim();
    if (key && val) jar[key] = val;
  }
}

export async function startQrLogin(): Promise<{ sessionKey: string; qrImage: string }> {
  const sessionKey = crypto.randomUUID();
  const jar: Record<string, string> = {};

  const xloginUrl =
    `https://xui.ptlogin2.qq.com/cgi-bin/xlogin?appid=${APPID}&daid=${DAID}` +
    `&style=33&login_text=%E6%8E%88%E6%9D%83%E5%B9%B6%E7%99%BB%E5%BD%95` +
    `&hide_title_bar=1&hide_border=1&target=self` +
    `&s_url=https%3A%2F%2Fgraph.qq.com%2Foauth2.0%2Flogin_jump` +
    `&pt_3rd_aid=${PT_3RD_AID}`;

  const xloginResp = await fetch(xloginUrl, { redirect: 'manual', headers: { 'User-Agent': UA } });
  extractCookiesFromHeaders(xloginResp.headers, jar);

  const t = Math.random().toString();
  const qrUrl =
    `https://ssl.ptlogin2.qq.com/ptqrshow?appid=${APPID}&e=2&l=M&s=3&d=72&v=4` +
    `&t=${t}&daid=${DAID}&pt_3rd_aid=${PT_3RD_AID}`;

  const qrResp = await fetch(qrUrl, { redirect: 'manual', headers: { 'User-Agent': UA } });
  extractCookiesFromHeaders(qrResp.headers, jar);

  const qrsig = jar['qrsig'] || '';
  const ptqrtoken = hash33(qrsig);
  const pt_login_sig = jar['pt_login_sig'] || '';

  if (!qrsig) throw new Error('Failed to get qrsig from QQ servers');

  const qrBuffer = Buffer.from(await qrResp.arrayBuffer());
  const qrImage = `data:image/png;base64,${qrBuffer.toString('base64')}`;

  const session: LoginSession = {
    key: sessionKey,
    status: 'pending',
    qrImage,
    qrsig,
    ptqrtoken,
    pt_login_sig,
    cookies: { ...jar },
    createdAt: Date.now(),
  };
  sessions.set(sessionKey, session);

  console.log('[QQMusic-Login] Session created:', sessionKey);
  return { sessionKey, qrImage };
}

export async function checkQrLogin(sessionKey: string): Promise<{
  status: LoginSession['status'];
  error?: string;
  uin?: string;
  nickname?: string;
  redirectUrl?: string;
}> {
  const session = sessions.get(sessionKey);
  if (!session) return { status: 'failed', error: 'Session not found' };

  if (Date.now() - session.createdAt > SESSION_TTL) {
    session.status = 'expired';
    return { status: 'expired' };
  }

  if (session.status === 'confirmed' || session.status === 'failed') {
    return { status: session.status, error: session.error, uin: session.uin, nickname: session.nickname };
  }

  const action = `0-0-${Date.now()}`;
  const params = new URLSearchParams({
    u1: 'https://graph.qq.com/oauth2.0/login_jump',
    ptqrtoken: String(session.ptqrtoken),
    ptredirect: '0', h: '1', t: '1', g: '1', from_ui: '1',
    ptlang: '2052', action,
    js_ver: '24062011', js_type: '1',
    login_sig: session.pt_login_sig,
    pt_uistyle: '40',
    aid: APPID, daid: DAID, pt_3rd_aid: PT_3RD_AID,
  });

  const cookieStr = Object.entries(session.cookies).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join('; ');

  try {
    const resp = await fetch(
      `https://ssl.ptlogin2.qq.com/ptqrlogin?${params}`,
      { headers: { 'User-Agent': UA, Cookie: cookieStr, Referer: 'https://xui.ptlogin2.qq.com/' } },
    );
    extractCookiesFromHeaders(resp.headers, session.cookies);

    const text = Buffer.from(await resp.arrayBuffer()).toString('utf-8').trim();

    const cbStart = text.indexOf("ptuiCB('");
    const cbEnd = text.lastIndexOf("')");
    if (cbStart === -1 || cbEnd === -1) {
      session.status = 'failed';
      session.error = 'QQ登录响应格式异常，请重试';
      return { status: 'failed', error: session.error };
    }

    const inner = text.slice(cbStart + 8, cbEnd);
    const parts = inner.split(/',\s*'/);
    const statusCode = parts[0] ?? '';
    const redirectUrl = parts[2] ?? '';
    const message = parts[4] ?? '';
    const nickname = parts[5] ?? '';

    console.log('[QQMusic-Login] QR status:', statusCode, message, nickname ? `(${nickname})` : '');

    switch (statusCode) {
      case '65':
        session.status = 'expired';
        break;
      case '66':
        session.status = 'pending';
        break;
      case '67':
        session.status = 'scanned';
        break;
      case '0':
        session.nickname = nickname || undefined;
        session.redirectUrl = redirectUrl;
        // Extract uin from redirect URL
        const uinMatch = redirectUrl.match(/[?&]uin=(\d+)/);
        if (uinMatch) session.uin = uinMatch[1];
        session.status = 'confirmed';
        console.log('[QQMusic-Login] QR scan success! uin:', session.uin, 'redirect:', redirectUrl?.substring(0, 80));
        break;
      default:
        session.status = 'failed';
        session.error = `Unknown status: ${statusCode} - ${message}`;
    }

    return {
      status: session.status,
      error: session.error,
      uin: session.uin,
      nickname: session.nickname,
      redirectUrl: session.status === 'confirmed' ? session.redirectUrl : undefined,
    };
  } catch (err) {
    console.error('[QQMusic-Login] Check error:', err);
    session.status = 'failed';
    session.error = `网络请求失败: ${err}`;
    return { status: 'failed', error: session.error };
  }
}

export function saveCookie(cookie: string) {
  setQqCookie(cookie);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL + 30_000) sessions.delete(key);
  }
}, 60_000);
