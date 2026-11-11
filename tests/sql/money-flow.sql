-- Run on a FRESH database after stubs.sql and supabase/schema.sql. Expect: overpayment error, idempotent repost,
-- penalty accrual 1st run updates rows and 2nd run updates none, borrower cannot read staff data.
\set ON_ERROR_STOP off
insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000a1','admin@x.com'),('00000000-0000-0000-0000-0000000000b1','bor@x.com');
insert into public.profiles(id,full_name,email,role) values ('00000000-0000-0000-0000-0000000000a1','Admin','admin@x.com','Admin') on conflict (id) do update set role='Admin';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.add_capital(100000000,'MWK','Owner','F1') is not null as funded;
select public.create_branch('Main','MAIN') as br \gset
insert into public.borrowers(user_id,full_name,phone,email,branch_id,id_type,id_number,address,kyc_status) values ('00000000-0000-0000-0000-0000000000b1','Test Borrower','0999','t@x.com',:'br'::uuid,'National ID','A1','Addr','Verified') on conflict do nothing;
select public.create_loan((select id from public.borrowers where full_name='Test Borrower' limit 1), 30000000, 'fixed', 1200, 'Monthly','MWK', (current_date+120), (current_date-100)) as loan \gset
select public.approve_loan(:'loan');
select count(*) as installments from public.loan_schedules where loan_id=:'loan';
\echo --- overdue
select loan_number, days_late, overdue_minor, penalty_minor, outstanding_principal from public.overdue_loans('MWK');
\echo --- preview small / exact due-now / over total
select public.repayment_preview(:'loan', 1000000);
select (public.repayment_preview(:'loan', 1)->>'due_now')::bigint as due_now, (public.repayment_preview(:'loan', 1)->>'total_due')::bigint as total_due \gset
select public.repayment_preview(:'loan', :total_due + 500)->>'overpay' as overpay_preview;
\echo --- overpay must fail
select public.post_repayment(:'loan', :total_due + 500, current_date, 'k-over');
\echo --- exact due-now posts
select public.post_repayment(:'loan', :due_now, current_date, 'k-ok') is not null as posted;
select public.post_repayment(:'loan', :due_now, current_date, 'k-ok') is not null as idempotent_again;
select count(*) as repayment_rows, sum(amount_minor) from public.repayments;
\echo --- overdue after paying due-now (expect none)
select count(*) as still_overdue from public.overdue_loans('MWK');
\echo --- penalties: none configured => error; then rule
select public.accrue_penalties();
reset role;
insert into public.penalty_rules(name,grace_days,flat_rate_bps,daily_rate_bps,cap_principal_bps) values('Default',5,500,10,2000);
set role authenticated;
\echo --- metrics / monthly / schedule
select public.portfolio_metrics('MWK');
select public.portfolio_metrics('USD')->>'total_loans' as usd_loans;
select public.portfolio_monthly('MWK',3);
select count(*) as sched_rows from public.loan_schedule(:'loan');
\echo --- borrower view
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b1',false);
set role authenticated;
select loan_number, due_date, amount_due_minor, is_overdue from public.borrower_next_due();
select count(*) as borrower_sched from public.loan_schedule(:'loan');
select public.portfolio_metrics('MWK');
select public.accrue_penalties();

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.create_loan((select id from public.borrowers where full_name='Test Borrower' limit 1), 10000000, 'fixed', 1000, 'Monthly','MWK', (current_date+60), (current_date-75)) as l2 \gset
select public.approve_loan(:'l2') is not null as approved;
\echo --- accrue 1st run
select public.accrue_penalties();
\echo --- accrue 2nd run (idempotent -> 0 updates)
select public.accrue_penalties();
select due_date, principal_due_minor, interest_due_minor, penalty_due_minor from public.loan_schedule(:'l2') order by due_date limit 3;
select days_late, overdue_minor, penalty_minor from public.overdue_loans('MWK') where loan_id=:'l2';
\echo --- waterfall pays penalty before interest
select public.repayment_preview(:'l2', 100000)->'penalty' as pen_part, public.repayment_preview(:'l2', 100000)->'interest' as int_part;
\echo --- audit entry
select action, details from public.audit_logs where action='APPLY_PENALTIES' order by created_at desc limit 1;
