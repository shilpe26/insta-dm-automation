// Sends a fake, correctly signed "comment" webhook to your local server.
// Run the server with DRY_RUN=true first, then: npm run simulate -- <mediaId> "comment text" [username]
import 'dotenv/config';
import crypto from 'node:crypto';

const [mediaId = '123', text = 'link please 🔥', username = 'test_user'] = process.argv.slice(2);
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
        from: { id: `uid_${username}`, username },
        media: { id: mediaId, media_product_type: 'REELS' },
      },
    }],
  }],
});
const sig = 'sha256=' + crypto.createHmac('sha256', process.env.INSTAGRAM_APP_SECRET).update(body).digest('hex');
const res = await fetch(`http://localhost:${port}/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig },
  body,
});
console.log('Server responded', res.status, '- check the server logs');
