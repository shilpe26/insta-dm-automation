import fs from 'node:fs';
import { env, paths } from './config.js';

const BASE = `https://graph.instagram.com/${env.graphVersion}`;

// Use a refreshed token from disk if we have one, otherwise the one from .env.
let token = env.accessToken;
try {
  const saved = JSON.parse(fs.readFileSync(paths.token, 'utf8'));
  if (saved.access_token) token = saved.access_token;
} catch {}

async function call(method, path, { query = {}, body } = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = new Error(`Instagram API ${method} ${path} failed: ${data.error?.message || res.status}`);
    err.details = data.error;
    throw err;
  }
  return data;
}

export const ig = {
  me: () => call('GET', '/me', { query: { fields: 'user_id,username' } }),

  /** All of the account's media (paginated), newest first. */
  async listMedia(limit = 200) {
    const out = [];
    let page = await call('GET', '/me/media', {
      query: { fields: 'id,shortcode,permalink,media_product_type,caption,timestamp', limit: '50' },
    });
    while (page) {
      out.push(...(page.data || []));
      if (out.length >= limit || !page.paging?.next) break;
      const res = await fetch(page.paging.next);
      page = await res.json();
    }
    return out;
  },

  /** Public threaded reply under the comment. */
  replyToComment(commentId, message) {
    if (env.dryRun) return console.log(`[dry-run] reply to comment ${commentId}: ${message}`);
    return call('POST', `/${commentId}/replies`, { query: { message } });
  },

  /**
   * "Private reply": a DM to the person who wrote the comment.
   * Instagram allows ONE private reply per comment, within 7 days of the comment.
   */
  sendPrivateReply(commentId, text) {
    if (env.dryRun) return console.log(`[dry-run] DM via comment ${commentId}: ${text}`);
    return call('POST', '/me/messages', { body: { recipient: { comment_id: commentId }, message: { text } } });
  },

  /** Long-lived tokens last 60 days; refreshing extends them. Saved to data/token.json. */
  async refreshToken() {
    const url = new URL('https://graph.instagram.com/refresh_access_token');
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', token);
    const res = await fetch(url);
    const data = await res.json();
    if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);
    token = data.access_token;
    fs.writeFileSync(paths.token, JSON.stringify({ ...data, refreshed_at: new Date().toISOString() }, null, 2));
    return data;
  },
};
