// Sends a fake, correctly signed "comment" webhook to your local server.
// Only use against a server started with DRY_RUN=true.
// Env SIM_FROM_ID overrides the commenter id (e.g. to test the own-account skip).
// Run the server with DRY_RUN=true first, then: npm run simulate -- <mediaId> "comment text" [username] [parentId]
import 'dotenv/config';
import crypto from 'node:crypto';

const [mediaId = '123', text = 'link please 🔥', username = 'test_user', parentId] = process.argv.slice(2);
console.warn('WARNING: use this only against a DRY_RUN=true server, or it may send real DMs.');
const port = process.env.PORT || 3000;
const body = JSON.stringify({
  object: 'instagram',
  entry: [{
    id: process.env.IG_USER_ID || '0',
    time: Math.floor(Date.now() / 1000),
    changes: [{
      field: 'comments',
      value: {
        id: `sim_${Date.now()}`,
        text,
        from: { id: process.env.SIM_FROM_ID || `uid_${username}`, username },
        ...(parentId && { parent_id: parentId }),
        media: { id: mediaId, media_product_type: 'REELS' },
      },
    }],
  }],
});
const secret = process.env.APP_SECRET || process.env.INSTAGRAM_APP_SECRET;
if (!secret) throw new Error('Set APP_SECRET in .env');
const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
const res = await fetch(`http://localhost:${port}/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
  body,
});
console.log('Server responded', res.status, '- check the server logs');
