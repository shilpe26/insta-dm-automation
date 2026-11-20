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
const cutoff = Date.now() - COMMENT_TTL_MS;
for (const [id, c] of Object.entries(state.comments)) {
  if (!(Date.parse(c.at) >= cutoff)) delete state.comments[id];
}

function save() {
  writeJsonAtomic(paths.state, state);
}

export const store = {
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
  markUser(mediaId, userId) {
    state.users[`${mediaId}:${userId}`] = new Date().toISOString();
    save();
  },
  unmarkUser(mediaId, userId) {
    delete state.users[`${mediaId}:${userId}`];
    save();
  },
};
