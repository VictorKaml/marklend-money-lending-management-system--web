# MarkLend Web (Vercel-ready browser build)

This package is a browser-hosted web edition based on MarkLend Desktop 1.14.5. It keeps the existing Supabase REST/auth client and database configuration workflow, so the web app can connect to the same Supabase project as the desktop app.

## Deploy to Vercel
1. Extract this ZIP and import the project directory into Vercel (or push it to a Git repository and import).
2. Framework preset: **Other**.
3. Build command: leave empty. Output directory: `.` (project root).
4. Deploy. `vercel.json` provides static routing.

## First connection
On first launch, configure the same Supabase project URL and public anon key used by the desktop app. The app stores its configuration in this browser's local storage. Each user/browser needs its own configuration and login.

## Browser differences
- PDFs use the browser print dialog; select **Save as PDF**.
- Email actions open the user's configured mail application through `mailto:`. This does not attach a generated PDF automatically; the user should attach the saved PDF.
- Electron updater actions are not applicable in web mode; Vercel deployments deliver updates.
- This build uses the existing Supabase database. Keep Row Level Security and the existing permission/RPC policies enabled. Never place a Supabase service-role key in browser configuration.

This is a browser compatibility conversion, not a new Next.js rewrite. Validate the complete application flows against your Supabase project and deploy to a staging Vercel URL before production.
