# MarkLend Desktop

MarkLend is a desktop Electron lending-management application backed by Supabase.

## 1. Install and run

```bash
npm install
npm start
```

For a Windows installer/build:

```bash
npm run dist
```

The bundled `.env` supplies the configured Supabase URL and public anon key. Keep service-role credentials out of the desktop application.

## 2. Supabase setup

Run `supabase/schema.sql` in the Supabase SQL Editor. It is a single consolidated script (all tables, RPCs, views, RLS and grants through 1.5) that works on a fresh project **and** upgrades an existing MarkLend database; it is safe to re-run.

After running the schema, if PostgREST temporarily reports that an RPC function cannot be found, refresh the schema cache in Supabase or run:

```sql
NOTIFY pgrst, 'reload schema';
```

## 3. MarkLend 1.1 improvements

- Dedicated Lending Capital screen with funding, withdrawals and capital transaction history.
- Currency-specific capital safety checks for MWK/USD/ZAR.
- Pending loans can be created as requests without consuming capital.
- Approval atomically checks available capital, records disbursement and moves the loan to Active.
- Loan review modal with borrower/risk, principal, interest and maturity information.
- Loan rejection workflow requiring a reason and creating an audit record.
- Principal repayments automatically return principal to the matching capital pool.
- Real PAR30, PAR60 and PAR90 calculations from overdue unpaid schedules.
- Staff permission editor with explicit View/Create/Edit/Approve controls per section.
- Staff permission changes are audited.
- Capital withdrawals are prevented from exceeding the live available pool.
- Financial amounts remain stored in integer minor units; the UI formats them as currency.

## 4. Recommended first administrator setup

1. Sign in as the initial Admin.
2. Open **Lending capital** and add the real lending pool using a unique reference.
3. Create staff users from **Settings → Staff access**.
4. Use **Edit** beside a staff user to set exact View/Create/Edit/Approve permissions.
5. Create loans as requests. They remain **Pending Approval**.
6. Review and approve requests only when the matching currency has sufficient available capital.
7. Record repayments through the repayment workflow so principal recycling and the immutable ledger remain synchronized.

## 5. Financial controls

Capital movements use unique references and are written to both the capital transaction table and ledger. Loan disbursement is only created during approval, and withdrawal is rejected if it would make a currency pool negative.


## MarkLend 1.4
- Self-service Individual and Business borrower registration.
- Automatic borrower/profile provisioning from Supabase Auth.
- Persistent session refresh, optional device persistence, sign-out and inactivity lock.
- Administrator MFA/2FA is intentionally deferred to a future release.


## MarkLend 1.4

- Added an administrator-only **Audit Logs** screen.
- Authentication events such as sign-in, sign-out, session lock/unlock and expiry are recorded.
- Lending actions and permission changes continue to write immutable audit records.
- Borrower summary views are security-invoker views and expose `borrower_user_id` for the borrower portal.
- Portfolio metrics are restricted to Admin and Loan Officer roles.
- Administrator MFA/2FA remains intentionally deferred to a future update.

### Supabase schema validation
The bundled `supabase/schema.sql` was reviewed for balanced PostgreSQL dollar-quoted blocks, string literals and parentheses, and the desktop JavaScript was syntax-checked. Run the complete schema in the Supabase SQL Editor on the target project before using production data.


## MarkLend 1.5

- **Profile avatars.** Click the avatar in the top-right (or open *Settings -> My profile*) to pick an avatar. The choices depend on the account type: **Individual**, **Business**, **Loan officer** or **Administrator**. Stored in `profiles.avatar` through the `set_my_avatar()` RPC (own row only, audited as `UPDATE_AVATAR`). `audit_log_view` and `staff_access_view` expose the avatar key. If the 1.5 schema has not been applied yet, the app still signs in and shows initials.
- **Consolidated `supabase/schema.sql`** replaces the old patch-on-patch file. It also hardens defaults: anon access revoked, app roles lose INSERT/UPDATE/DELETE except where RLS policies allow it, `penalty_rules` is RLS-protected, borrowers cannot change their own KYC status or risk level, and approvals/withdrawals take a per-currency lock.
- **Drizzle Kit** (dev tooling, not packaged into the installer):
  1. `npm install`
  2. Copy `.env.drizzle.example` to `.env.drizzle` and set `DATABASE_URL` (Supabase *Connect -> Session pooler*). Never put it in `.env`: that file is bundled into the app.
  3. `npm run db:pull` writes typed `drizzle/schema.ts` and `drizzle/relations.ts`; `npm run db:studio` opens Drizzle Studio.
  
  `schema.sql` stays the source of truth (RLS, functions, triggers). Do not run `drizzle-kit push` or `migrate`, and ignore the baseline `drizzle/0000_*.sql` that `pull` emits.

### 1.5 UI refresh
- **Fix:** the sidebar tabs did not appear after sign-in (the nav was only drawn at startup, before the profile and permissions were known). It now redraws as soon as the session loads.
- **Typography:** Inter (body, tables, tabular figures) + Plus Jakarta Sans (headings and KPI numbers), bundled offline in `assets/fonts` (SIL OFL licences included).
- **Theme layer** (`<style id="theme15">` in `index.html`): neutral grey canvas, flat white cards, refined orange brand, SVG line icons, status badges with dots, sticky table headers, visible keyboard focus, glass top bar, reduced-motion support.


## MarkLend 1.7

**Re-run `supabase/schema.sql`** in the Supabase SQL editor (safe to re-run). It adds per-currency metrics, a monthly series, overdue loans, a repayment preview, an overpayment guard, penalty accrual and borrower-portal functions.

### New
- **Repayments:** live waterfall preview (fees → penalty → interest → principal) before posting; overpayments are blocked in the app *and* in the database; retried payments can never post twice.
- **Multi-currency:** MWK / USD / ZAR switcher on dashboard, reports and capital; trends and the month-over-month chart are computed in the database.
- **Collections:** overdue loans by days late (age buckets), penalties, one-click "Record payment", CSV/PDF export, and "Apply penalty rules" (rule is edited in Settings → Penalty rule).
- **Loan detail:** schedule, repayments, ledger and audit trail in one dialog (click any loan number); printable loan statement.
- **Scale:** every list is paged and searched on the server (25/50/100 per page, date ranges, filters). Exports fetch *all* matching rows. Global search (Ctrl+K) searches the whole database.
- **Borrower portal:** next-instalment-due card and a printable account statement.
- **Invoices:** approved loans have an **Invoice** button (list, loan detail, and right after approving). The PDF embeds the logo (`assets/brand/logo.png`), borrower, loan terms, schedule and total payable. Fill in Settings → Invoice details (business name, address, how to pay). **Email invoice…** saves the PDF, reveals it in its folder and opens your mail app addressed to the borrower (a desktop app cannot attach files automatically, so attach the PDF).
- **Sign-out fixed:** the login screen is now shown again after sign-out (and after "Save & connect"). Sign-up shows a clear "check your email" state with *Resend*, detects already-registered addresses, and Enter submits every start-up form.
- Also fixed: staff other than Admin could not see any screen (permission keys were read incorrectly); the capital/dashboard snapshot cache that stored financial data in plain localStorage is gone.

### Sign-up and Supabase
If **Auth → Providers → Email → Confirm email** is on, new borrowers must open the confirmation link before signing in. The link goes to your Supabase *Site URL*; for a desktop app that page may not load, but the address is still confirmed. Turn confirmation off for in-person onboarding, or set up custom SMTP (the built-in sender is rate limited).

### Code layout
`index.html` is only the shell. Styles: `src/styles.css`. Scripts load in this order: `api, core, data, views, auth, profile, staff, modals, invoice, misc, boot` (classic scripts sharing one scope). See `tests/README.md`.

## 1.7.1 (UI polish, no database changes)

- **Font:** Tilt Warp (OFL, bundled in `assets/fonts`) for headings, the wordmark and dashboard numbers. Tilt has no bold weight, so bold is never synthesised; body text and tables stay Inter so figures line up.
- **Controls:** every button, dropdown, date and text input shares one height (38 px; 28 px for small in-table buttons), radius and border. Defined once in `src/ui.css`.
- **Dark mode:** rebuilt on colour tokens (`:root` / `html[data-theme=dark]` in `src/ui.css`), so no element keeps a hard-coded light colour. All text passes WCAG AA contrast in both themes (checked by `tests/ui-audit.js`). Primary buttons use a slightly deeper orange (`--brand-btn`) because white on the bright brand orange only reached 2.7:1.
- **Dashboard numbers:** smaller, and automatically shrink to fit their card if an amount is very large.
- **Borders and tables:** one border colour and radius throughout; tables no longer scroll inside a clipped box; money columns right-aligned.
- **Sidebar and lock screen:** the splash logo mark (`assets/brand/logo-mark.png`, transparent) replaces the plain "M".
- **Login:** "Keep me signed in on this device" is aligned (custom checkbox), the sign-in button is full width.
- **Fixed:** the 1.7 stylesheet accidentally contained global `body`/`th`/`h1` rules copied from the PDF templates; this caused dark text in dark mode and broke money alignment. Removed.

## Releases and auto-update (1.7.2)

Installed copies of MarkLend check GitHub Releases for a newer version (shortly after start, then every 4 hours, or
**Settings → Application → Check for updates**). The update downloads in the background, a banner offers **Restart now / Later**,
and it also installs when the app is closed.

### One-time setup (on the Windows machine that builds)
1. In `package.json` → `build.publish`, set `owner` and `repo` to your GitHub repository. The repo must be **public** for installed apps to read updates without a token.
2. `git init`, commit, and `git remote add origin https://github.com/<owner>/<repo>.git`.
3. Create a GitHub personal access token with `repo` scope and put it in `.env.release` as `GH_TOKEN=...` (copy `.env.release.example`).
   Never put it in `.env`: `.env` is packed into the installer. The release stops if it finds a token there, and the zip refuses to include one.

### Each release
1. Describe the changes under `## Unreleased` in `CHANGELOG.md` (include a `Database:` line). These become the GitHub release notes.
2. `npm run release:patch` (fixes), `release:minor` (features) or `release:major`. Try `npm run release:dry` first.

The release runs: preflight → bump version → tests → commit + tag `vX.Y.Z` → `release-zips/marklend-desktop-X.Y.Z.zip` → push source and tag → build and publish the installer and `latest.yml` to GitHub Releases.
If the installer step fails after the source is pushed, fix the cause and run `npm run release:publish`.

Notes: the installer is unsigned, so Windows SmartScreen may warn on first install. Database changes are **not** delivered by the updater; run `supabase/schema.sql` in Supabase when the release notes say so.
Tests: `npm test` (app e2e + release pipeline).

## Branches (1.8)

MarkLend can run as a company with branches. Staff belong to one branch and only see that branch's borrowers, loans, instalments,
repayments, ledger entries and audit trail; administrators see all branches. This is enforced in the database (row-level security),
not just hidden in the screens.

- **Admin:** Branches → New branch; Settings → Staff → Add staff (role + branch) or the Branch button to move someone.
  Roles: *Admin*, *Branch Manager*, *Loan Officer*. Section permissions still decide what each person may do.
- **Loan officer workflow:** add a borrower (their branch is set automatically), verify KYC, then create a loan for that borrower.
  A Branch Manager (or Admin) approves it.
- **Public sign-ups** have no branch until a Branch Manager claims them (Borrowers → Assign branch) or an Admin assigns or transfers them.
- A branch with open loans cannot be closed; closed branches accept no new borrowers or loans.
- **Upgrading:** re-run `supabase/schema.sql`. Existing staff, borrowers and loans move into a "Head Office" branch.
- Lending capital stays company-wide.

SQL tests: `psql -d ml -f tests/sql/stubs.sql -f supabase/schema.sql -f tests/sql/branches.sql` (prints PASS/FAIL per check).

### Releasing a delivered update zip
When you receive a zip that already has its `## X.Y.Z` section in `CHANGELOG.md`, unzip over your project, commit, then run
`npm run release:current`: it tags that version, zips, pushes and publishes without bumping the number.

## Loan officer workflow (1.8.1)

1. **Create the borrower** (Borrowers → Add borrower). Their branch is set automatically.
2. **Verify KYC:** record ID type, ID number and address (and next of kin), then set KYC to Verified. Rejecting needs a reason.
   Who verified, when, and every change are recorded in the audit log.
3. **Create the loan:** only Verified borrowers can be lent to.
4. **Approval by someone else:** a Branch Manager or Admin approves. The creator sees "Awaiting another approver".
   Administrators may approve their own loan (so a one-person company still works); this is flagged `self_approved` in the audit log.
5. **Branches → My branch** shows the work queue: borrowers awaiting verification and loans awaiting approval.

SQL tests: `psql -d ml -f tests/sql/workflow.sql` (run after stubs.sql and schema.sql; ends with `RESULT: N passed, 0 failed`).

## Branch performance (1.8.2)

**Performance** (Admin, or a Branch Manager with Reports access) ranks branches in one currency for a chosen period.
Pick the ranking metric (collection rate, PAR30, disbursed, outstanding, active loans, KYC verified); the **Officers** button
opens the people in that branch. Export the ranking or the officer table as CSV or PDF.

- *Collection rate* = paid against instalments that fell due in the period / what fell due. Instalments not yet due are not counted.
- *PAR30* = outstanding principal of loans whose oldest unpaid instalment is 30+ days late / outstanding principal.
- Loans are credited to the person who created them; loans made before 1.8.1 show as "Not recorded".

SQL tests: `psql -d ml -f tests/sql/performance.sql` (hand-computed expectations).

## Dashboard Analysis (1.9.0)

Six donut charts on the dashboard (staff only): portfolio by branch, loans by status, borrowers by KYC status, portfolio by risk, collections by branch and currency mix. Everything comes from one database call, `analysis_breakdown(currency, from, to)`, which respects branch scoping. Click a slice to open the matching list, or use "View as table". The period selector affects the collections chart only.
Colours are CSS tokens (`--dv-1` to `--dv-8`, plus `--dv-good/warn/crit/other`) in `src/ui.css`, checked for colour-blind separation in both themes.
SQL tests: `psql -d ml -f tests/sql/analysis.sql`.

## Branch audit, transfers and reconciliation (1.9.1)

Audit entries carry a `branch_id` set by a database trigger at write time, so the Admin branch filter reflects where a record was when the action happened. `assign_borrower_branch(borrower, branch, reason)` moves a borrower and their loans; between branches the reason is mandatory and stored with the names, loan count and open principal.
`branch_reconciliation(currency)` (Admin only) compares the company ledger with the branch totals: money lent (DISBURSEMENT entries vs approved loans), money collected (REPAYMENT entries vs repayments) and principal owed (disbursed minus the principal part of repayments vs loan outstanding). Loans without a branch are counted as Unassigned so the totals still close.
SQL tests: `psql -d ml -f tests/sql/reconcile.sql` (fresh database each time).

## Voids, manual invoices, branch capital and targets (1.10)

Reversals never delete history: `void_repayment`, `void_loan` and `delete_loan` require a reason, write the audit log, and (for money) post reversing ledger and capital entries in one transaction. New payments record which instalments they settled (`repayment_allocations`) so a void restores them exactly; payments from before 1.10 are reversed from the latest instalments backwards and flagged `approximate_reversal`.
`manual_invoices` holds saved invoices (numbers come from `invoice_counters`, one series per year). `branch_capital` holds a per-branch, per-currency lending limit enforced inside `approve_loan`; `branch_targets` holds monthly targets and `branch_target_progress` computes actuals.
SQL tests: `psql -d ml -f tests/sql/lifecycle.sql` (fresh database).

## Extending a loan (1.11)

`extend_loan(loan, new_end_date, reason, extra_interest_bps, fee_minor, waive_penalties, preview)` reschedules what is still owed. Part-paid instalments are closed at what was paid (their `due` amounts are set to the `paid` amounts), unpaid instalments are deleted and replaced by new ones numbered from the next free number, and the old schedule is saved as JSON in `loan_extensions`. The number of instalments follows the loan's frequency from today to the new end date (the last instalment falls on the end date). Extra interest = remaining principal x bps / 10000, spread evenly with the unpaid interest. Fee and carried penalties sit on the first new instalment. Preview mode (`p_preview = true`) returns the plan and changes nothing; the dialog uses it for its live preview.
SQL tests: `psql -d ml -f tests/sql/extend.sql` (fresh database).


## 1.14.2 — Collateral and extension invoice correction

New loan requests include optional collateral details (type, description, estimated value and reference/registration number). These are stored on the loan and shown in loan details and invoices.

Loan invoices calculate the remaining amount from each schedule component (`due - paid`) and omit fully settled instalments. This is important for extensions: the extension function preserves paid amounts in historical schedule rows, and those amounts must not be invoiced again. An extension that leaves MWK 640,000 principal and adds 40% interest should therefore invoice MWK 640,000 principal + MWK 256,000 interest = MWK 896,000, assuming no other unpaid fees or penalties.

**Database update:** run the complete `supabase/schema.sql` in the Supabase SQL Editor before using this release. It adds nullable collateral columns and replaces the `create_loan` RPC with optional collateral arguments. Existing loans are not rewritten.


## 1.14.3 — Branded statements and borrower financial analytics

Statements now use the same configured company logo and business header as invoices. Borrower account statements show key account totals alongside loan and payment histories. Staff with borrower-view permission can open a borrower financial profile from the directory to review loan exposure, repayments, arrears, collateral, KYC, repayment progress, visual breakdowns and an explainable internal risk indicator with suggested follow-up actions. The indicator is a management aid, not a credit-bureau score or an automatic lending decision.

**Database update:** no schema changes are required for this release.


## 1.14.4 — Borrower monitoring and lending recommendations

Borrower profiles now identify repeat borrowers with completed and fully settled loans, show defaulted/written-off history separately, and surface early warnings for overdue instalments, instalments due in the next 14 days and loans approaching maturity. A chronological borrower timeline combines loan origination/disbursement, loan extensions/restructures and repayment events. Risk-based management recommendations cover arrears follow-up, management review, controlled repeat lending, collateral coverage and first-loan checks. These are decision-support prompts only; MarkLend does not automatically approve or decline a loan. If schedules cannot be read, the profile explicitly warns that early-warning data is unavailable.

**Database update:** no schema changes required. Uses existing `loan_schedules` and `loan_extensions` tables plus loan and repayment summary views. Staff must have loan-view access for schedule and extension information.
