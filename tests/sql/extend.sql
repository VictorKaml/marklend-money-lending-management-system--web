-- Loan extension tests (1.11). Fresh DB after stubs.sql + schema.sql.
\set ON_ERROR_STOP off
\pset tuples_only on
create temp table t_res(ok boolean, name text);
grant all on t_res to public;
create or replace function pg_temp.chk(p_name text, p_ok boolean) returns void language plpgsql as $$
begin insert into t_res values(coalesce(p_ok,false), p_name); raise notice '% %', case when coalesce(p_ok,false) then 'PASS' else 'FAIL' end, p_name; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm like p_like; end $$;
grant execute on function pg_temp.chk(text,boolean), pg_temp.fails(text,text) to public;
create or replace function pg_temp.row(p_code text, p_json jsonb) returns jsonb language sql as $$ select e from jsonb_array_elements(p_json) e where e->>'code' = p_code $$;

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@x.com'),('00000000-0000-0000-0000-0000000000c1','oa@x.com'),
 ('00000000-0000-0000-0000-0000000000c3','ma@x.com'),('00000000-0000-0000-0000-0000000000c4','mb@x.com'),
 ('00000000-0000-0000-0000-0000000000c5','mbeta@x.com');
update public.profiles set role='Admin' where id='00000000-0000-0000-0000-0000000000a1';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.create_branch('Alpha','AAA') as ba \gset
select public.create_branch('Beta','BBB') as bb \gset
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c1','Officer A','oa@x.com','Loan Officer',array['dashboard','borrowers','loans','repayments'], :'ba'::uuid);
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c3','Manager A','ma@x.com','Branch Manager',array['dashboard','borrowers','loans','repayments'], :'ba'::uuid);
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c4','Manager NoApprove','mb@x.com','Branch Manager',array['dashboard','borrowers','loans','repayments'], :'ba'::uuid);
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c5','Manager Beta','mbeta@x.com','Branch Manager',array['dashboard','borrowers','loans','repayments'], :'bb'::uuid);
select public.add_capital(900000000,'MWK','Owner','F1') is not null;
insert into public.penalty_rules(name,grace_days,flat_rate_bps,daily_rate_bps,cap_principal_bps,active) values('Test',0,500,0,null,true);
reset role; update public.staff_permissions set can_approve=false where user_id='00000000-0000-0000-0000-0000000000c4' and section='loans'; set role authenticated;

-- Loan 1: 3,000,000, weekly x3 (due -14, -7, today), 10% flat = 100,000 interest per instalment
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
insert into public.borrowers(full_name,phone,email,id_type,id_number,address,kyc_status) values('Alice','1','a@x.com','National ID','1','Addr','Verified');
select id as alice from public.borrowers where full_name='Alice' \gset
select public.create_loan(:'alice',3000000,'fixed',1000,'Weekly','MWK',current_date,current_date-21) as l1 \gset
select public.create_loan(:'alice',1200000,'fixed',0,'Weekly','MWK',current_date,current_date-21) as l2 \gset
select public.create_loan(:'alice',500000,'fixed',0,'Weekly','MWK',current_date+30,current_date) as l3 \gset
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select public.approve_loan(:'l1') is not null;
select public.approve_loan(:'l2') is not null;
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select public.post_repayment(:'l1',600000,current_date,'k1') is not null;   -- instalment 1: interest 100,000 + principal 500,000 (partly paid)
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select public.accrue_penalties() is not null;
select pg_temp.chk('fixture: penalties 80,000 on loan 1 (25,000 + 55,000)', (select sum(penalty_due_minor)=80000 from public.loan_schedules where loan_id=:'l1'));
select pg_temp.chk('fixture: penalties 40,000 on loan 2 (20,000 x 2)', (select sum(penalty_due_minor)=40000 from public.loan_schedules where loan_id=:'l2'));
select count(*) as cap_tx0 from public.capital_transactions \gset
select count(*) as led0 from public.ledger_entries \gset
select public.available_capital('MWK') as avail0 \gset
select pg_temp.chk('fixture: loan 1 is overdue today', (select count(*)=1 from public.overdue_loans() where loan_id=:'l1'));

-- ===== who may extend, and the rules =====
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select pg_temp.chk('officer refused', pg_temp.fails(format($q$select public.extend_loan(%L, current_date+60,'customer is struggling')$q$,:'l1'),'%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c4',false); set role authenticated;
select pg_temp.chk('branch manager without loan approval refused', pg_temp.fails(format($q$select public.extend_loan(%L, current_date+60,'customer is struggling')$q$,:'l1'),'%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c5',false); set role authenticated;
select pg_temp.chk('manager of another branch cannot see the loan', pg_temp.fails(format($q$select public.extend_loan(%L, current_date+60,'customer is struggling')$q$,:'l1'),'%Loan not found%'));
select pg_temp.chk('other branch cannot read extensions or schedules', (select count(*)=0 from public.loan_extensions) and (select count(*)=0 from public.loan_schedules));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select pg_temp.chk('reason required', pg_temp.fails(format($q$select public.extend_loan(%L, current_date+60,'no')$q$,:'l1'),'%reason%'));
select pg_temp.chk('new end date must be after today', pg_temp.fails(format($q$select public.extend_loan(%L, current_date,'customer is struggling')$q$,:'l1'),'%after today%'));
select pg_temp.chk('new end date must be after the current end date (loan 3 ends in 30 days)', pg_temp.fails(format($q$select public.extend_loan(%L, current_date+10,'customer is struggling')$q$,:'l3'),'%running loan%'));
select pg_temp.chk('a loan that is not running cannot be extended', pg_temp.fails(format($q$select public.extend_loan(%L, current_date+60,'customer is struggling')$q$,:'l3'),'%Only a running loan%'));
select pg_temp.chk('extension interest above 100% refused', pg_temp.fails(format($q$select public.extend_loan(%L, current_date+60,'customer is struggling',10001)$q$,:'l1'),'%between 0%'));
select pg_temp.chk('negative fee refused', pg_temp.fails(format($q$select public.extend_loan(%L, current_date+60,'customer is struggling',0,-1)$q$,:'l1'),'%negative%'));
select pg_temp.chk('extension cannot change the original 10% interest rate', pg_temp.fails(format($q$select public.extend_loan(%L, current_date+60,'customer is struggling',500)$q$,:'l1'),'%retain the original loan interest rate%'));
select pg_temp.chk('manager cannot waive penalties', pg_temp.fails(format($q$select public.extend_loan(%L, current_date+60,'customer is struggling',0,0,true)$q$,:'l1'),'%administrators can waive%'));
select pg_temp.chk('more than 10 years away refused', pg_temp.fails(format($q$select public.extend_loan(%L, current_date+4000,'customer is struggling')$q$,:'l1'),'%10 years%'));

-- ===== preview changes nothing =====
select set_config('t.pv', public.extend_loan(:'l1', current_date+60, 'Customer lost income this month', 1000, 10000, false, true)::text, false);
create or replace function pg_temp.pv(p text) returns bigint language sql as $$ select (current_setting('t.pv')::jsonb->>p)::bigint $$;
select pg_temp.chk('preview: still owed principal 2,500,000, interest 200,000, penalties 80,000', pg_temp.pv('remaining_principal_minor')=2500000 and pg_temp.pv('remaining_interest_minor')=200000 and pg_temp.pv('remaining_penalty_minor')=80000);
select pg_temp.chk('preview: same 10% loan interest on 2,500,000 = 250,000; fee 10,000', pg_temp.pv('extra_interest_minor')=250000 and pg_temp.pv('fee_minor')=10000);
select pg_temp.chk('preview: total to pay 3,040,000 over 9 weekly instalments', pg_temp.pv('total_to_pay_minor')=3040000 and pg_temp.pv('instalments')=9 and jsonb_array_length(current_setting('t.pv')::jsonb->'rows')=9);
select pg_temp.chk('preview: rows add up (principal 2,500,000; interest 325,000; fee 10,000; penalty 80,000)',
  (select sum((e->>'principal_minor')::bigint)=2500000 and sum((e->>'interest_minor')::bigint)=450000 and sum((e->>'fee_minor')::bigint)=10000 and sum((e->>'penalty_minor')::bigint)=80000 from jsonb_array_elements(current_setting('t.pv')::jsonb->'rows') e));
select pg_temp.chk('preview: first instalment in a week, last on the new end date', (current_setting('t.pv')::jsonb->'rows'->0->>'due_date')::date=current_date+7 and (current_setting('t.pv')::jsonb->'rows'->8->>'due_date')::date=current_date+60);
select pg_temp.chk('preview: nothing was changed', (select status::text='Active' and count(*)=3 from public.loans l join public.loan_schedules s on s.loan_id=l.id where l.id=:'l1' group by l.status) and (select count(*)=0 from public.loan_extensions));

-- ===== extend =====
select public.extend_loan(:'l1', current_date+60, 'Customer lost income this month', 1000, 10000) is not null;
select pg_temp.chk('loan becomes Restructured with the new end date', (select status::text='Restructured' and maturity_date=current_date+60 from public.loans where id=:'l1'));
select pg_temp.chk('the part-paid instalment is closed at what was paid; the unpaid ones are replaced (1 + 9 rows)', (select count(*)=10 from public.loan_schedules where loan_id=:'l1') and (select principal_due_minor=500000 and principal_paid_minor=500000 and interest_due_minor=100000 and interest_paid_minor=100000 and penalty_due_minor=0 from public.loan_schedules where loan_id=:'l1' and installment_no=1));
select pg_temp.chk('new instalments reuse the freed numbers 2 to 10', (select min(installment_no)=2 and max(installment_no)=10 and count(*)=9 from public.loan_schedules where loan_id=:'l1' and installment_no>1));
select pg_temp.chk('still owed adds up: principal 2,500,000, interest 450,000, fee 10,000, penalty 80,000',
  (select sum(principal_due_minor-principal_paid_minor)=2500000 and sum(interest_due_minor-interest_paid_minor)=450000 and sum(fee_due_minor-fee_paid_minor)=10000 and sum(penalty_due_minor-penalty_paid_minor)=80000 from public.loan_schedules where loan_id=:'l1'));
select pg_temp.chk('instalment split: 277,777 principal each, remainder on the last (277,784)', (select principal_due_minor=277777 from public.loan_schedules where loan_id=:'l1' and installment_no=2) and (select principal_due_minor=277784 from public.loan_schedules where loan_id=:'l1' and installment_no=10));
select pg_temp.chk('fee and carried penalty sit on the first new instalment', (select fee_due_minor=10000 and penalty_due_minor=80000 from public.loan_schedules where loan_id=:'l1' and installment_no=2) and (select sum(fee_due_minor)=10000 from public.loan_schedules where loan_id=:'l1'));
select pg_temp.chk('principal outstanding unchanged (2,500,000)', (select outstanding_principal=2500000 from public.loan_summary where id=:'l1'));
select pg_temp.chk('no longer overdue', (select count(*)=0 from public.overdue_loans() where loan_id=:'l1'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('no money moved: ledger, capital and available capital unchanged', (select count(*)=:led0 from public.ledger_entries) and (select count(*)=:cap_tx0 from public.capital_transactions) and public.available_capital('MWK')=:avail0);
select pg_temp.chk('extension record keeps the old schedule (3 rows) and the details', (select jsonb_array_length(old_schedule)=3 and old_status='Active' and instalments=9 and remaining_principal_minor=2500000 and extra_interest_bps=1000 and fee_minor=10000 and reason like 'Customer lost%' from public.loan_extensions where loan_id=:'l1'));
select pg_temp.chk('audit row with reason, filed under Alpha', (select details->>'reason' like 'Customer lost%' and (details->>'instalments')::int=9 and branch_id=:'ba'::uuid from public.audit_logs where action='EXTEND_LOAN' and entity_id=:'l1'));
select set_config('t.rp', public.repayment_preview(:'l1',100000)::text, false);
select pg_temp.chk('repayment preview: total due now 2,915,000', (current_setting('t.rp')::jsonb->>'total_due')::bigint=2915000);
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select set_config('t.r', public.branch_reconciliation('MWK')::text, false);
select pg_temp.chk('reconciliation unaffected', (select bool_and((e->>'difference_minor')::bigint=0) from jsonb_array_elements(current_setting('t.r')::jsonb->'rows') e));

-- ===== paying after the extension =====
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select public.post_repayment(:'l1',100000,current_date,'k2') is not null;
select pg_temp.chk('payment waterfall on the new plan: fee 10,000, penalty 80,000, interest 10,000', (select fee_component_minor=10000 and penalty_component_minor=80000 and interest_component_minor=10000 and principal_component_minor=0 from public.repayments where idempotency_key='k2'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('a payment made before the extension can no longer be voided', pg_temp.fails(format($q$select public.void_repayment(%L,'wrong amount entered')$q$,(select id from public.repayments where idempotency_key='k1')),'%extended after this payment%'));
select public.void_repayment((select id from public.repayments where idempotency_key='k2'),'Entered on the wrong loan') is not null;
select pg_temp.chk('a payment made after the extension can still be voided and the plan is restored', (select sum(penalty_due_minor-penalty_paid_minor)=80000 and sum(fee_due_minor-fee_paid_minor)=10000 from public.loan_schedules where loan_id=:'l1'));
select pg_temp.chk('a loan can be extended again (preview as Admin on a Restructured loan)', (public.extend_loan(:'l1', current_date+90, 'Second extension agreed', 0, 0, false, true)->>'instalments')::int=13);

-- ===== waiving penalties (Admin) on a loan with nothing paid =====
select set_config('t.w', public.extend_loan(:'l2', current_date+30, 'Hardship: waive penalties and extend', 0, 0, true)::text, false);
select pg_temp.chk('waive: 40,000 of penalties waived and recorded', (current_setting('t.w')::jsonb->>'waived_penalty_minor')::bigint=40000 and (select waived_penalty_minor=40000 from public.loan_extensions where loan_id=:'l2'));
select pg_temp.chk('waive: all 3 unpaid instalments replaced by 5 of 240,000, no penalty owed', (select count(*)=5 and min(installment_no)=1 and sum(principal_due_minor)=1200000 and sum(penalty_due_minor)=0 and min(principal_due_minor)=240000 from public.loan_schedules where loan_id=:'l2'));
select pg_temp.chk('waive: loan Restructured and total owed is the principal only', (select status::text='Restructured' from public.loans where id=:'l2') and (public.repayment_preview(:'l2',1)->>'total_due')::bigint=1200000);
select pg_temp.chk('penalties recorded as waived are in the audit trail', (select (details->>'waived_penalty_minor')::bigint=40000 from public.audit_logs where action='EXTEND_LOAN' and entity_id=:'l2'));

select 'RESULT: '||count(*) filter(where ok)||' passed, '||count(*) filter(where not ok)||' failed' from t_res;
select ' FAILED: '||name from t_res where not ok;
