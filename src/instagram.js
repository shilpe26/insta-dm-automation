import fs from 'node:fs';
import crypto from 'node:crypto';
import { env, paths } from './config.js';
import { writeJsonAtomic } from './atomic.js';

const UNIFIED = env.apiMode === 'unified';
const HOST = UNIFIED ? 'graph.facebook.com' : 'graph.instagram.com';
const BASE = `https://${HOST}/${env.graphVersion}`;
const TIMEOUT_MS = 15000;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Use the refreshed token from disk only if it was refreshed from the token currently in .env.
// If you put a new token in .env, it wins over the saved one.
let token = env.accessToken;
// Unified mode: the Instagram account id used in API paths (instead of /me).
let igId = env.igUserId;
const owner = () => {
  if (!UNIFIED) return '/me';
  if (!igId) throw new Error('Instagram account id unknown (set IG_USER_ID)');
  return `/${igId}`;
};
// (Unified mode uses a non-refreshable system-user token, so nothing is ever saved or loaded.)
if (!UNIFIED) try {
  const saved = JSON.parse(fs.readFileSync(paths.token, 'utf8'));
  if (saved.access_token && saved.origin === sha256(env.accessToken)) token = saved.access_token;
} catch {}

// Instagram/Graph rate-limit error codes.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

/** `path` is an API path, or a full URL (used for pagination links). */
async function call(method, path, { query = {}, body, detectAlreadySent = false } = {}) {
  const url = new URL(path.startsWith('http') ? path : BASE + path);
  // Pagination links come from API responses; never send our token anywhere but Instagram.
  if (url.protocol !== 'https:' || url.hostname !== HOST) {
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Network failures are temporary, so retryable.
    const err = new Error(`Instagram API ${label} network error: ${e.message}`);
    err.retryable = true;
    // Only a timeout leaves the outcome unknown (the request may have reached Instagram).
    // Connection refused / DNS failures mean it never got there, so they are not ambiguous.
    err.ambiguous = e?.name === 'TimeoutError' || e?.name === 'AbortError';
    throw err;
  }
  let data;
  try {
    const raw = await res.text();
    // A POST may legitimately come back empty; a GET (and any non-empty body) must be valid JSON.
    data = raw.trim() === '' && method !== 'GET' ? {} : JSON.parse(raw);
  } catch (e) {
    if (!res.ok) data = {}; // error status: the status code below is enough
    else {
      // 200 but unreadable body (or body read timed out): don't pretend it worked with {}.
      const err = new Error(`Instagram API ${label} returned an unreadable response: ${e.message}`);
      err.retryable = true;
      err.ambiguous = true; // Instagram answered 200, so the action probably happened
      throw err;
    }
  }
  if (!res.ok || data.error) {
    const err = new Error(`Instagram API ${label} failed: ${data.error?.message || res.status}`);
    err.details = data.error;
    err.status = res.status;
    // Worth retrying later: server errors, rate limits, transient errors. Other 4xx are permanent.
    const code = data.error?.code;
    err.retryable =
      res.status >= 500 || res.status === 429 || RATE_LIMIT_CODES.has(code) || code === 2 || data.error?.is_transient === true;
    if (detectAlreadySent) {
      // Only a 4xx whose message clearly says a private reply was already sent counts as delivered.
      const msg = String(data.error?.message || '');
      const clientError = res.status >= 400 && res.status < 500;
      const says = /already\s+(been\s+)?(sent|replied)|already\s+(has|have)\s+a\s+private\s+reply/i.test(msg);
      const other = /deleted|blocked|not\s+found|cannot/i.test(msg);
      // Subcode 1545041 is UNVERIFIED (an assumption about Meta's "already replied" code); only trusted with a 4xx.
      err.alreadySent = clientError && !other && (says || data.error?.error_subcode === 1545041);
    }
    throw err;
  }
  return data;
}

export const ig = {
  mode: env.apiMode,
  setIgId(id) {
    igId = String(id);
  },
  getIgId: () => igId,

  /** Unified mode: Instagram accounts the system user can use. (/me is the system user, not the account.) */
  async assignedAccounts() {
    const out = [];
    let page = await call('GET', '/me/assigned_instagram_accounts', { query: { fields: 'id,username' } });
    while (page) {
      out.push(...(page.data || []));
      if (!page.paging?.next) break;
      page = await call('GET', page.paging.next);
    }
    return out;
  },

  /** Unified mode: id + username of one Instagram account. */
  account: (id) => call('GET', `/${id}`, { query: { fields: 'id,username' } }),

  /** Instagram-login mode only. */
  me: () => call('GET', '/me', { query: { fields: 'id,user_id,username' } }),

  /**
   * The account's media (paginated), newest first. Stops at `limit` items,
   * or as soon as `isDone(items)` returns true.
   */
  async listMedia(limit = 200, isDone = () => false) {
    const out = [];
    let page = await call('GET', `${owner()}/media`, {
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
    return call('POST', `${owner()}/messages`, {
      body: { recipient: { comment_id: commentId }, message: { text } },
      detectAlreadySent: true,
    });
  },

  /** Long-lived tokens last 60 days; refreshing extends them. Saved to data/token.json. */
  async refreshToken() {
    if (UNIFIED) throw new Error('System-user tokens cannot be refreshed');
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', token);
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
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
