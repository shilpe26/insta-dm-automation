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
                                 ├─▶ DM to the commenter   (POST /{IG_ID}/messages  recipient.comment_id)
                                 │   (temporary DM failures are retried 3 more times: after 30 s, 2 min, 10 min)
                                 └─▶ if the DM succeeded: public reply "Check your DM 📩"  (POST /{comment-id}/replies)
```

## Instagram rules you should know
- Your account must be a **Professional account** (Creator or Business).
- One DM per comment, and only within **7 days** of the comment.
- To work for **everyone** (not just you/testers), the Meta app needs **App Review** approval for
  `instagram_manage_comments` and `instagram_manage_messages` (plus `instagram_basic`, `business_management`). Until then it only works
  for comments from accounts added as testers in the app.

## Setup

New Meta apps use **"Instagram API with Unified Login"** (this is the default, `API_MODE=unified`).

### 1. Create the Meta app and token
1. Create a **business portfolio** (business.facebook.com) and connect your Instagram professional account to it.
2. Go to <https://developers.facebook.com/apps> → **Create app** → use case **"Manage messaging & content on Instagram"**, linked to that business portfolio.
3. In the app: **Instagram → API setup with Unified login → Create new configuration**:
   - Token expiry: **Never**
   - Instagram account: pick yours
   - Permissions: `instagram_basic`, `instagram_manage_comments`, `instagram_manage_messages` and `business_management`
4. **Generate token** and copy it → `IG_ACCESS_TOKEN`. This is a system-user token: it is not refreshed by the server.
5. **App settings → Basic**: copy the **App secret** → `APP_SECRET` (the old name `INSTAGRAM_APP_SECRET` still works).
6. **Subscribe the account to the app's webhooks.** After generating the token, open **Configure webhooks** (step 4 below) and make sure
   your Instagram account is subscribed and the **`comments`** field is on. If the dashboard shows a per-account subscribe toggle, turn it on;
   without it Meta sends no comment notifications for that account.
7. In the Instagram app: **Settings → Privacy → Messages → Connected tools → turn on "Allow access to messages"**.

`IG_USER_ID` can stay empty if exactly one Instagram account is assigned to the token: the server finds it at startup and logs its id.
If several accounts are assigned, `npm run list-reels` prints them; set `IG_USER_ID` to the one you want.

> **Old setup (Instagram Login):** set `API_MODE=instagram_login`, use **Instagram → API setup with Instagram login**, an `IGAA…` token
> and the *Instagram app secret* (as `APP_SECRET`). API calls then go to graph.instagram.com (`/me/...`) and the token is refreshed automatically
> (saved in `data/token.json`; it lasts 60 days if the server is off).

### 2. Configure
```bash
npm install
cp .env.example .env              # fill in the values
cp campaigns.example.json campaigns.json
npm run list-reels                # shows your Instagram account id(s) and reel links/IDs
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
- Use a persistent disk for `data/` if you can (it remembers who was DMed; the server assumes a single running instance). If `data/state.json` is corrupted the server refuses to start rather than risk re-DMing people.

For local testing you can use a tunnel: `npx localtunnel --port 3000` or `ngrok http 3000`.

### 4. Connect the webhook
In the Meta app → **Instagram → API setup with Unified login → Configure webhooks**:
- Callback URL: `https://YOUR-DOMAIN/webhook`
- Verify token: the same value as `WEBHOOK_VERIFY_TOKEN`
- Subscribe to the **`comments`** field.

Webhook signatures are checked with the Meta **App secret** (`APP_SECRET`).

Comment on your reel from a tester account — you should get the reply + DM within seconds.

## Testing without Instagram
```bash
DRY_RUN=true npm start
npm run simulate -- <mediaId-from-campaigns.json> "🔥" some_user
```
The server logs what it *would* send (lines start with `[dry-run]`). Optional extras: a 4th argument is a
`parentId` (simulates a thread reply, which is ignored), and `SIM_FROM_ID=<id>` overrides the commenter id. If `IG_USER_ID` is not set, the fake webhook uses the placeholder account id `SIM_IG`.
Only run `simulate` against a `DRY_RUN=true` server. Note that simulate still writes to `data/state.json`.
The person is marked as DMed *before* the DM is sent, so a crash mid-send won't double-DM but may skip that person.
If a DM fails with a temporary error (Instagram outage, rate limit, network), the server retries in-process after 30 s, 2 min and 10 min;
only if all retries fail is the comment forgotten. (Set `RETRY_DELAYS_MS=200,200,200` to use other delays, e.g. in tests.)

## Token
Unified login: the token is a system-user token with the expiry you chose (**Never**). It cannot be refreshed; the server only logs that once at startup.
If it ever expires or is revoked, generate a new one in the Meta dashboard and replace `IG_ACCESS_TOKEN`.

Instagram-login mode only: long-lived tokens last 60 days. The server refreshes it about a minute after start and then every 24 h,
and saves it to `data/token.json` (private file). The saved token remembers which `IG_ACCESS_TOKEN` it came from:
if you put a different token in `.env`, the new one is used instead of the saved one.
