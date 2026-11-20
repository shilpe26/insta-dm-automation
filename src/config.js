import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}

// "unified" = Instagram API with Unified Login (graph.facebook.com, system-user token).
// "instagram_login" = Instagram API with Instagram Login (graph.instagram.com, IGAA... token).
const apiMode = process.env.API_MODE || 'unified';
if (!['unified', 'instagram_login'].includes(apiMode)) {
  throw new Error(`API_MODE must be "unified" or "instagram_login" (got "${apiMode}")`);
}

// The webhook signature secret is the Meta APP SECRET (App settings > Basic).
// INSTAGRAM_APP_SECRET is the old name, still accepted.
const appSecret = process.env.APP_SECRET || process.env.INSTAGRAM_APP_SECRET;
if (!appSecret) throw new Error('Missing required env var APP_SECRET (see .env.example)');

export const env = {
  apiMode,
  appSecret,
  accessToken: required('IG_ACCESS_TOKEN'),
  igUserId: process.env.IG_USER_ID || '',
  verifyToken: required('WEBHOOK_VERIFY_TOKEN'),
  port: Number(process.env.PORT || 3000),
  graphVersion: process.env.GRAPH_VERSION || (apiMode === 'unified' ? 'v27.0' : 'v23.0'),
  dryRun: process.env.DRY_RUN === 'true',
};

export const paths = {
  root,
  campaigns: process.env.CAMPAIGNS_FILE || path.join(root, 'campaigns.json'),
  state: path.join(root, 'data', 'state.json'),
  token: path.join(root, 'data', 'token.json'),
};

export function loadCampaigns() {
  if (!fs.existsSync(paths.campaigns)) {
    throw new Error(`No campaigns file at ${paths.campaigns}. Copy campaigns.example.json to campaigns.json and edit it.`);
  }
  const { campaigns } = JSON.parse(fs.readFileSync(paths.campaigns, 'utf8'));
  if (!Array.isArray(campaigns) || campaigns.length === 0) throw new Error('campaigns.json has no campaigns');
  for (const c of campaigns) {
    if (!c.reel && !c.mediaId) throw new Error(`Campaign "${c.name}" needs "reel" (URL) or "mediaId"`);
    if (!c.dm) throw new Error(`Campaign "${c.name}" needs a "dm" message`);
    c.keywords = (c.keywords || []).map((k) => k.toLowerCase());
    c.publicReplies = c.publicReplies?.length ? c.publicReplies : ['Check your DM 📩'];
    c.oncePerUser = c.oncePerUser !== false;
  }
  return campaigns;
}

/** Extracts the shortcode from https://www.instagram.com/reel/ABC123/ or /p/ABC123/ */
export function shortcodeFromUrl(url) {
  const m = String(url).match(/instagram\.com\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
