import fs from 'node:fs';
import crypto from 'node:crypto';
import { env, paths } from './config.js';
import { writeJsonAtomic } from './atomic.js';

const BASE = `https://graph.instagram.com/${env.graphVersion}`;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Use the refreshed token from disk only if it was refreshed from the token currently in .env.
// If you put a new token in .env, it wins over the saved one.
let token = env.accessToken;
try {
  const saved = JSON.parse(fs.readFileSync(paths.token, 'utf8'));
  if (saved.access_token && saved.origin === sha256(env.accessToken)) token = saved.access_token;
} catch {}

// Instagram/Graph rate-limit error codes.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/** `path` is an API path, or a full URL (used for pagination links). */
async function call(method, path, { query = {}, body } = {}) {
  const url = new URL(path.startsWith('http') ? path : BASE + path);
  // Pagination links come from API responses; never send our token anywhere but Instagram.
  if (url.protocol !== 'https:' || url.hostname !== 'graph.instagram.com') {
    throw new Error(`Refusing to call unexpected host ${url.hostname}`);
  }
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const label = `${method} ${url.pathname}`; // never log the query string (may contain tokens)
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const err = new Error(`Instagram API ${label} network error: ${e.message}`);
    err.retryable = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error(`Instagram API ${label} failed: ${data.error?.message || res.status}`);
    err.details = data.error;
    err.status = res.status;
    // Worth retrying later: server errors, rate limits, transient errors. Other 4xx are permanent.
    const code = data.error?.code;
    err.retryable =
      res.status >= 500 || res.status === 429 || RATE_LIMIT_CODES.has(code) || code === 2 || data.error?.is_transient === true;
    throw err;
  }
  return data;
}

export const ig = {
  me: () => call('GET', '/me', { query: { fields: 'id,user_id,username' } }),

  /**
   * The account's media (paginated), newest first. Stops at `limit` items,
   * or as soon as `isDone(items)` returns true.
   */
  async listMedia(limit = 200, isDone = () => false) {
    const out = [];
    let page = await call('GET', '/me/media', {
      query: { fields: 'id,shortcode,permalink,media_product_type,caption,timestamp', limit: '50' },
    });
    while (page) {
      out.push(...(page.data || []));
      if (out.length >= limit || isDone(out) || !page.paging?.next) break;
      page = await call('GET', page.paging.next);
    }
    return out;
  },

  /** Public threaded reply under the comment. */
  replyToComment(commentId, message) {
    if (env.dryRun) return;
    return call('POST', `/${commentId}/replies`, { body: { message } });
  },

  /**
   * "Private reply": a DM to the person who wrote the comment.
   * Instagram allows ONE private reply per comment, within 7 days of the comment.
   */
  sendPrivateReply(commentId, text) {
    if (env.dryRun) return;
    return call('POST', '/me/messages', { body: { recipient: { comment_id: commentId }, message: { text } } });
  },

  /** Long-lived tokens last 60 days; refreshing extends them. Saved to data/token.json. */
  async refreshToken() {
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', token);
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(`Token refresh failed: ${data.error?.message || res.status}`);
    token = data.access_token;
    writeJsonAtomic(
      paths.token,
      { ...data, origin: sha256(env.accessToken), refreshed_at: new Date().toISOString() },
      0o600,
    );
    return data;
  },
};
