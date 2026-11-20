# Meta App Review guide (for the account owner)

This guide helps you ask Meta for "advanced access" so the bot works for **everyone** who comments, not only testers. Nothing here guarantees approval; Meta decides, and reviews can ask for changes and take days or weeks. Check the Meta dashboard for its current wording, since screens change.

## Before you start
- The bot is deployed and reachable on HTTPS (see "Deploy to Render" in the README). Below, `https://YOUR-HOST` is your Render address.
- Open `https://YOUR-HOST/privacy` and `https://YOUR-HOST/data-deletion` in a browser. They must load and show your name and email (not "[... not set]").
- Your Instagram account is a Professional (Creator or Business) account, connected to the Meta app, and the webhook is working (a test comment from a tester gets a DM).
- If you use the Render free plan, wake the service just before recording and before Meta tests it (open `/healthz`). A sleeping service may miss the reviewer's test.

## 1. App settings (App settings > Basic)
| Field | What to enter |
|---|---|
| App icon | A 1024 x 1024 px image (your logo) |
| Privacy Policy URL | `https://YOUR-HOST/privacy` |
| User data deletion | Choose "Data deletion instructions URL": `https://YOUR-HOST/data-deletion` |
| Terms of Service URL | `https://YOUR-HOST/terms` |
| Category | e.g. "Business and Pages" or "Messaging" (pick the closest) |
| Contact email | The same email you set as CONTACT_EMAIL |

Also fill in the **Data use checkup / data handling** questions honestly: the bot stores only comment and user IDs (plus username and comment text) on the hosting server, shares nothing, and deletes comment records after about 8 days.

## 2. Permissions to request
> **Caveat:** the permission names below are for **Instagram API with Unified Login** (the default, `API_MODE=unified`). If you run `API_MODE=instagram_login` the names are different: `instagram_business_basic`, `instagram_business_manage_comments` and `instagram_business_manage_messages` (no `business_management`). Use the same explanations for them.

In **App Review > Permissions and Features**, request advanced access for each item below. Paste the matching text into "How will you use this permission?". Edit the text so it is true for your account.

**instagram_basic**
> Our app reads the connected Instagram professional account's basic profile and media list so it can identify the account and find the specific posts/reels that the account owner has chosen to automate. We use the account ID and media IDs only to match incoming comment notifications to the configured posts. We do not display or share this data.

**instagram_manage_comments**
> When a person comments on a post or reel the account owner has configured, our app receives the comment notification (comment ID, text, commenter's ID and username) and posts a short public reply under that comment (for example "Check your DM"). The permission is needed to publish that reply as the account owner. We do not read comments on other posts for any other purpose and do not delete or hide comments.

**instagram_manage_messages**
> After someone comments on a configured post or reel, our app sends that person a single private reply (Direct Message) containing the content they asked for, such as a link or guide, using the comment-based private reply feature, within the 7-day window. Each person receives this message once per post. We do not send bulk or unsolicited messages and do not read the account's inbox conversations.

**business_management** (request it only if Meta lists it as required for your setup, for example because the access token is a business system-user token tied to your business portfolio)
> Our app uses a system-user access token that belongs to the account owner's business portfolio. This permission lets the app access the Instagram account assigned to that business so it can receive webhooks and perform the actions described for the other permissions. We do not read or change other business assets.

Under "Platform settings / webhooks" also confirm the webhook field **comments** is subscribed.

### Exact setup steps (the flow we used)
1. Your business portfolio is connected to the app, and your Instagram professional account is in that portfolio.
2. In the app: **Instagram > API setup with Unified login > Create configuration**. Pick the template, set the token to never expire, choose your Instagram account.
3. Add your test account as a tester: **App roles > Roles > Add people > Instagram Tester**. The tester accepts at `instagram.com/accounts/manage_access/` under **Tester invites**.
4. Click **Generate token** and put it in `IG_ACCESS_TOKEN`.
5. **Configure webhooks**: enter the callback URL (`https://YOUR-HOST/webhook`) and the verify token, then **Verify and save**.
6. Then, as a separate step, switch the **comments** field to **Subscribed**. Verifying alone subscribes nothing.
7. Turn on the account's **Webhook Subscription** toggle (in the account list in API setup). Without it no comment notifications arrive.

## 3. Screencast (screen recording)
Record one continuous video (about 3 to 5 minutes, English or with English captions, clear resolution). Narrate or add text on screen. Suggested script:

1. **Introduce**: say what the app does in one sentence: "When someone comments on my reel, the app sends them a DM and replies publicly."
2. **Show the connection**: open the Meta app dashboard, go to Instagram > API setup, and show that the Instagram account is connected/assigned to the app and the webhook `comments` field is subscribed. Show the Instagram account name.
3. **Show the setup**: briefly show which reel is configured (the campaign) without revealing secrets (hide tokens and the app secret).
4. **Tester comments**: on a second device or account (added as a tester/role in the app), open the configured reel and write a comment.
5. **Public reply**: show the public reply appearing under the comment on the reel.
6. **DM arrives**: switch to the tester's Instagram inbox and show the DM arriving. Open it and show the full message text.
7. **Permissions explanation**: say which step uses which permission (basic: finding the account/reel; manage_comments: the public reply; manage_messages: the DM; business_management: the business access token, if requested).
8. **Privacy and deletion**: open your `/privacy` and `/data-deletion` pages in the browser to show they exist.

Tips: never show tokens or secrets on screen; keep the video short; make sure every permission you request is visibly used.

## 4. Instructions and test access for reviewers
In the review submission "Instructions" box, write something like:
> The app has no separate login. It runs in the background on the connected Instagram professional account @YOUR_ACCOUNT. To test: from an Instagram account that has a role (tester) on this app, comment on this reel: <REEL LINK>. Within seconds a public reply appears under the comment and a Direct Message is sent to the commenter. Keyword filters: none (any comment works). Please allow up to a minute, the server may need to wake up.

Practical notes:
- Add the reviewer-facing test account as a tester under **App roles > Roles** if Meta asks for test credentials, and accept the invitation from that account. Do not share your own real password; Meta accepts test users/roles instead.
- Make sure the reel stays public and the campaign for it is active during the review.
- Reviewers may test days later: keep the service running and consider the keep-alive ping (README).
- Remember the bot sends only one DM per person per reel; a reviewer commenting twice gets one DM. If a reviewer cannot get a DM again, restart the service (on the free plan this clears the record) or use a fresh test account.

## 5. Business verification
For advanced access Meta usually requires **business verification** of the business portfolio that owns the app (Business settings > Security center). It needs legal business details and documents; individuals may be asked to verify too. Start this early, it can take days. If you are not a registered business, check what options the dashboard offers for your country.

## 6. After approval: go Live
1. Wait until every permission shows **Advanced access** (approved).
2. In the app dashboard switch the app mode from **Development** to **Live** (you need the privacy policy URL and data deletion URL filled in).
3. Test with an account that is NOT a tester: comment on the reel and confirm the public reply and DM.
4. Keep the contact email working and keep your privacy policy accurate if the bot changes. Meta may ask you to re-confirm data use yearly.
