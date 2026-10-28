# CLUTCH / 26 — School Esports Festival

A single-file, vanilla-JS esports tournament site with Firebase real-time sync and an authenticated admin console.

## 1. Files

- `index.html` — the complete website.
- `admin.html` — the admin entry page.
- `api/team-photo.js` — authenticated Vercel Function for organizer photo uploads.
- `package.json` — server-only function dependencies.
- `firestore.rules` — starter Firestore rules.
- `storage.rules` — legacy Firebase Storage rules; the website does not use Firebase Storage.
- `vercel.json` — optional Vercel configuration.
- `README.md` — this setup guide.

## 2. Firebase setup (recommended)

1. In the existing Firebase project, enable **Authentication → Sign-in method → Email/Password** and create the authorized administrator account.
2. Confirm its UID matches the UID in `CONFIG.ADMIN_UID` and `firestore.rules`.
3. Enable Cloud Firestore and deploy `firestore.rules`.
4. Verify the Firebase web configuration in `index.html` matches the project. The web config is public by design; Firestore rules enforce access.
5. For organizer photos, use the secure Vercel Blob setup in section 5. Firebase Storage is not used or required.

### Firestore structure used by this site

- `registrations/{autoId}`
  - teamName
  - game (`bgmi`, `valorant`, `minecraft`, `chess`)
  - classSection
  - captain
  - contact
  - members
  - createdAt
- `scores/bgmi`
- `scores/valorant`
- `scores/minecraft`
- `scores/chess`

Each score document contains a `rows` array of `{team, points}` objects.

- `team/{autoId}`
  - name
  - role
  - photo (optional public Vercel Blob URL)
  - photoPath (optional Blob pathname)
  - instagram (optional URL)
  - linkedin (optional URL)
- `settings/global`
  - eventDate (ISO 8601 string written from the browser's local event date/time)
  - socials.instagram
  - socials.discord
  - socials.youtube
- `news/{autoId}`
  - title, body, date (YYYY-MM-DD), tag (optional), createdAt (Firestore timestamp)

The public site uses Firestore `onSnapshot()` listeners, so scoreboard, registrations, news and organizer updates appear without a page refresh.

## 3. Admin authentication and access control

Admin sign-in uses Firebase Email/Password Authentication. The browser requests credentials each time the admin page opens and keeps the Firebase session in memory only. The console opens after Firebase confirms the exact configured UID. Never put an administrator password in this repository or web client configuration.

## 4. Firestore rules

`firestore.rules` keeps registrations private to the authorized admin while allowing public registration through an atomic write to the safe `publicTeams` directory. Protected public data is readable publicly and writable only by the exact admin UID. Team photos are stored in Vercel Blob by the server function and referenced from `team/{memberId}`. The function verifies the Firebase ID token and exact admin UID before using the Firebase Admin SDK to update Firestore; Admin SDK writes bypass Firestore rules, so the server-side UID check and private credentials are required parts of this boundary. The existing `storage.rules` file is not used by this website's photo flow and does not need to be deployed for it.

Deploy `firestore.rules` from the Firebase Console Rules tab or with the Firebase CLI. The server function uses the existing `team/{memberId}` collection and schema; no Firestore rule changes are required.

## 5. Vercel deployment and team photos

Vercel serves the static website and builds `api/team-photo.js` as a Node.js 22.x Function (selected in `package.json`). The function uses the official `@vercel/blob` SDK and Firebase Admin SDK. It accepts JPEG, PNG, and WebP files up to 4 MiB, checks both the declared media type and file signature, and limits the complete multipart request to 4,400,000 bytes to stay below Vercel's 4.5 MB function request body limit. Blob images are public so the public team section can render them.

### Required server environment variables

Configure these in the Vercel project settings for **Production** and **Preview**. Add **Development** values too if using `vercel dev` locally:

- `BLOB_READ_WRITE_TOKEN` — a read/write token for the public `clutch-team-photos` Blob store. Keep it server-side; it is never sent to the browser.
- `FIREBASE_PROJECT_ID` — `clutch-esports-2026`.
- `FIREBASE_CLIENT_EMAIL` — the `client_email` from a Firebase service account in this project.
- `FIREBASE_PRIVATE_KEY` — the `private_key` from that service account JSON. Store it as a Vercel secret environment variable. If entering it with escaped newlines, use `\n`; the function converts these to PEM line breaks.

The function does not use `BLOB_STORE_ID` or `BLOB_WEBHOOK_PUBLIC_KEY`; the read/write token must belong to the intended Blob store. The store must allow public access for image delivery.

### Create and configure the Firebase Admin service account

1. In Google Cloud Console for `clutch-esports-2026`, create a dedicated service account for this function. Grant the minimum Firestore data role your IAM policy allows (typically Cloud Datastore User, `roles/datastore.user`). Firestore IAM data roles are granted at project scope and can access other Firestore documents too; the function code itself only accesses `team/{memberId}`, so protect the service-account key as a high-privilege secret.
2. Create a private key for that service account and use its `project_id`, `client_email`, and `private_key` values for the three `FIREBASE_*` variables above. Do not commit or upload the JSON key file to this repository. Never put these values in `index.html` or other browser code.
3. In Vercel → Project Settings → Environment Variables, add the three `FIREBASE_*` variables and `BLOB_READ_WRITE_TOKEN` to Production and Preview. Vercel stores them server-side. Redeploy after changing Vercel environment variables so the function receives them.
4. For local testing, put the same variables in an ignored `.env.local` file or use `vercel env pull .env.local`, then run `npm install` and `vercel dev`. Do not share or commit `.env.local`.

If these server variables are absent or invalid, photo requests fail closed with a setup error. Ordinary site loading, Firebase sign-in, registration, news, scores, settings, and organizer-detail editing continue to use their existing paths.

### Existing Vercel deployment options

### Option A: GitHub

1. Create a GitHub repository, e.g. `clutch-esports`.
2. Upload `index.html`, `admin.html`, `api/`, `package.json`, `firestore.rules`, `storage.rules`, `vercel.json`, and `README.md`.
3. Go to https://vercel.com/
4. Import the GitHub repository.
5. Framework preset: **Other** (or leave automatic).
6. Build command: **leave empty**.
7. Output directory: **leave empty**.
8. Deploy. Vercel detects the `api/` Node.js Function automatically; no framework or build command is needed for the static files.

The website remains static HTML/CSS/vanilla JavaScript; only the photo API runs as a serverless function.

### Option B: Vercel CLI

Install once:

```bash
npm i -g vercel
```

Then inside the project folder:

```bash
vercel
```

Follow the prompts and choose the current folder.

For production:

```bash
vercel --prod
```

## 6. Before you give it to your brother

Change these first:

### Firebase config

In `index.html`:

```js
FIREBASE: {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
}
```

### Admin account

Create the admin account in Firebase Authentication. Keep its UID consistent with the UID in both rules files and `CONFIG.ADMIN_UID`. No password is stored in this project.

### Event date

The default is:

```text
October 17, 2026 at 09:00 IST
```

The admin console can also update the event date after Firebase is connected.

### Social links

Use the Admin → Event Settings panel. Empty social URLs are intentionally not rendered in the footer.

## 7. Using the admin console

Open `/admin` on the deployed site (for example, `https://your-site.vercel.app/admin`).

1. Sign in with the authorized Firebase email and password.
2. Update event date/social links.
3. Add scoreboard rows.
4. Add organizer/event-team members.
5. Delete registrations when needed.
6. Upload, replace, or remove organizer photos in the Our Team editor. Photos are optional; organizer details can still be edited without changing a photo.
7. Lock the console when finished. Re-entering `/admin` requests credentials again.

### Organizer photo uploads

Organizer records remain in the existing Firestore `team/{memberId}` collection. `photo` stores the HTTPS delivery URL and `photoPath` stores the managed asset identifier. Existing Vercel Blob URLs continue to display. Legacy Blob identifiers are recognized separately and are never sent to Cloudinary for deletion.

The browser asks the Next.js server for a short-lived signed upload using the Firebase admin ID token, uploads the image directly to Cloudinary, then asks the server to verify the returned asset and save it to the selected organizer record. The API secret stays on the server. No unsigned upload preset is used.

In the Cloudinary Console, open **Settings → API Keys** and use the account's cloud name, API key, and API secret. No unsigned upload preset is required. The app places assets under `clutch/team-photos` and signs the exact member-specific public ID and allowed formats.

Copy `.env.example` to `.env.local` and configure these server-side variables locally and in the existing Vercel project's Environment Variables for each environment you use:

- `FIREBASE_PROJECT_ID` (must be `clutch-esports-2026`)
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`

`BLOB_READ_WRITE_TOKEN` is optional and is used only to clean up managed legacy Blob photos after their Firestore reference has changed. Keep all of these credentials out of client code and source control.

Run the local app with `npm run dev`, then open `http://localhost:3000/admin`. The local Next.js API routes handle signed uploads; the old root-level Vercel function remains for backward compatibility.

Scoreboard rows are sorted by points automatically.

## 8. Optional Google Sheets fallback

`CONFIG.SHEET_API_URL` exists as a fallback hook. If Firebase is not configured and you provide an Apps Script endpoint, registration submissions are sent with:

```json
{
  "action": "register",
  "teamName": "...",
  "game": "valorant",
  "classSection": "...",
  "captain": "...",
  "contact": "...",
  "members": "..."
}
```

The website currently keeps Firebase as the primary production data layer. For the tournament happening today, Firebase is the cleaner path because the public scoreboard/team directory can subscribe directly to Firestore snapshots.

## 9. What is already implemented

- cinematic black/yellow hero
- animated bullet streak
- smoke/ember atmosphere
- glitch/chromatic CLUTCH wordmark
- countdown
- fixed navigation
- diagonal-cut buttons/cards
- global yellow lightning click effect
- reduced-motion support
- four arenas including Valorant
- expandable rules
- live ticker from scoreboard data
- event timeline
- Firestore-backed registration form
- live tabbed scoreboard
- news cards
- live teams directory
- dedicated organizer "Our Team" section
- Firebase Authentication protected admin console
- Firestore real-time listeners
- social links controlled by admin
- responsive mobile navigation/layout
- Vercel-ready static deployment
