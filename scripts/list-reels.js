// Prints your account info and recent reels/posts with their media IDs.
import { ig } from '../src/instagram.js';

const me = await ig.me();
console.log(`Account: @${me.username}   id=${me.id}   user_id=${me.user_id}\n(set IG_USER_ID to the user_id value)\n`);
for (const m of await ig.listMedia(50)) {
  const caption = (m.caption || '').replace(/\s+/g, ' ').slice(0, 50);
  console.log(`${m.media_product_type.padEnd(6)} ${m.id}  ${m.permalink}  ${caption}`);
}
