# Tests

**Front end (no Electron needed):** loads `index.html` and every `src/*.js` module in jsdom against a fake Supabase
(REST filters, ranges, RPCs) and drives each screen, sign-in/out, sign-up, repayments, collections, invoices, permissions.

    npm i --no-save jsdom
    node tests/e2e.js

**Database (needs PostgreSQL):** the money-critical functions (waterfall preview, overpayment guard, penalties, per-currency metrics).

    createdb ml && psql -d ml -f tests/sql/stubs.sql && psql -d ml -f supabase/schema.sql
    psql -d ml -f tests/sql/money-flow.sql

`stubs.sql` fakes Supabase's `auth` schema and roles; do not run it on a real Supabase project.

**Branch isolation (PostgreSQL):** after the two commands above, `psql -d ml -f tests/sql/branches.sql` prints PASS/FAIL per check and ends with `RESULT: N passed, 0 failed`.

**Workflow rules (PostgreSQL):** `psql -d ml -f tests/sql/workflow.sql` checks KYC rules and maker-checker.

**Performance maths (PostgreSQL):** `psql -d ml -f tests/sql/performance.sql`.

**Analysis charts (PostgreSQL):** `psql -d ml -f tests/sql/analysis.sql`.

**Loan extension (PostgreSQL):** `psql -d ml -f tests/sql/extend.sql`.

**Voids, invoices, capital, targets (PostgreSQL):** `psql -d ml -f tests/sql/lifecycle.sql`.

**Reconciliation, audit branch, transfers (PostgreSQL):** `psql -d ml -f tests/sql/reconcile.sql`. Each SQL file expects a fresh database (`dropdb ml; createdb ml`, then stubs.sql and schema.sql).

**UI audit (real Chromium):** loads every screen in light and dark, fails on any text below WCAG AA contrast (4.5:1), any
button/input that is not the standard height, and any dashboard number that overflows its card.

    npm i --no-save @sparticuz/chromium puppeteer-core
    node tests/ui-audit.js        # prints "TOTAL low-contrast text items: 0 | screens with non-uniform controls: 0"
