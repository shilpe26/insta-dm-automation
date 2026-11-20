// Prints your account info and recent reels/posts with their media IDs. Works in both API modes.
import { env } from '../src/config.js';
import { ig } from '../src/instagram.js';

if (env.apiMode === 'unified') {
  const accounts = await ig.assignedAccounts();
  console.log('Instagram accounts assigned to this token:');
  for (const a of accounts) console.log(`  id=${a.id}  @${a.username}`);
  let id = env.igUserId;
  if (!id) {
    if (accounts.length !== 1) {
      console.log(accounts.length ? '\nSeveral accounts: set IG_USER_ID to one of the ids above, then run again.' : '\nNo accounts assigned to this token.');
      process.exit(1);
    }
    id = String(accounts[0].id);
    console.log(`\n(only one account, using ${id}; you can set IG_USER_ID=${id})`);
  }
  ig.setIgId(id);
  console.log();
} else {
  const me = await ig.me();
  console.log(`Account: @${me.username}   id=${me.id}   user_id=${me.user_id}\n(set IG_USER_ID to the user_id value)\n`);
}
for (const m of await ig.listMedia(50)) {
  const caption = (m.caption || '').replace(/\s+/g, ' ').slice(0, 50);
  console.log(`${String(m.media_product_type || '').padEnd(6)} ${m.id}  ${m.permalink}  ${caption}`);
}
