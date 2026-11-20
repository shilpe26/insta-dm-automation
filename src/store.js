import fs from 'node:fs';
import { paths } from './config.js';
import { writeJsonAtomic } from './atomic.js';

// Tiny JSON-file store so we never DM the same comment (or the same person) twice.
// Deliberately simple: assumes a single running instance with a persistent disk.
const COMMENT_TTL_MS = 8 * 24 * 60 * 60 * 1000; // private replies only work for 7 days

let state = { comments: {}, users: {} };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(paths.state, 'utf8')) };
} catch (e) {
  // Missing file = first run. A corrupt file must NOT silently reset us (we'd re-DM people).
  if (e.code !== 'ENOENT') throw new Error(`Cannot read ${paths.state}: ${e.message}. Fix or delete it, then restart.`);
}
// Dedupe records only matter while the reel is active; drop user records after 90 days.
const USER_TTL_MS = 90 * 24 * 60 * 60 * 1000;
// User records are {at, username}; older versions stored just the ISO timestamp string.
const userAt = (v) => (typeof v === 'string' ? v : v?.at);

function prune() {
  let changed = false;
  const now = Date.now();
  for (const [id, c] of Object.entries(state.comments)) {
    if (!(Date.parse(c.at) >= now - COMMENT_TTL_MS)) { delete state.comments[id]; changed = true; }
  }
  for (const [key, v] of Object.entries(state.users)) {
    if (!(Date.parse(userAt(v)) >= now - USER_TTL_MS)) { delete state.users[key]; changed = true; }
  }
  return changed;
}

function save() {
  writeJsonAtomic(paths.state, state);
}

if (prune()) save();
// PRUNE_INTERVAL_MS exists so tests can shorten the hourly check.
setInterval(() => { if (prune()) save(); }, Number(process.env.PRUNE_INTERVAL_MS) || 60 * 60 * 1000).unref();

// Users whose DM is currently being sent/retried (in memory only; not needed across restarts).
const pendingUsers = new Set();

export const store = {
  userPending: (mediaId, userId) => pendingUsers.has(`${mediaId}:${userId}`),
  finishUser: (mediaId, userId) => pendingUsers.delete(`${mediaId}:${userId}`),
  seenComment: (id) => Boolean(state.comments[id]),
  markComment(id, info) {
    state.comments[id] = { ...info, at: new Date().toISOString() };
    save();
  },
  unmarkComment(id) {
    delete state.comments[id];
    save();
  },
  userAlreadyDmed: (mediaId, userId) => Boolean(state.users[`${mediaId}:${userId}`]),
  markUser(mediaId, userId, username = '') {
    state.users[`${mediaId}:${userId}`] = { at: new Date().toISOString(), username: username || '' };
    pendingUsers.add(`${mediaId}:${userId}`);
    save();
  },
  unmarkUser(mediaId, userId) {
    delete state.users[`${mediaId}:${userId}`];
    pendingUsers.delete(`${mediaId}:${userId}`);
    save();
  },
};
