// Public pages Meta requires for App Review (privacy policy, data deletion, terms) plus status and health check.
import { env } from './config.js';

const UPDATED = '2026-11-20';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const ownerHtml = () => (env.ownerName ? esc(env.ownerName) : '[OWNER_NAME not set]');
const emailHtml = () => (env.contactEmail
  ? `<a href="mailto:${esc(env.contactEmail)}">${esc(env.contactEmail)}</a>`
  : '[CONTACT_EMAIL not set]');

export function warnIfPlaceholders(log) {
  if (!env.ownerName) log('WARNING OWNER_NAME is not set; the public pages show a placeholder. Set it before submitting to Meta.');
  if (!env.contactEmail) log('WARNING CONTACT_EMAIL is not set; the public pages show a placeholder. Set it before submitting to Meta.');
}

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6;max-width:42rem;margin:0 auto;padding:1rem 1.25rem 3rem;color:#1a1a1a;background:#fff}
h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:2rem}
a{color:#0b57d0}nav a{margin-right:1rem}
.muted{color:#555;font-size:.9rem}
</style>
</head>
<body>
<nav aria-label="Pages"><a href="/">Home</a><a href="/privacy">Privacy Policy</a><a href="/data-deletion">Data Deletion</a><a href="/terms">Terms</a></nav>
<main>
<h1>${esc(title)}</h1>
${body}
</main>
</body>
</html>`;
}

const privacy = () => page('Privacy Policy', `
<p class="muted">Last updated: ${UPDATED}</p>
<p>This service is operated by <strong>${ownerHtml()}</strong> ("we", "us"). It is an automation for an Instagram creator account: when someone comments on a specific post or reel we have configured, the service sends that person a Direct Message with the content they asked for and posts a short public reply under their comment.</p>

<h2>What data we process</h2>
<ul>
<li>The commenter's Instagram user ID and username.</li>
<li>The text and ID of the comment.</li>
</ul>
<p>We only process comments left on the posts or reels we have configured. Comments on other posts are ignored and not stored. We do not read your profile or messages, and we do not ask for passwords.</p>

<h2>Why we process it</h2>
<p>Only to send the requested Direct Message once and to post a public reply to the comment. We do not use the data for anything else.</p>

<h2>What we store</h2>
<p>We keep a minimal record (comment IDs and user IDs, with the username and comment text) so that the same person does not receive duplicate messages. Comment records are automatically removed after about 8 days, and the records that tie a person to a post (used to avoid duplicate messages) after about 90 days. The records are kept on our hosting server. It may also be cleared earlier when the server restarts or is redeployed.</p>

<h2>What we do not do</h2>
<p>We do not sell or share your data, we do not use it for advertising, and we do not build profiles of people.</p>

<h2>Third parties</h2>
<ul>
<li><strong>Meta Platforms (Instagram)</strong>: the comment and message data passes through Meta's platform, which has its own privacy policy.</li>
<li><strong>Our hosting provider</strong>: the service runs on a hosting provider's servers, which store the minimal record described above. The service's operational logs also contain the commenter's username and comment text; the hosting provider keeps these logs for its own log retention period, which we do not control.</li>
</ul>

<h2>Retention</h2>
<p>Comment records are deleted after about 8 days. Records tying a person to a post (used to avoid sending the same message twice) are deleted after about 90 days, or earlier on request or when the server data is reset. Operational logs at our hosting provider expire on the provider's own schedule.</p>

<h2>Your rights</h2>
<p>You can ask us what data we hold about you, ask us to correct it, or ask us to delete it. You can also stop the automation from contacting you by not commenting on the configured posts, or by blocking or restricting the account that operates this service.</p>

<h2>How to request deletion</h2>
<p>See our <a href="/data-deletion">data deletion instructions</a>.</p>

<h2>Contact</h2>
<p>Questions about this policy: ${emailHtml()}</p>
`);

const deletion = () => page('Data Deletion Instructions', `
<p class="muted">Last updated: ${UPDATED}</p>
<p>If you commented on a post connected to this service and want your data removed, you can ask us to delete it.</p>

<h2>Option 1: Email us</h2>
<p>Send an email to ${emailHtml()} with your <strong>Instagram username</strong>. We will delete the records we hold about you.</p>

<h2>Option 2: Send us a Direct Message</h2>
<p>Send a Direct Message to the Instagram account that operates this service (run by ${ownerHtml()}) asking for your data to be deleted.</p>

<h2>Timing</h2>
<p>We will delete your data within 30 days of your request. Operational logs held by our hosting provider expire on the provider's own schedule.</p>

<h2>Stop further messages</h2>
<p>You do not need to connect or authorize anything to receive a message, so there is no app to remove from your Instagram settings. To stop further messages, you can block or restrict the Instagram account that operates this service, and you can ask us to delete your data using either option above.</p>
<p>See also our <a href="/privacy">Privacy Policy</a>.</p>
`);

const terms = () => page('Terms of Service', `
<p class="muted">Last updated: ${UPDATED}</p>
<p>These terms apply to the Instagram comment-to-message service operated by <strong>${ownerHtml()}</strong>.</p>

<h2>The service</h2>
<p>When you comment on a post or reel that is set up with this service, you may receive a Direct Message with the content that post promised (for example a link) and a public reply under your comment.</p>

<h2>Use</h2>
<p>By commenting on a configured post you agree to receive that one message. You must follow Instagram's and Meta's own terms and policies. We may stop or change the service at any time.</p>

<h2>No guarantees</h2>
<p>The service is provided "as is". Messages depend on Instagram and may be delayed or fail. To the extent permitted by law we are not liable for losses caused by use of the service or by its unavailability.</p>

<h2>Your data</h2>
<p>How we handle data is described in our <a href="/privacy">Privacy Policy</a>. To have your data deleted, see <a href="/data-deletion">Data Deletion</a>.</p>

<h2>Contact</h2>
<p>${emailHtml()}</p>
`);

const home = () => page('Instagram comment-to-DM automation', `
<p><strong>Status:</strong> running.</p>
<p>Operated by ${ownerHtml()}.</p>
<ul>
<li><a href="/privacy">Privacy Policy</a></li>
<li><a href="/data-deletion">Data Deletion Instructions</a></li>
<li><a href="/terms">Terms of Service</a></li>
</ul>
`);

export function registerPages(app) {
  const html = (fn) => (_req, res) => {
    res.set({ 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'X-Content-Type-Options': 'nosniff' });
    res.type('html').send(fn());
  };
  app.get('/', html(home));
  app.get('/privacy', html(privacy));
  app.get('/data-deletion', html(deletion));
  app.get('/terms', html(terms));
  app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));
}
