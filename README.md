# Instagram Comment → DM Automation

Someone comments **anything** (a word, an emoji, "link") on a reel you choose →
1. the bot replies publicly under their comment: **"Check your DM 📩"**
2. the bot sends them a **DM** with the message you wrote (e.g. your link).

It uses Instagram's official API ("private replies"), so your account is not at risk of a ban for automation.

## How it works

```
Someone comments on your reel
        │
Instagram sends a webhook ──▶ this server (/webhook)
                                 │ is it a reel in campaigns.json? not your own comment? not already DMed?
                                 ├─▶ DM to the commenter   (POST /me/messages  recipient.comment_id)
                                 └─▶ public reply "Check your DM 📩"  (POST /{comment-id}/replies)
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
npm run list-reels                # shows your IG_USER_ID and reel links/IDs
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
- Use a persistent disk for `data/` if you can (it remembers who was DMed and the refreshed token).

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
The server logs what it *would* send.

## Token
Long-lived tokens last 60 days. The server refreshes it every 24 h and saves it to `data/token.json`.
If the server is off for 60+ days, generate a new token in the Meta dashboard.
