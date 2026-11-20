import fs from 'node:fs';
import { paths } from './config.js';

// Tiny JSON-file store so we never DM the same comment (or the same person) twice.
let state = { comments: {}, users: {} };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(paths.state, 'utf8')) };
} catch {}

function save() {
  fs.writeFileSync(paths.state, JSON.stringify(state, null, 2));
}

export const store = {
  seenComment: (id) => Boolean(state.comments[id]),
  markComment(id, info) {
    state.comments[id] = { ...info, at: new Date().toISOString() };
    save();
  },
  userAlreadyDmed: (campaign, userId) => Boolean(state.users[`${campaign}:${userId}`]),
  markUser(campaign, userId) {
    state.users[`${campaign}:${userId}`] = new Date().toISOString();
    save();
  },
};
