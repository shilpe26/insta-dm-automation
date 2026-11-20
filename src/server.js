import express from 'express';
import crypto from 'node:crypto';
import { env, campaignsVersion, loadCampaigns, shortcodeFromUrl } from './config.js';
import { registerPages, warnIfPlaceholders } from './pages.js';
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
// True once the username lookup succeeded (needed to spot our own comments by name).
let usernameLoaded = false;
let lastMeTry = 0;
const ME_RETRY_MS = 60 * 1000;

async function loadOwnAccount() {
  if (env.apiMode === 'unified') return loadOwnAccountUnified();
  const me = await ig.me();
  for (const id of [me.id, me.user_id]) if (id) ownIds.add(String(id));
  ownUsername = (me.username || '').toLowerCase();
  usernameLoaded = true;
  ownVerified = true;
  log(`Logged in as @${me.username} (ids: ${[...ownIds].join(', ')})`);
}

// Unified login: /me is the system user, so the Instagram account comes from IG_USER_ID or /me/assigned_instagram_accounts.
async function loadOwnAccountUnified() {
  let id = env.igUserId;
  if (!id) {
    const accounts = await ig.assignedAccounts();
    if (accounts.length === 0) throw new Error('No Instagram accounts are assigned to this token (assign one in the system-user configuration)');
    if (accounts.length > 1) {
      log(`Several Instagram accounts are assigned to this token; set IG_USER_ID to one of: ${accounts.map((a) => `${a.id} (@${a.username})`).join(', ')}`);
      throw new Error('IG_USER_ID is required when several Instagram accounts are assigned');
    }
    id = String(accounts[0].id);
    log(`Using the only assigned Instagram account: ${id} (@${accounts[0].username})`);
  }
  ig.setIgId(id);
  ownIds.add(id);
  const acct = await ig.account(id); // if this fails we stay unverified (unless IG_USER_ID was given)
  if (acct.id) ownIds.add(String(acct.id));
  ownUsername = (acct.username || '').toLowerCase();
  usernameLoaded = true;
  ownVerified = true;
  log(`Instagram account @${acct.username} (id: ${id})`);
}

// Fail closed: if our identity is unknown, retry (at most once a minute) and otherwise refuse to act.
// Concurrent callers share one in-flight lookup.
let ownInflight = null;
function ensureOwnAccount() {
  if (ownInflight) return ownInflight;
  // Dry run skips lookups, except unified mode needs the account id (to list reels) while it is still unknown.
  if (env.dryRun && !(env.apiMode === 'unified' && !ig.getIgId())) return Promise.resolve();
  if (ownVerified && usernameLoaded) return Promise.resolve();
  if (Date.now() - lastMeTry < ME_RETRY_MS) return Promise.resolve();
  lastMeTry = Date.now();
  if (ownVerified) log('WARNING Own username not loaded yet; retrying the lookup (comments are matched by id only until then).');
  ownInflight = loadOwnAccount()
    .catch((e) => log('WARNING Could not verify own account:', e.message))
    .finally(() => { ownInflight = null; });
  return ownInflight;
}

// Delays before retry 1, 2, 3 of a failed DM. Override with RETRY_DELAYS_MS="200,200,200" (e.g. for tests).
const retryParts = (process.env.RETRY_DELAYS_MS || '30000,120000,600000').split(',').map((n) => n.trim()).filter((n) => n !== '');
const RETRY_DELAYS_MS = retryParts.map(Number).filter((n) => Number.isFinite(n) && n >= 0);
if (RETRY_DELAYS_MS.length !== retryParts.length) {
  log(`WARNING RETRY_DELAYS_MS contains non-numeric or negative parts; ignoring them (using: ${RETRY_DELAYS_MS.join(',') || 'no retries'})`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Concurrent callers await the same lookup instead of returning early with an empty map.
// If it fails, byMediaId keeps the last good map (it is only replaced on success).
let campaignsInflight = null;
function refreshCampaigns() {
  if (campaignsInflight) return campaignsInflight;
  campaignsInflight = refreshCampaignsOnce().finally(() => { campaignsInflight = null; });
  return campaignsInflight;
}

async function refreshCampaignsOnce() {
  const mtime = campaignsVersion();
  if (mtime === campaignsMtime) return;
  // File unchanged but some reels were not found: retry at most every 5 minutes.
  if (mtime === triedMtime && Date.now() - lastTry < RETRY_UNRESOLVED_MS) return;
  triedMtime = mtime;
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
  if (!allResolved) {
    // Keep what we already knew for campaigns that didn't resolve this time (same name + same reel),
    // so a partial or empty media list never drops a reel we were watching.
    for (const c of campaigns) {
      if (c.mediaId || [...map.values()].includes(c)) continue;
      for (const [oldId, old] of byMediaId) {
        if (old.name === c.name && old.reel === c.reel && !map.has(oldId)) {
          map.set(oldId, c);
          log(`Keeping previous media ${oldId} for "${c.name}"`);
          break;
        }
      }
    }
  }
  byMediaId = map;
  if (allResolved) campaignsMtime = mtime;
}

// ---------- Core logic for one comment
// Second comments that arrived while the user's first DM was still pending (in memory only), keyed by media:user.
const heldComments = new Map();
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
    if (store.userPending(mediaId, from.id)) {
      // Their first DM is still being sent (or retried). Don't mark this comment, so it isn't skipped for good.
      // Remember it: if the first DM ends up failing, the newest held comment is replayed.
      const key = `${mediaId}:${from.id}`;
      const list = heldComments.get(key) || [];
      list.push(value);
      heldComments.set(key, list.slice(-20));
      log(`hold @${from.username}: first DM for "${campaign.name}" still pending, leaving this comment unmarked`);
      return;
    }
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
  const heldKey = `${mediaId}:${from.id}`;
  let ambiguous = false; // an attempt was inconclusive (timeout, dropped connection or unreadable reply): the DM may have gone out anyway
  for (let attempt = 0; ; attempt++) {
    try {
      await ig.sendPrivateReply(commentId, dm);
      if (campaign.oncePerUser) store.finishUser(mediaId, from.id);
      heldComments.delete(heldKey);
      break;
    } catch (e) {
      if (e.alreadySent) {
        // Instagram says this comment already got its private reply: treat as delivered.
        log(`DM to @${from.username}: Instagram reports the private reply was already sent, treating as delivered`);
        if (campaign.oncePerUser) store.finishUser(mediaId, from.id);
        heldComments.delete(heldKey);
        break;
      }
      if (e.ambiguous) ambiguous = true;
      const delay = RETRY_DELAYS_MS[attempt];
      if (e.retryable && delay !== undefined) {
        log(`DM to @${from.username} failed (attempt ${attempt + 1}), retrying in ${delay >= 1000 ? Math.round(delay / 1000) + 's' : delay + 'ms'}:`, e.message);
        await sleep(delay);
        continue;
      }
      log(`DM to @${from.username} failed${e.retryable ? ` after ${attempt + 1} attempts, giving up` : ''}:`, e.message, e.details ? JSON.stringify(e.details) : '');
      if (ambiguous) {
        // Fail closed against double-DMs: keep the person and comment marked, and don't replay held comments.
        log(`WARNING @${from.username} may already have received the DM (an earlier attempt was inconclusive); keeping them marked as DMed`);
        log(`ACTION NEEDED: could not confirm DM to @${from.username} for comment ${commentId} on ${campaign.name}; check Instagram and DM them manually if needed`);
        if (campaign.oncePerUser) store.finishUser(mediaId, from.id);
        heldComments.delete(heldKey);
        return;
      }
      if (campaign.oncePerUser) store.unmarkUser(mediaId, from.id);
      if (e.retryable) store.unmarkComment(commentId); // gave up; a future redelivery may try again
      else store.markComment(commentId, { campaign: campaign.name, user: from.username, text, error: e.message });
      // Person is unmarked now: give their newest held comment its own chance.
      const held = heldComments.get(heldKey);
      heldComments.delete(heldKey);
      if (held?.length) {
        log(`Replaying the newest held comment from @${from.username}`);
        await handleComment(held[held.length - 1]);
      }
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

registerPages(app);

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
    await ensureOwnAccount(); // first: in unified mode the media lookup needs the account id
    try {
      await refreshCampaigns();
    } catch (e) {
      log('Could not reload campaigns (using the last good list):', e.message);
    }
    const jobs = [];
    for (const entry of req.body?.entry || []) {
      // Webhook entries are addressed to our own account; only trust the id if it can't contradict IG_USER_ID.
      if (entry.id && (!env.igUserId || String(entry.id) === env.igUserId)) ownIds.add(String(entry.id));
      for (const change of entry.changes || []) {
        if ((change.field === 'comments' || change.field === 'live_comments') && change.value) {
          // Not awaited one by one: a comment waiting to retry its DM must not hold up the others.
          jobs.push(handleComment(change.value).catch((e) => log('handleComment error:', e.message)));
        }
      }
    }
    await Promise.all(jobs);
  } catch (e) {
    log('Webhook processing error:', e.message);
  }
});

// Malformed JSON etc.: plain short answer, no stack trace.
app.use((err, _req, res, _next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  res.status(status).type('text/plain').send(status === 500 ? 'Internal Server Error' : 'Bad Request');
});

// ---------- Startup
async function start() {
  const unified = env.apiMode === 'unified';
  if (unified) ig.setIgId(env.igUserId);
  // Dry run skips API calls, except that unified mode needs the account id to look up reels (best effort).
  if (!env.dryRun || (unified && !env.igUserId)) {
    try {
      await loadOwnAccount(); // lastMeTry stays 0 so the first webhook after a failed startup retries at once
    } catch (e) {
      log('WARNING Could not verify access token / account:', e.message);
    }
    if (!ownVerified && !env.dryRun) log('ERROR Own account id unknown (set IG_USER_ID); comments will be ignored until it is known.');
  }
  if (unified) {
    log('Unified login: the token is a system-user token (not refreshable); no automatic refresh.');
  } else if (!env.dryRun) {
    // Refresh the long-lived token shortly after startup, then once a day so it never expires.
    const refresh = () => ig.refreshToken().then(() => log('Access token refreshed')).catch((e) => log(e.message));
    setTimeout(refresh, 60 * 1000).unref();
    setInterval(refresh, 24 * 60 * 60 * 1000).unref();
  }
  await refreshCampaigns().catch((e) => log('Could not load campaigns:', e.message));
  warnIfPlaceholders(log);
  app.listen(env.port, () => log(`Listening on :${env.port}  (webhook path: /webhook${env.dryRun ? ', DRY RUN' : ''})`));
}
start();
