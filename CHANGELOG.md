# Changelog

## 1.14.5 — Statement and invoice release fixes

- Loan and borrower statement PDF actions now await PDF generation and use consistent, user-facing statement titles.
- Invoice schedule includes only unpaid principal, interest and fees; fully settled instalments are excluded so prior repayments are not billed again.
- Invoice regression tests now validate the unpaid balance and remaining instalments rather than the original gross schedule.
- Invoice email identifies the outstanding principal and uses the borrower profile name when available.
- No database schema changes required.

## 1.14.4 — Borrower monitoring and lending recommendations

- Repeat-borrower indicator distinguishes borrowers with completed, fully settled loans from borrowers with no completed loan history; defaulted and written-off loans are shown separately.
- Early warning panel flags unpaid instalments that are overdue, due within 14 days, and loans maturing within 14 days, with links to the relevant loan.
- Borrower timeline combines loan creation/disbursement, extension/restructure events and repayments in reverse chronological order.
- Risk-based management recommendations highlight arrears, management review, controlled repeat lending, collateral coverage and first-loan checks. Recommendations are advisory and do not auto-approve or decline credit.
- If schedule data cannot be loaded, the profile explicitly reports that alerts are unavailable rather than claiming that no warnings exist.
- Database: no schema changes required; uses existing `loan_schedules`, `loan_extensions`, `loan_summary` and `repayment_summary` data.


## 1.14.3 — Branded statements and borrower financial analytics

- Loan and borrower account statements now use the configured MarkLend company logo and business details, matching the invoice document header and orange brand rule.
- Account statements include a statement date, borrower identity, total principal disbursed, outstanding principal, repayments received and loan/payment histories.
- Borrower directory names and Profile actions open a financial profile with total borrowing, current exposure, repayments, overdue exposure, collateral value, KYC status and repayment progress.
- Added visual donut charts for outstanding balances by loan status and repayment allocation across principal, interest, fees and penalties.
- Added an explainable 0–100 internal risk indicator with reasons and management recommendations. It is a management aid, not a credit-bureau score or automatic lending decision.
- Database: no schema changes required; uses existing borrower, loan, repayment and overdue views.


## 1.14.2 — Collateral at loan creation and corrected extension invoices

- New loan requests can optionally record collateral type, description, estimated value and reference/registration number.
- Collateral is stored with the loan and displayed in loan details and the loan invoice.
- Loan invoices now show only unpaid principal, interest and fees. Historical paid schedule amounts retained during an extension are excluded, preventing repayments from being billed again.
- Extension invoices show the remaining principal and extension-period interest rather than the original disbursed principal and settled instalments.
- Database: re-run `supabase/schema.sql` to add the collateral fields and update the `create_loan` RPC signature. Existing loan records remain unchanged.

## Unreleased

- Loan extensions support an optional extension-period interest rate, local validation, accurate preview display, and explicit confirmation.
- Database: re-run `supabase/schema.sql` to apply the extension-rate rule.


## 1.14.1 — Interest-period extensions and payment receipts

- Loan extensions retain the original loan interest rate and charge a new full-period interest amount against the remaining principal.
- Early payment of the current period interest does not reduce principal or discount the agreed period interest.
- Extension previews identify the retained rate and new-period interest.
- Successful repayments now produce a PDF receipt linked to the original loan/invoice reference.
- Receipts show the transaction allocation, cumulative payments, remaining principal, interest, fees, penalties, total outstanding, and paid-in-full/partially-paid status.
- Loan repayment history includes a receipt download action.


Describe upcoming work under "Unreleased". `npm run release` turns it into the next version's
section and uses it as the GitHub release notes. Keep a "Database:" line in every release.

## 1.14.0 — 2026-10-29
- **Updating new env configuration.** Added new supabase configuration for connection.

## 1.13.0 — 2026-10-26

- **Extend a loan.** When a customer is past due, or has only part-paid and cannot clear the full amount, an Admin or a Branch Manager with loan approval rights can extend the loan: "Extend loan…" on the loan, or "Extend" in the Collections list. Choose the new end date (quick +30 / +60 / +90 days), optionally add extra interest for the extra time (a percentage of the principal still owed) and an extension fee, and give a reason. The dialog shows the full new plan and the total to pay before anything is saved.
- **What changes.** Everything still unpaid (principal, interest, fees, penalties) is spread over new instalments that end on the new date, at the loan's usual frequency. Instalments that were part-paid are closed at what was paid; instalments with nothing paid are replaced; fully paid ones are untouched. The loan shows as Restructured and is no longer overdue. Principal owed does not change, and no money moves, so the ledger, capital and branch reconciliation are unaffected. A loan can be extended more than once.
- **Penalties.** Unpaid penalties are carried onto the first new instalment. An Admin can instead waive them in the same step; the waived amount is recorded.
- **History.** Each extension is kept (old and new end date, extra interest, fee, waived penalties, reason and the complete old schedule) and shown on an Extensions tab on the loan, and in the audit log. Because the schedule changes, a payment made before an extension can no longer be voided; later payments still can.
- Tests: 42 new SQL checks with hand-computed figures (`tests/sql/extend.sql`) and 29 new app tests.
- Database: **re-run `supabase/schema.sql`.** Adds the extensions table and the `extend_loan` function, and a guard on voiding payments. No existing data is changed.

## 1.10.0 — 2026-10-21

- **Void a payment.** On a loan's Repayments tab the latest payment has a Void button (Admin, or a Branch Manager with approval rights on Repayments). A reason is required. The instalments it settled become unpaid again, the ledger gets a reversing entry, the principal part leaves lending capital, and a completed loan becomes active again. Only the latest payment of a loan can be voided, so older ones are voided newest first. Voided payments are kept and listed on the loan with their reason. Payments made before this version are reversed approximately and flagged as such in the audit log.
- **Void or delete a loan.** A loan that was paid out by mistake and has no payments can be voided by an Admin: the disbursement is reversed, the capital is freed and the loan stays on record as Voided. A loan that never paid out (pending or rejected) can be deleted by an Admin or a Branch Manager with approval rights; the audit log keeps its details. Both need a reason.
- **Manual invoices** (new Invoices screen). Invoice anything outside a loan: customer, optional link to a borrower, dated line items and notes. Choose to save it (it gets a number like MI-2026-0001, appears in the list, can be reissued as PDF and voided; voided copies are stamped VOID) or to produce just a PDF marked "Not recorded" that is never stored.
- **Capital by branch** (Branches screen). The company pool stays one pool; an Admin can set a lending limit per branch and currency. A loan that would take a branch over its limit cannot be approved, and the message says how much room is left. Limits cannot be below what the branch has lent out or add up to more than the pool. Branch Managers see their own branch's limit read-only.
- **Branch targets** (Performance screen). Monthly targets per branch and currency for money disbursed, money collected and new borrowers, with progress bars and an "on pace / behind pace" marker against the share of the month that has passed. Admin sets them; Branch Managers with Reports access see them.
- **Release package.** The source zip is now re-opened after it is built and checked file by file against the files on disk (and its version), so a stale or incomplete package can no longer be attached. The release also stops early if `index.html` loads a script that is missing or would not ship in the installer.
- Tests: 85 SQL checks for all of the above (`tests/sql/lifecycle.sql`, including a deliberate pre-1.10 payment), 45 new app tests and 7 new release tests.
- Database: **re-run `supabase/schema.sql`.** Adds tables for voided payments, payment-to-instalment records, manual invoices, branch capital and targets, a Voided loan status, and the void/delete/allocation/target functions. No existing money data is changed.

## 1.9.1 — 2026-10-20

- **Branch on documents.** Invoices and loan statements now show the branch that made the loan (loan screens and exports already had it).
- **Audit log by branch.** Every audit entry now records the branch the record belonged to when it happened (set by the database, not the app). Admin gets a Branch column and filter on Audit logs, including "Unassigned". Entries from before this version are filled in from today's ownership as a best effort.
- **Branch transfer.** Admin can transfer a borrower between branches; their loans move with them. The dialog says how many loans (and how much outstanding) move and asks for a reason, which is kept in the audit log with the branch names, loan count and open principal. Moving a borrower to the branch they are already in is refused. Branch Managers can still only claim unassigned borrowers.
- **Reconciliation banner** (Admin, on Branches and Performance). Checks, per currency, that money lent, money collected and principal still owed add up between the company ledger and the sum of all branches plus "Unassigned". Green when they agree; amber with a table showing the difference when they do not.
- Tests: 21 new SQL checks (`tests/sql/reconcile.sql`, including a deliberate stray ledger entry that must show as a difference), 3 new transfer checks in `branches.sql`, and 15 new app tests.
- Database: **re-run `supabase/schema.sql`.** Adds a `branch_id` column to the audit log (existing rows are filled in), branch name to `loan_summary` and `audit_log_view`, a read-only reconciliation function, and replaces `assign_borrower_branch` with a version that takes a reason. No loan or money data is changed.

## 1.9.0 — 2026-10-19

- **Dashboard Analysis.** Six donut charts under the dashboard figures (inline SVG, no library; light and dark): portfolio by branch, loans by status, borrowers by KYC status, portfolio by risk level, collections by branch, and currency mix. Each has a legend with value and share, and a "View as table" fallback. Colours never rely on colour alone, KYC and risk use the status colours (green, amber, red), and more than six slices fold into "Other".
- **Click a slice to see the records.** Branch and status slices open Loans, KYC and risk slices open Borrowers, collections open Repayments for that branch, currency switches the dashboard. Repayments gained a Branch filter for Admin.
- Money charts follow the currency switch (never mixed). Only the collections chart uses the period selector; the others are current snapshots. Loan status and currency mix count loans, so they are not converted.
- Scoped by branch automatically: Branch Managers and Loan Officers see only their own branch. Computed in the database (`analysis_breakdown`).
- Tests: 19 new SQL checks (`tests/sql/analysis.sql`) and 18 new app tests (fold to Other, single and empty slices, click-to-filter, currency, period, old database).
- Database: **re-run `supabase/schema.sql`.** Adds one read-only function and a `branch_id` column to the `repayment_summary` view; no data is changed.

## 1.8.2 — 2026-10-19

- **Branch performance** (new Performance screen for Admin, and for Branch Managers who have Reports access, who see only their own branch). Branches are ranked by collection rate, portfolio at risk (PAR30), disbursed, outstanding principal, active loans or KYC verified, with a comparison bar chart. Per branch: borrowers and KYC-verified %, staff, active loans and loans per officer, disbursed and average loan size, outstanding, collected, penalties outstanding. Colour badges: collection rate green from 90%, amber from 75%; PAR30 green up to 5%, amber up to 10%.
- **Definitions.** Collection rate = amount paid against instalments that fell due in the period / amount that fell due (instalments not yet due are excluded). PAR30 = outstanding principal on loans whose oldest unpaid instalment is 30+ days late / outstanding principal.
- **Officer drill-down.** The Officers button shows each person in a branch: loans created, requested and disbursed, open loans, outstanding, PAR30 and KYC verifications. Loans made before 1.8.1 have no recorded creator and appear as "Not recorded".
- One currency at a time (never mixed), with period presets (all time, this month, last 30 days, this year, custom). CSV and PDF export of the ranking and of the officer table.
- All figures are computed in the database (`branch_metrics`, `officer_metrics`), scoped by branch.
- Fixed: the performance screen no longer gets stuck if you change currency or period while it is still loading.
- Tests: 26 new SQL checks with hand-computed expectations (`tests/sql/performance.sql`) and 21 new app tests.
- Database: **re-run `supabase/schema.sql`.** Adds two read-only functions; no data is changed.

## 1.8.1 — 2026-10-19

- **KYC workflow.** Borrowers now record ID type, ID number, address and next of kin. A borrower can only be set to Verified once ID type, ID number and address are recorded, and Rejected needs a reason. The verifier and time are stamped on the borrower, and every KYC change is written to the audit log (from, to, reason, branch).
- **Lending needs verified KYC.** A loan cannot be created for a borrower who is Pending or Rejected, and the loan form only lists Verified borrowers. Borrowers that were already Verified before this update stay Verified.
- **Maker-checker.** The person who created a loan cannot approve it (shown as "Awaiting another approver"). Creators can still reject (withdraw) their own request. Administrators are the one exception so a one-person company can still operate; their self-approvals are flagged `self_approved` in the audit log. Loans created before this update have no recorded creator and are not restricted.
- **Branch work queue.** Branches / My branch now shows borrowers awaiting KYC verification (with a Review KYC button) and loans awaiting approval, for your branch (all branches for Admin).
- Approve and reject audit entries now include the branch.
- Tests: 19 new SQL checks (`tests/sql/workflow.sql`) and 17 new app tests.
- Database: **re-run `supabase/schema.sql`.** Adds borrower KYC columns, `loans.created_by`, and the KYC and approval rules. No data is changed.

## 1.8.0 — 2026-10-16

- **Branches.** Administrators can create, edit, close and reopen branches (name, code, address, phone, manager). Staff belong to one branch and see only that branch's borrowers, loans, instalments, repayments, ledger entries and audit trail; administrators see everything.
- **New role: Branch Manager.** Can approve loans and claim unassigned borrowers for their own branch. Staff are created with a role and a branch; the Staff table has a Branch button to move people or change their role.
- **Borrowers and loans carry their branch.** The branch is set by the server (a loan officer cannot choose or spoof it) and a loan always follows its borrower's branch. Administrators choose the branch when adding a borrower, and can transfer a borrower (their loans move with them). New Branch column everywhere, plus an Admin branch filter and an "Unassigned" filter.
- **Public sign-ups are unassigned** until a Branch Manager or Admin claims them; no loan can be created for an unassigned borrower.
- Dashboard figures, overdue lists, penalties and repayment tools now respect the branch scope. Company-wide lending capital is unchanged and still shared.
- Release tooling: `npm run release:current` releases the version already in package.json (use it for a delivered update zip whose CHANGELOG section already exists).
- Tests: 41 SQL isolation checks (`tests/sql/branches.sql`) and 29 new app tests.
- Database: **re-run `supabase/schema.sql` before using this version.** The first run creates a "Head Office" branch and moves every existing staff member (except admins), borrower and loan into it, so nothing changes for current users. Re-running later never re-assigns borrowers.

## 1.7.2 — 2026-10-16

- Release pipeline: `npm run release:patch | release:minor | release:major` bumps the version, rolls this changelog, runs the tests, commits and tags, writes `release-zips/marklend-desktop-X.Y.Z.zip`, pushes the source to GitHub, then builds and publishes the Windows installer and `latest.yml` that the in-app updater reads.
- Auto-update: `package.json` now carries the GitHub publish target, so installed apps can find new versions. Before this, the updater had no feed.
- Update banner with download progress and a "Restart now" button; Settings → Application shows the installed version and a "Check for updates" button.
- Security: the GitHub token now lives in `.env.release`, which is never packaged. The release refuses to run if a token is found in `.env`, which is bundled into the installer.
- Database: no changes.

## 1.7.1 — 2026-10-14

- UI polish: Tilt Warp headings, uniform controls, token-based dark mode, WCAG AA contrast.
- Database: no changes.

## 1.7.0

- Waterfall preview and overpayment guard, per-currency dashboard, collections view, loan detail, server-side paging and search, borrower portal, invoices with embedded logo, sign-up fixes.
- Database: re-run `supabase/schema.sql`.
