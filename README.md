# Instagram Comment → DM Automation

Someone comments **anything** (a word, an emoji, "link") on a reel you choose →
1. the bot sends them a **DM** with the message you wrote (e.g. your link).
2. only if the DM went out, the bot replies publicly under their comment: **"Check your DM 📩"**

Only top-level comments trigger this. Replies inside a comment thread, and your own comments, are ignored.

It uses Instagram's official API ("private replies"), so your account is not at risk of a ban for automation.

## How it works

```
Someone comments on your reel
        │
Instagram sends a webhook ──▶ this server (/webhook)
                                 │ is it a reel in campaigns.json? top-level comment? not your own? not already DMed?
                                 ├─▶ DM to the commenter   (POST /me/messages  recipient.comment_id)
                                 │   (temporary DM failures are retried 3 more times: after 30 s, 2 min, 10 min)
                                 └─▶ if the DM succeeded: public reply "Check your DM 📩"  (POST /{comment-id}/replies)
```

## Instagram rules you should know
- Your account must be a **Professional account** (Creator or Business).
- One DM per comment, and only within **7 days** of the comment.
- To work for **everyone** (not just you/testers), the Meta app needs **App Review** approval for
  `instagram_business_manage_comments` and `instagram_business_manage_messages`. Until then it only works
  for comments from accounts added as testers in the app.

## Setup

### 1. Create the Meta app
1. Go to <https://developers.facebook.com/apps> → **Create app** → use case **"Manage messaging & content on Instagram"**.
2. In the app: **Instagram → API setup with Instagram login**.
3. **Generate access token**: add your Instagram account, log in, approve. Copy the token (starts with `IGAA…`) → `IG_ACCESS_TOKEN`.
4. Copy the **Instagram app secret** → `INSTAGRAM_APP_SECRET`.
5. In the Instagram app: **Settings → Privacy → Messages → Connected tools → turn on "Allow access to messages"**.

### 2. Configure
```bash
npm install
cp .env.example .env              # fill in the values
cp campaigns.example.json campaigns.json
npm run list-reels                # shows your account ids (use user_id as IG_USER_ID) and reel links/IDs
```

Edit `campaigns.json` — one entry per reel:

| field | meaning |
|---|---|
| `reel` | the reel link, e.g. `https://www.instagram.com/reel/ABC123/` (or use `mediaId`) |
| `keywords` | `[]` = react to **any** comment. `["link","guide"]` = only comments containing these words |
| `publicReplies` | public replies; one is picked at random each time so they don't look copy-pasted |
| `dm` | the DM text. `{username}` is replaced with the commenter's username |
| `oncePerUser` | `true` (default) = DM each person only once per reel, even if they comment 5 times |

Changes to `campaigns.json` are picked up automatically, no restart needed.

### 3. Deploy (needs a public HTTPS URL)
Any Node host works — e.g. **Render**, **Railway** or a VPS.
- Start command: `npm start`
- Set the variables from `.env` in the host's dashboard.
- Upload `campaigns.json` (or set `CAMPAIGNS_FILE` to its path).
- Use a persistent disk for `data/` if you can (it remembers who was DMed and the refreshed token; the server assumes a single running instance). If `data/state.json` is corrupted the server refuses to start rather than risk re-DMing people.

For local testing you can use a tunnel: `npx localtunnel --port 3000` or `ngrok http 3000`.

### 4. Connect the webhook
In the Meta app → **Instagram → API setup with Instagram login → Configure webhooks**:
- Callback URL: `https://YOUR-DOMAIN/webhook`
- Verify token: the same value as `WEBHOOK_VERIFY_TOKEN`
- Subscribe to the **`comments`** field.

Comment on your reel from a tester account — you should get the reply + DM within seconds.

## Testing without Instagram
```bash
DRY_RUN=true npm start
npm run simulate -- <mediaId-from-campaigns.json> "🔥" some_user
```
The server logs what it *would* send (lines start with `[dry-run]`). Optional extras: a 4th argument is a
`parentId` (simulates a thread reply, which is ignored), and `SIM_FROM_ID=<id>` overrides the commenter id.
Only run `simulate` against a `DRY_RUN=true` server. Note that simulate still writes to `data/state.json`.
The person is marked as DMed *before* the DM is sent, so a crash mid-send won't double-DM but may skip that person.
If a DM fails with a temporary error (Instagram outage, rate limit, network), the server retries in-process after 30 s, 2 min and 10 min;
only if all retries fail is the comment forgotten. (Set `RETRY_DELAYS_MS=200,200,200` to use other delays, e.g. in tests.)

## Token
Long-lived tokens last 60 days. The server refreshes it about a minute after start and then every 24 h,
and saves it to `data/token.json` (private file). The saved token remembers which `IG_ACCESS_TOKEN` it came from:
if you put a different token in `.env`, the new one is used instead of the saved one.
If the server is off for 60+ days, generate a new token in the Meta dashboard.
