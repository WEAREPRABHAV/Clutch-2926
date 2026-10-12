# CLUTCH / 26 — School Esports Festival

A single-file, vanilla-JS esports tournament site with Firebase Firestore real-time sync and a client-side admin console.

## 1. Files

- `index.html` — the complete website.
- `firestore.rules` — starter Firestore rules.
- `vercel.json` — optional Vercel configuration.
- `README.md` — this setup guide.

## 2. Firebase setup (recommended)

1. Open Firebase Console: https://console.firebase.google.com/
2. Create a project.
3. Add a **Web App** to the project.
4. Go to **Build → Firestore Database → Create database**.
5. Start in production/test mode as appropriate, then replace the rules with the included `firestore.rules`.
6. Copy your Web App Firebase config.
7. Open `index.html` and replace the values under:
   `CONFIG.FIREBASE`
8. Change:
   `CONFIG.ADMIN_PASSWORD`
   to a password only the event organizers know.

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

- `champions/current`
  - bgmi
  - valorant
  - minecraft
  - chess
- `team/{autoId}`
  - name
  - role
  - photo (optional URL)
  - instagram (optional URL)
  - linkedin (optional URL)
- `settings/global`
  - eventDate
  - socials.instagram
  - socials.discord
  - socials.youtube

The public site uses Firestore `onSnapshot()` listeners, so scoreboard, registrations, champions and organizer updates appear without a page refresh.

## 3. Important security note

The requested admin login is intentionally a **client-side password gate**. That is suitable only for a low-stakes school event.

A client-side password is NOT a real security boundary: someone with browser/devtools access can inspect the deployed JavaScript. If you need real admin security, use Firebase Authentication and Firestore Security Rules based on authenticated admin accounts.

## 4. Firestore rules

The supplied rules allow public registration creation/read and authenticated/admin-style writes. Because this exact site uses the simple client-side gate, you may choose to temporarily allow writes for the event — but understand that this lets technically capable visitors write data.

For a real deployment, the safer path is:

- enable Firebase Authentication;
- create organizer accounts;
- require `request.auth != null` for admin writes;
- optionally maintain an `admins/{uid}` document and check it in rules.

## 5. Vercel deployment — fastest path

### Option A: GitHub

1. Create a GitHub repository, e.g. `clutch-esports`.
2. Upload `index.html`, `firestore.rules`, `vercel.json`, and `README.md`.
3. Go to https://vercel.com/
4. Import the GitHub repository.
5. Framework preset: **Other** (or leave automatic).
6. Build command: **leave empty**.
7. Output directory: **leave empty**.
8. Deploy.

Because this is static HTML, Vercel does not need a build step.

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

### Admin password

```js
ADMIN_PASSWORD: "your-real-event-password"
```

### Event date

The default is:

```text
2026-10-17 09:00 IST
```

The admin console can also update the event date after Firebase is connected.

### Social links

Use the Admin → Event Settings panel. Empty social URLs are intentionally not rendered in the footer.

## 7. Using the admin console

Go to the `#admin` section of the site.

1. Enter the password.
2. Update event date/social links.
3. Add scoreboard rows.
4. Set the four champions.
5. Add organizer/event-team members.
6. Delete registrations when needed.
7. Lock the console after editing.

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
- prize pool + champions
- live tabbed scoreboard
- news cards
- live teams directory
- dedicated organizer "Our Team" section
- client-side admin console
- Firestore real-time listeners
- social links controlled by admin
- responsive mobile navigation/layout
- Vercel-ready static deployment
