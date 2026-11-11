# MarkLend Web 1.0.0

This is a browser-hosted Next.js deployment of the MarkLend 1.14.5 application.
The existing lending UI and Supabase REST/auth workflows are retained and served
as a browser SPA from `public/app.html`. The Next.js root route redirects to it.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy to Vercel

1. Push this repository to GitHub.
2. Import it into Vercel.
3. Framework preset: **Next.js**.
4. Build command: `npm run build` (default).
5. Deploy. The root route redirects to `/app.html`.

## Supabase

The browser uses the existing Supabase project URL and public anon key from the
source release. These values are public client credentials, not secrets. All
tables and RPCs must be protected by correctly configured Supabase Row Level
Security (RLS) and role checks. Never add a service-role key or database password
to this repository or any `NEXT_PUBLIC_*` variable.

The first-time configuration screen can also save the Supabase URL and anon key
in this browser's local storage. Browser storage is per browser/device.

## Browser-specific behaviour

- Electron main/preload processes, Electron updater, installer scripts and desktop
  packaging dependencies are removed.
- Sessions/configuration are stored in browser localStorage/sessionStorage.
- PDF exports open the browser print dialog. Select **Save as PDF** to create a PDF.
- Email actions open the user's default mail application using `mailto:`. The user
  must attach the PDF they saved; browsers cannot silently attach local files.
- Updates arrive through a new Vercel deployment; refresh the browser to load them.
- Pop-ups must be allowed for this site for print-based PDF exports.

## Important validation notes

This conversion removes the Electron runtime and hosts the existing HTML/JavaScript
application through Next.js. It is not a full React component-by-component rewrite.
Before production use, run the app against the intended Supabase project and verify
all workflows, RLS policies, email delivery and PDF printing in your target browsers.
