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
6. **Subscribe the account to the app's webhooks.** After generating the token, open **Configure webhooks** (see the "Connect the webhook" section below) and make sure
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

### Deploy to Render (free)
1. Put this project in a GitHub repository (`.env`, `campaigns.json` and `data/` are git-ignored; never commit them).
2. In Render choose **New > Blueprint**, pick the repository; Render reads `render.yaml` (free web service, health check `/healthz`).
3. Fill in the environment variables Render asks for: `APP_SECRET`, `IG_ACCESS_TOKEN`, `IG_USER_ID`, `WEBHOOK_VERIFY_TOKEN`, `OWNER_NAME`, `CONTACT_EMAIL`, and `CAMPAIGNS_JSON`
   (the whole content of your `campaigns.json`, on one line or pasted as is). Render sets `PORT` itself.
4. After the deploy, open `https://YOUR-SERVICE.onrender.com/` : you should see the status page with links to the privacy policy, data deletion and terms pages.
5. In Meta, set the webhook callback URL to `https://YOUR-SERVICE.onrender.com/webhook` with your verify token (see step 4 below).
6. Ready for Meta App Review? Follow [docs/APP_REVIEW.md](docs/APP_REVIEW.md).

Limits of the free plan:
- **No persistent disk**: `data/state.json` (the "already DMed" record) is wiped on every restart or redeploy, so a person could get a second DM if they comment again afterwards.
- The service **sleeps after about 15 minutes without traffic**; the first webhook after a sleep can be slow or delayed while it wakes up. Optional: a free cron service (for example cron-job.org) can request `https://YOUR-SERVICE.onrender.com/healthz` every 10 minutes to keep it awake. Free instance hours are limited, so check Render's current free-plan terms.
- With `API_MODE=instagram_login` the token expires after 60 days on the free plan (the refreshed copy is wiped on restart). Unified login (the default, a never-expiring token) is recommended.
- Changing `CAMPAIGNS_JSON` needs a restart (Render restarts automatically when you save env vars). `CAMPAIGNS_JSON`, if set, is used instead of `campaigns.json`.

The public pages `/privacy`, `/data-deletion` and `/terms` use `OWNER_NAME` and `CONTACT_EMAIL`; the server logs a warning if they are missing.

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
if all retries fail, the comment is forgotten and the person can be DMed again if they comment again.
The exception is a timeout (or an unreadable reply from Instagram): the DM may have gone out anyway, so the person stays marked as DMed
(no double DM), and the log shows a line starting with `ACTION NEEDED` so you can check Instagram and DM them manually if needed.
Failures where the connection could not even be opened (e.g. no internet, DNS failure) are not treated this way; a dropped connection or timeout is. (Set `RETRY_DELAYS_MS=200,200,200` to use other delays, e.g. in tests.)
The public "Check your DM" reply is retried the same way (same delays, in the background) when it fails with a temporary error; permanent errors are not retried.
A public reply counts as "inconclusive" (it may have been posted anyway) after a timeout or unreadable answer, a server error (5xx), or a temporary Instagram error; rate-limit answers (429 and similar) are not inconclusive.
After an inconclusive attempt the server first looks for its own reply under the comment and does not post a second one; the same check runs once more before giving up. If it cannot check (or there are too many replies to check), it stops and logs `ACTION NEEDED: could not confirm public reply ...`.
Notes: retries are kept in memory, so they are lost if the server restarts or is redeployed. The check needs the account's username to be loaded. If your own account already has a reply under a comment (even one you wrote by hand), the bot treats it as its own and skips its public reply.

## Handling a data-deletion request
When someone asks (by email or DM, see `/data-deletion`) to have their data deleted, do this within 30 days:
1. Run `node scripts/delete-user.js <instagram_username>` (on Render, in the service's Shell; locally, in this folder). It removes that person's comment records and their "already DMed" records, and prints what it removed. Records written by older versions hold only a numeric id; if you know the person's id, add it as a second argument.
2. **Restart the server.** It keeps the data in memory and would write the old data back otherwise.
3. The service's logs also contain usernames and comment text. They expire on the hosting provider's own schedule and cannot be edited by you; the privacy policy says so.
4. Reply to the person to confirm.

Automatic cleanup: comment records are removed after about 8 days and "already DMed" records after about 90 days (checked on start and every hour).

## Token
Unified login: the token is a system-user token with the expiry you chose (**Never**). It cannot be refreshed; the server only logs that once at startup.
If it ever expires or is revoked, generate a new one in the Meta dashboard and replace `IG_ACCESS_TOKEN`.

Instagram-login mode only: long-lived tokens last 60 days. The server refreshes it about a minute after start and then every 24 h,
and saves it to `data/token.json` (private file). The saved token remembers which `IG_ACCESS_TOKEN` it came from:
if you put a different token in `.env`, the new one is used instead of the saved one.
