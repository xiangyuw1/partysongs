/**
 * Minimal HTTP client for upstream APIs.
 *
 * Uses node:http/https instead of the global fetch (undici) on purpose:
 * Cloudflare's bot protection challenges undici's TLS/HTTP fingerprint with a
 * "Just a moment..." 403 page, while plain node:https requests pass. Confirmed
 * on the deployment server: fetch → 403, https.get → 200 for the same URL.
 * Node 22's fetch is blocked too, so this is not a Node version issue.
 */
import { request as httpsRequest } from 'node:https';
import { request as httpRequest, type IncomingMessage } from 'node:http';

export interface HttpTextResponse {
  status: number;
  headers: IncomingMessage['headers'];
  body: string;
}

export interface HttpTextOptions {
  headers?: Record<string, string>;
  /** Socket timeout per attempt, ms. */
  timeoutMs?: number;
  /** Extra attempts after the first one. Applies to network errors and 5xx. */
  retries?: number;
}

function once(url: URL, headers: Record<string, string>, timeoutMs: number): Promise<HttpTextResponse> {
  const request = url.protocol === 'http:' ? httpRequest : httpsRequest;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    // Explicit deadline: the `timeout` request option does not fire at the
    // requested moment (measured ~2x on Node 24), so drive it ourselves.
    const timer = setTimeout(() => {
      req.destroy(new Error(`request timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    const req = request(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () =>
        finish(() =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
          })
        )
      );
      res.on('error', (err) => finish(() => reject(err)));
    });
    req.on('timeout', () => req.destroy(new Error(`request timeout after ${timeoutMs}ms`)));
    req.on('error', (err) => finish(() => reject(err)));
    req.end();
  });
}

/**
 * GET a URL as text. `Accept-Encoding: identity` is requested so the body is
 * never compressed and needs no decompression step (payloads here are small).
 */
export async function httpGetText(url: string, options: HttpTextOptions = {}): Promise<HttpTextResponse> {
  const parsed = new URL(url);
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 1;
  const headers: Record<string, string> = {
    'Accept-Encoding': 'identity',
    ...options.headers,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await once(parsed, headers, timeoutMs);
      if (res.status >= 500 && attempt < retries) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
