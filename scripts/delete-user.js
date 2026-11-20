// Usage: node scripts/delete-user.js <instagram_username> [instagram_user_id]
// Removes every stored record for a person. Restart the server afterwards (it keeps the data in memory).
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonAtomic } from '../src/atomic.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.env.STATE_FILE || path.join(root, 'data', 'state.json');
const username = (process.argv[2] || '').replace(/^@/, '').trim().toLowerCase();
const userId = (process.argv[3] || '').trim();
if (!username) {
  console.error('Usage: node scripts/delete-user.js <instagram_username> [instagram_user_id]');
  process.exit(1);
}

let state;
try {
  state = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`Cannot read ${file}: ${e.code === 'ENOENT' ? 'file does not exist (nothing to delete)' : e.message}`);
  process.exit(1);
}
state.comments ||= {};
state.users ||= {};

let comments = 0;
let users = 0;
for (const [id, c] of Object.entries(state.comments)) {
  if (String(c.user || '').toLowerCase() === username) { delete state.comments[id]; comments++; }
}
for (const [key, v] of Object.entries(state.users)) {
  const byName = typeof v === 'object' && v && String(v.username || '').toLowerCase() === username;
  const byId = userId && key.endsWith(`:${userId}`);
  if (byName || byId) { delete state.users[key]; users++; }
}

if (comments + users > 0) writeJsonAtomic(file, state);
console.log(`State file: ${file}`);
console.log(`Removed ${comments} comment record(s) and ${users} user record(s) for @${username}.`);
if (!userId) {
  console.log('Note: user records written by older versions hold only a numeric id (no username) and cannot be matched by name.');
  console.log('If you know the person\'s Instagram user id, run again with it as the second argument.');
}
if (comments + users > 0) console.log('IMPORTANT: restart the server now, otherwise it keeps the old data in memory and may write it back.');
