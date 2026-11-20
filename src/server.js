import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { env, paths, loadCampaigns, shortcodeFromUrl } from './config.js';
import { ig } from './instagram.js';
import { store } from './store.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- Campaigns: map reel media ID -> campaign. Reloaded automatically when campaigns.json changes.
let byMediaId = new Map();
let campaignsMtime = 0;
let ownUserId = env.igUserId;
let ownUsername = '';

async function refreshCampaigns() {
  const mtime = fs.statSync(paths.campaigns).mtimeMs;
  if (mtime === campaignsMtime) return;
  const campaigns = loadCampaigns();
  const needLookup = campaigns.some((c) => !c.mediaId);
  const media = needLookup ? await ig.listMedia() : [];
  const map = new Map();
  for (const c of campaigns) {
    let id = c.mediaId;
    if (!id) {
      const code = shortcodeFromUrl(c.reel);
      const hit = media.find((m) => m.shortcode === code || shortcodeFromUrl(m.permalink) === code);
      if (!hit) {
        log(`⚠️  Campaign "${c.name}": reel ${c.reel} not found on your account (is it posted from this account?)`);
        continue;
      }
      id = hit.id;
    }
    map.set(String(id), c);
    log(`✅ Watching "${c.name}" -> media ${id}`);
  }
  byMediaId = map;
  campaignsMtime = mtime;
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

  // Never react to our own comments/replies (otherwise we'd loop forever).
  if (from.id && (from.id === ownUserId || from.username === ownUsername)) return;

  const campaign = byMediaId.get(mediaId);
  if (!campaign) return; // not a reel we're automating
  if (store.seenComment(commentId)) return;

  if (campaign.keywords.length && !campaign.keywords.some((k) => text.toLowerCase().includes(k))) {
    log(`skip @${from.username}: "${text}" doesn't match keywords`);
    return;
  }
  if (campaign.oncePerUser && store.userAlreadyDmed(campaign.name, from.id)) {
    store.markComment(commentId, { skipped: 'already-dmed', user: from.username });
    log(`skip @${from.username}: already DMed for "${campaign.name}"`);
    return;
  }

  // Mark first so a webhook retry can't double-send.
  store.markComment(commentId, { campaign: campaign.name, user: from.username, text });
  const dm = campaign.dm.replaceAll('{username}', from.username || '');

  try {
    await ig.sendPrivateReply(commentId, dm);
    store.markUser(campaign.name, from.id);
    log(`📩 DM sent to @${from.username} ("${text}")`);
  } catch (e) {
    log(`❌ DM to @${from.username} failed:`, e.message, e.details ? JSON.stringify(e.details) : '');
  }
  try {
    await ig.replyToComment(commentId, pick(campaign.publicReplies));
    log(`💬 Replied to comment by @${from.username}`);
  } catch (e) {
    log(`❌ Public reply to @${from.username} failed:`, e.message);
  }
}

// ---------- HTTP server
const app = express();
app.use(express.json({ verify: (req, _res, buf) => (req.rawBody = buf) }));

app.get('/', (_req, res) => res.send('Instagram DM automation is running.'));

// Meta calls this once when you register the webhook URL.
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === env.verifyToken) {
    log('Webhook verified by Meta');
    return res.status(200).send(req.query['hub.challenge']);
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
  for (const entry of req.body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === 'comments' || change.field === 'live_comments') {
        await handleComment(change.value).catch((e) => log('handleComment error:', e.message));
      }
    }
  }
});

// ---------- Startup
async function start() {
  if (!env.dryRun) {
    try {
      const me = await ig.me();
      ownUserId = ownUserId || String(me.user_id);
      ownUsername = me.username;
      log(`Logged in as @${me.username} (${ownUserId})`);
    } catch (e) {
      log('⚠️  Could not verify access token:', e.message);
    }
    // Refresh the long-lived token once a day so it never expires.
    const refresh = () => ig.refreshToken().then(() => log('🔑 Access token refreshed')).catch((e) => log(e.message));
    setInterval(refresh, 24 * 60 * 60 * 1000);
  }
  await refreshCampaigns().catch((e) => log('Could not load campaigns:', e.message));
  app.listen(env.port, () => log(`Listening on :${env.port}  (webhook path: /webhook${env.dryRun ? ', DRY RUN' : ''})`));
}
start();
