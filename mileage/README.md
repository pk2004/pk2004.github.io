# Lease Miles

A small web app that tracks a leased BMW's mileage against the lease allowance. It reads the odometer from the official [BMW CarData API](https://bmw-cardata.bmwgroup.com/customer/public/api-documentation) once a day and shows:

- whether you're ahead of or behind your allowance pace, and by how much
- how many miles a day you can drive and still finish within the allowance
- your projected mileage at lease end and the estimated excess charge
- a chart of miles driven against the allowance pace, plus every odometer reading

You can also add odometer readings by hand, either to fill in history or if BMW syncing isn't available.

## How it works

- `public/`: the site itself. Plain HTML, CSS and JavaScript modules, with no framework and no build step.
- `netlify/functions/api.mjs`: a JSON API under `/api/*`. It runs BMW's device-code sign-in and calls CarData for you, so your client ID and tokens never reach the browser.
- `netlify/functions/daily-sync.mjs`: a scheduled function that reads the odometer every day at 05:17 UTC. It also refreshes BMW's sign-in token, which expires after 14 days unless it's renewed.
- Data is stored in [Netlify Blobs](https://docs.netlify.com/blobs/overview/). BMW refresh tokens are encrypted with `SESSION_SECRET`. The browser holds only an encrypted, HttpOnly session cookie.
- BMW allows 50 CarData API calls a day. Connecting uses about 5 of them. After that, each sync uses 1 call, and manual syncs are limited to one every 5 minutes.

## iPhone widget

The app includes a Home Screen and Lock Screen widget built for the free [Scriptable](https://scriptable.app) app. You don't need Xcode or an Apple Developer account.

1. On your iPhone, open the app and go to **Settings → Home Screen widget → Set up widget**.
2. Tap **Copy Scriptable script**. In Scriptable, tap **+**, paste the script, and give it a name.
3. Long-press the Home Screen or Lock Screen, add a **Scriptable** widget, edit it, and choose the script.

Sizes: small (status and miles under/over pace), medium and large (adds allowance left, daily budget, projected miles at return and days left), and the Lock Screen circular gauge, rectangular and inline styles. If the phone is offline, the widget shows the last summary it loaded.

How it works: the script fetches `GET /api/widget`, which needs a read-only token sent as `Authorization: Bearer …`. The server stores only a hash of the token, so the token can't be shown again later. Creating a new script or tapping **Revoke** stops the old one from working. The script itself is `public/widget/lease-miles.scriptable.js`.

## 1. Get your BMW CarData client ID

1. Sign in at the My BMW web portal and go to **Vehicle overview → BMW CarData**.
2. Under **Technical access to BMW CarData**, click **Create CarData client** and copy the client ID.
3. Click **Request access to CarData API** so the client is subscribed to the API. Do this *before* connecting the app.

Requirements from BMW:
- The car must be in a supported (EU) market and have an active ConnectedDrive contract.
- You must be the car's **primary** user.

## 2. Deploy to Netlify

1. In Netlify, go to **Add new site → Import an existing project** and pick this GitHub repository.
2. Set **Base directory** to `mileage`. Netlify then reads `mileage/netlify.toml`, so the publish directory and functions are set up automatically. The rest of the repository (the personal site) is ignored.
3. Under **Site configuration → Environment variables**, add:

   | Variable | Value |
   |---|---|
   | `BMW_CLIENT_ID` | the CarData client ID from step 1 |
   | `SESSION_SECRET` | a random string of at least 32 characters, e.g. the output of `openssl rand -base64 48` |

4. Deploy. Open the site, enter your lease details, then click **Connect** and approve the code in your BMW account.

Netlify Blobs and scheduled functions are both included on the free plan, and neither needs setting up.

> Changing `SESSION_SECRET` later signs everyone out and invalidates the stored BMW tokens. You'd need to reconnect BMW afterwards.

## Local development

```sh
cd mileage
npm install
npm test             # lease math + reading helpers
npx netlify dev      # serves the site and functions on http://localhost:8888
```

For `netlify dev`, put `BMW_CLIENT_ID` and `SESSION_SECRET` in `mileage/.env`. That file is git-ignored.
