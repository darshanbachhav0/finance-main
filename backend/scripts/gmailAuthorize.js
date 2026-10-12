import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";

// One-time setup for NOTIFICATION_EMAIL_MODE=GMAIL_API: lets the sender Gmail account allow this
// app to send email (scope gmail.send only - it cannot read the mailbox) and prints the refresh
// token to store as GMAIL_REFRESH_TOKEN. Run it on your own computer (not on the server):
//   npm run email:gmail-auth -- --client-id=<id> --client-secret=<secret>
// (or with GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET in backend/.env). The OAuth client must be of type
// "Desktop app". Keep the printed token secret: it can send email as that account.
const argument = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const clientId = argument("client-id") || process.env.GMAIL_CLIENT_ID;
const clientSecret = argument("client-secret") || process.env.GMAIL_CLIENT_SECRET;
const SCOPE = "https://www.googleapis.com/auth/gmail.send";

if (!clientId || !clientSecret) {
  console.error("Pass the OAuth client of type \"Desktop app\": npm run email:gmail-auth -- --client-id=<id> --client-secret=<secret>");
  process.exit(1);
}

const state = crypto.randomBytes(16).toString("hex");
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/oauth2callback") { res.writeHead(404).end(); return; }
  const finish = (status, message) => { res.writeHead(status, { "content-type": "text/plain; charset=utf-8" }).end(message); server.close(); };
  if (url.searchParams.get("state") !== state) return finish(400, "State mismatch. Run the command again.");
  if (url.searchParams.get("error")) { console.error(`Google returned: ${url.searchParams.get("error")}`); process.exitCode = 1; return finish(400, "Permission was not granted. You can close this tab."); }
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code"), client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" })
    });
    const body = await response.json();
    if (!response.ok || !body.refresh_token) throw new Error(`${body.error || response.status} ${body.error_description || "No refresh token returned - remove the app's access at https://myaccount.google.com/permissions and try again."}`);
    console.log("\nDone. Add these in Render -> Environment (and keep them secret):\n");
    console.log("NOTIFICATION_EMAIL_MODE=GMAIL_API");
    console.log(`GMAIL_CLIENT_ID=${clientId}`);
    console.log("GMAIL_CLIENT_SECRET=<the client secret you used>");
    console.log(`GMAIL_REFRESH_TOKEN=${body.refresh_token}`);
    console.log("NOTIFICATION_EMAIL_FROM=UMA Finanzas <the Gmail address you just signed in with>\n");
    finish(200, "Gmail access granted. Return to the terminal for the GMAIL_REFRESH_TOKEN value. You can close this tab.");
  } catch (error) {
    console.error(`Could not get the refresh token: ${error.message}`);
    process.exitCode = 1;
    finish(500, "Could not get the refresh token. See the terminal.");
  }
});

let redirectUri;
server.listen(0, "127.0.0.1", () => {
  redirectUri = `http://127.0.0.1:${server.address().port}/oauth2callback`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state })}`;
  console.log("Open this link, sign in with the Gmail account that will send the notifications, and allow \"Send email on your behalf\":\n");
  console.log(`${authUrl}\n`);
  console.log("Waiting for Google to redirect back here...");
});
