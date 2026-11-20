import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { env, paths, loadCampaigns, shortcodeFromUrl } from './config.js';
import { ig } from './instagram.js';
import { store } from './store.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- Campaigns: map reel media ID -> campaign. Reloaded automatically when campaigns.json changes.
const MEDIA_LOOKUP_CAP = 2000;
const RETRY_UNRESOLVED_MS = 5 * 60 * 1000;
let byMediaId = new Map();
let campaignsMtime = 0; // only set once EVERY campaign resolved
let triedMtime = 0;
let lastTry = 0;

// Our own account ids/username, so we never react to our own comments (that would loop forever).
const ownIds = new Set([env.igUserId].filter(Boolean));
let ownUsername = '';
// True only when own ids came from IG_USER_ID or a successful /me call (entry.id alone is not trusted enough).
let ownVerified = Boolean(env.igUserId);
let lastMeTry = 0;
const ME_RETRY_MS = 60 * 1000;

async function loadOwnAccount() {
  const me = await ig.me();
  for (const id of [me.id, me.user_id]) if (id) ownIds.add(String(id));
  ownUsername = (me.username || '').toLowerCase();
  ownVerified = true;
  log(`Logged in as @${me.username} (ids: ${[...ownIds].join(', ')})`);
}

// Fail closed: if our identity is unknown, retry /me (at most once a minute) and otherwise refuse to act.
async function ensureOwnAccount() {
  if (env.dryRun || ownVerified) return;
  if (Date.now() - lastMeTry < ME_RETRY_MS) return;
  lastMeTry = Date.now();
  await loadOwnAccount().catch((e) => log('WARNING Could not verify own account:', e.message));
}

// Delays before retry 1, 2, 3 of a failed DM. Override with RETRY_DELAYS_MS="200,200,200" (e.g. for tests).
const RETRY_DELAYS_MS = (process.env.RETRY_DELAYS_MS || '30000,120000,600000')
  .split(',').map((n) => Number(n.trim())).filter((n) => Number.isFinite(n) && n >= 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function refreshCampaigns() {
  const mtime = fs.statSync(paths.campaigns).mtimeMs;
  if (mtime === campaignsMtime) return;
  // File unchanged but some reels were not found: retry at most every 5 minutes.
  if (mtime === triedMtime && Date.now() - lastTry < RETRY_UNRESOLVED_MS) return;
  triedMtime = mtime; // set before any await so concurrent webhooks don't repeat the lookup
  lastTry = Date.now();
  try {
    await resolveCampaigns(mtime);
  } catch (e) {
    triedMtime = 0; // lookup failed (network/rate limit): let the next webhook retry right away
    throw e;
  }
}

async function resolveCampaigns(mtime) {
  const campaigns = loadCampaigns();
  const codeOf = (c) => (c.mediaId ? null : shortcodeFromUrl(c.reel));
  const codes = campaigns.map(codeOf).filter(Boolean);
  const findHit = (media, code) => media.find((m) => m.shortcode === code || shortcodeFromUrl(m.permalink) === code);
  const media = codes.length
    ? await ig.listMedia(MEDIA_LOOKUP_CAP, (items) => codes.every((code) => findHit(items, code)))
    : [];

  const map = new Map();
  let allResolved = true;
  for (const c of campaigns) {
    let id = c.mediaId;
    if (!id) {
      const hit = findHit(media, codeOf(c));
      if (!hit) {
        allResolved = false;
        log(`WARNING Campaign "${c.name}": reel ${c.reel} not found on your account (is it posted from this account?)`);
        continue;
      }
      id = hit.id;
    }
    map.set(String(id), c);
    log(`Watching "${c.name}" -> media ${id}`);
  }
  byMediaId = map;
  if (allResolved) campaignsMtime = mtime;
}

// ---------- Core logic for one comment
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function handleComment(value) {
  const commentId = value.id;
  const from = value.from || {};
  const mediaId = String(value.media?.id || '');
  const text = (value.text || '').trim();

  // Fail closed: without knowing our own account we could reply to ourselves forever.
  if (!env.dryRun && !ownVerified) {
    log('ERROR Own account id not verified (set IG_USER_ID or fix the access token); refusing to process comments.');
    return;
  }
  if (!from.id) return;
  if (value.parent_id) return; // a reply inside a thread; only top-level comments trigger the flow
  if (ownIds.has(String(from.id)) || (ownUsername && from.username?.toLowerCase() === ownUsername)) return;

  const campaign = byMediaId.get(mediaId);
  if (!campaign) return; // not a reel we're automating
  if (store.seenComment(commentId)) return;

  if (campaign.keywords.length && !campaign.keywords.some((k) => text.toLowerCase().includes(k))) {
    log(`skip @${from.username}: "${text}" doesn't match keywords`);
    return;
  }
  if (campaign.oncePerUser && store.userAlreadyDmed(mediaId, from.id)) {
    store.markComment(commentId, { skipped: 'already-dmed', user: from.username });
    log(`skip @${from.username}: already DMed for "${campaign.name}"`);
    return;
  }

  // Mark comment AND user synchronously, before any await, so retries/concurrent webhooks can't double-send.
  store.markComment(commentId, { campaign: campaign.name, user: from.username, text });
  if (campaign.oncePerUser) store.markUser(mediaId, from.id);
  const dm = campaign.dm.replaceAll('{username}', from.username || '');

  // The webhook is already acked, so Meta won't redeliver: retry temporary failures ourselves.
  // Comment and user stay marked while retrying so nothing double-sends.
  for (let attempt = 0; ; attempt++) {
    try {
      await ig.sendPrivateReply(commentId, dm);
      break;
    } catch (e) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (e.retryable && delay !== undefined) {
        log(`DM to @${from.username} failed (attempt ${attempt + 1}), retrying in ${delay >= 1000 ? Math.round(delay / 1000) + 's' : delay + 'ms'}:`, e.message);
        await sleep(delay);
        continue;
      }
      if (campaign.oncePerUser) store.unmarkUser(mediaId, from.id);
      if (e.retryable) store.unmarkComment(commentId); // gave up; a future redelivery may try again
      else store.markComment(commentId, { campaign: campaign.name, user: from.username, text, error: e.message });
      log(`DM to @${from.username} failed${e.retryable ? ` after ${attempt + 1} attempts, giving up` : ''}:`, e.message, e.details ? JSON.stringify(e.details) : '');
      return; // no public "Check your DM" if no DM went out
    }
  }
  log(env.dryRun ? `[dry-run] would DM @${from.username} ("${text}")` : `DM sent to @${from.username} ("${text}")`);

  const reply = pick(campaign.publicReplies);
  try {
    await ig.replyToComment(commentId, reply);
    log(env.dryRun ? `[dry-run] would reply to @${from.username}: ${reply}` : `Replied to comment by @${from.username}`);
  } catch (e) {
    log(`Public reply to @${from.username} failed:`, e.message);
  }
}

// ---------- HTTP server
const app = express();
app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf) }));

app.get('/', (_req, res) => res.send('Instagram DM automation is running.'));

// Hash both sides so the comparison is constant-time regardless of length.
function safeEqual(a, b) {
  const h = (v) => crypto.createHash('sha256').update(String(v ?? '')).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

// Meta calls this once when you register the webhook URL.
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && safeEqual(req.query['hub.verify_token'], env.verifyToken)) {
    log('Webhook verified by Meta');
    return res.status(200).type('text/plain').send(String(req.query['hub.challenge'] ?? ''));
  }
  res.sendStatus(403);
});

function validSignature(req) {
  const header = req.get('x-hub-signature-256') || '';
  const expected = 'sha256=' + crypto.createHmac('sha256', env.appSecret).update(req.rawBody || '').digest('hex');
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

app.post('/webhook', async (req, res) => {
  if (!validSignature(req)) {
    log('Rejected webhook with bad signature');
    return res.sendStatus(401);
  }
  res.sendStatus(200); // answer Meta quickly, then do the work

  try {
    await refreshCampaigns();
  } catch (e) {
    log('Could not load campaigns:', e.message);
    return;
  }
  await ensureOwnAccount();
  const jobs = [];
  for (const entry of req.body.entry || []) {
    if (entry.id) ownIds.add(String(entry.id)); // webhook entries are addressed to our own account
    for (const change of entry.changes || []) {
      if (change.field === 'comments' || change.field === 'live_comments') {
        // Not awaited one by one: a comment waiting to retry its DM must not hold up the others.
        jobs.push(handleComment(change.value).catch((e) => log('handleComment error:', e.message)));
      }
    }
  }
  await Promise.all(jobs);
});

// Malformed JSON etc.: plain short answer, no stack trace.
app.use((err, _req, res, _next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).type('text/plain').send(status === 500 ? 'Internal Server Error' : 'Bad Request');
});

// ---------- Startup
async function start() {
  if (!env.dryRun) {
    try {
      lastMeTry = Date.now();
      await loadOwnAccount();
    } catch (e) {
      log('WARNING Could not verify access token:', e.message);
    }
    if (!ownVerified) log('ERROR Own account id unknown (set IG_USER_ID); comments will be ignored until it is known.');
    // Refresh the long-lived token shortly after startup, then once a day so it never expires.
    const refresh = () => ig.refreshToken().then(() => log('Access token refreshed')).catch((e) => log(e.message));
    setTimeout(refresh, 60 * 1000).unref();
    setInterval(refresh, 24 * 60 * 60 * 1000).unref();
  }
  await refreshCampaigns().catch((e) => log('Could not load campaigns:', e.message));
  app.listen(env.port, () => log(`Listening on :${env.port}  (webhook path: /webhook${env.dryRun ? ', DRY RUN' : ''})`));
}
start();
