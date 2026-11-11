-- Reconciliation, audit branch and transfer tests (1.9.1) on the same hand-computed fixture as performance.sql. Fresh DB after stubs.sql + schema.sql.
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
 ('00000000-0000-0000-0000-0000000000c2','ob@x.com'),('00000000-0000-0000-0000-0000000000c3','ma@x.com'),
 ('00000000-0000-0000-0000-0000000000c4','mnoreports@x.com');
update public.profiles set role='Admin' where id='00000000-0000-0000-0000-0000000000a1';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.create_branch('Alpha','AAA') as ba \gset
select public.create_branch('Beta','BBB') as bb \gset
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c1','Officer A','oa@x.com','Loan Officer',array['dashboard','borrowers','loans','repayments'], :'ba'::uuid);
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c2','Officer B','ob@x.com','Loan Officer',array['dashboard','borrowers','loans','repayments'], :'bb'::uuid);
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c3','Manager A','ma@x.com','Branch Manager',array['dashboard','borrowers','loans','repayments','reports'], :'ba'::uuid);
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c4','Manager NR','mnr@x.com','Branch Manager',array['dashboard','borrowers','loans'], :'ba'::uuid);
select public.add_capital(900000000,'MWK','Owner','F1') is not null;

-- Branch A: officer A creates a verified borrower and a 3-instalment loan (1,000,000 each, all past due)
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
insert into public.borrowers(full_name,phone,email,id_type,id_number,address,kyc_status) values('Alice','1','a@x.com','National ID','1','Addr','Verified');
insert into public.borrowers(full_name,phone,email) values('Pending Pat','2','p@x.com');
select id as alice from public.borrowers where full_name='Alice' \gset
select public.create_loan(:'alice',3000000,'fixed',0,'Monthly','MWK',current_date-10,current_date-100) as l1 \gset
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select public.approve_loan(:'l1') is not null;
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select public.post_repayment(:'l1',1000000,current_date,'k1') is not null;

-- Branch B: lump-sum loan fully repaid, plus a current (not yet due) loan
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',false); set role authenticated;
insert into public.borrowers(full_name,phone,email,id_type,id_number,address,kyc_status) values('Bob','3','b@x.com','National ID','2','Addr','Verified');
select id as bob from public.borrowers where full_name='Bob' \gset
select public.create_loan(:'bob',2000000,'fixed',0,'Lumpsum','MWK',current_date-5,current_date-60) as l2 \gset
select public.create_loan(:'bob',1000000,'fixed',0,'Lumpsum','MWK',current_date+30,current_date) as l3 \gset
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select public.approve_loan(:'l2') is not null;
select public.approve_loan(:'l3') is not null;
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',false); set role authenticated;
select public.post_repayment(:'l2',2000000,current_date,'k2') is not null;


reset role; delete from public.borrowers where user_id='00000000-0000-0000-0000-0000000000a1'; set role authenticated;
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;

-- reconciliation: everything agrees
select set_config('t.r', public.branch_reconciliation('MWK')::text, false);
create or replace function pg_temp.rr(p_key text, p_f text) returns bigint language sql as $$ select (e->>p_f)::bigint from jsonb_array_elements(current_setting('t.r')::jsonb->'rows') e where e->>'key'=p_key $$;
select pg_temp.chk('recon: money lent ledger 6,000,000 = branches', pg_temp.rr('disbursed','ledger_minor')=6000000 and pg_temp.rr('disbursed','branches_minor')=6000000 and pg_temp.rr('disbursed','difference_minor')=0);
select pg_temp.chk('recon: money collected ledger 3,000,000 = branches', pg_temp.rr('collected','ledger_minor')=3000000 and pg_temp.rr('collected','difference_minor')=0);
select pg_temp.chk('recon: principal owed 3,000,000 both sides', pg_temp.rr('outstanding','ledger_minor')=3000000 and pg_temp.rr('outstanding','branches_minor')=3000000 and pg_temp.rr('outstanding','difference_minor')=0);
select pg_temp.chk('recon: nothing unassigned yet', pg_temp.rr('disbursed','unassigned_minor')=0 and (current_setting('t.r')::jsonb->>'unassigned_loans')::int=0);
select pg_temp.chk('recon: USD has no activity and still balances', (select bool_and((e->>'difference_minor')::bigint=0 and (e->>'ledger_minor')::bigint=0) from jsonb_array_elements(public.branch_reconciliation('USD')->'rows') e));

-- an unassigned loan is counted separately but still balances
reset role; select set_config('app.branch_rpc','1',false); update public.loans set branch_id=null where id=:'l3'; select set_config('app.branch_rpc','',false); set role authenticated;
select set_config('t.r', public.branch_reconciliation('MWK')::text, false);
select pg_temp.chk('recon: unassigned loan shown separately (1,000,000) and totals still agree', pg_temp.rr('disbursed','unassigned_minor')=1000000 and pg_temp.rr('disbursed','branches_minor')=5000000 and pg_temp.rr('disbursed','difference_minor')=0 and pg_temp.rr('outstanding','unassigned_minor')=1000000 and (current_setting('t.r')::jsonb->>'unassigned_loans')::int=1);

-- a ledger entry with no loan behind it is exposed as a difference
reset role; insert into public.ledger_entries(entry_type,reference,debit_account,credit_account,amount_minor,currency,idempotency_key) values('DISBURSEMENT','MANUAL','LOAN_RECEIVABLE','CASH',500000,'MWK','x-manual'); set role authenticated;
select set_config('t.r', public.branch_reconciliation('MWK')::text, false);
select pg_temp.chk('recon: stray ledger entry shows a 500,000 difference on lent and owed, none on collected', pg_temp.rr('disbursed','difference_minor')=500000 and pg_temp.rr('outstanding','difference_minor')=500000 and pg_temp.rr('collected','difference_minor')=0);

-- access
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select pg_temp.chk('recon: branch manager refused', pg_temp.fails($q$select public.branch_reconciliation('MWK')$q$,'%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select pg_temp.chk('recon: officer refused', pg_temp.fails($q$select public.branch_reconciliation('MWK')$q$,'%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('recon: bad currency refused', pg_temp.fails($q$select public.branch_reconciliation('EUR')$q$,'%Unsupported%'));

-- loan_summary carries the branch name and code
select pg_temp.chk('loan_summary has branch name and code', (select branch_name='Alpha' and branch_code='AAA' from public.loan_summary where id=:'l1'));
select pg_temp.chk('loan_summary: unassigned loan has no branch name', (select branch_name is null from public.loan_summary where id=:'l3'));

-- audit rows carry the branch of the record (set at write time)
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('audit: approving the Alpha loan is filed under Alpha', (select branch_id=:'ba'::uuid from public.audit_logs where action='APPROVE' and entity_id=:'l1'));
select pg_temp.chk('audit: view exposes branch name and filters work', (select count(*)>=1 from public.audit_log_view where branch_name='Alpha' and action='APPROVE'));
select pg_temp.chk('audit: branch filter separates Alpha from Beta', (select count(*) from public.audit_log_view where branch_id=:'ba'::uuid and action='APPROVE') < (select count(*) from public.audit_log_view where action='APPROVE'));
select pg_temp.chk('audit: creating a branch is filed under that branch', (select branch_id=:'bb'::uuid from public.audit_logs where action='CREATE' and entity_type='branch' and entity_id=:'bb'::uuid));
select pg_temp.chk('audit: no row is left without a branch when the actor has one', (select count(*)=0 from public.audit_logs a join public.profiles p on p.id=a.actor_id where a.branch_id is null and p.branch_id is not null));

-- transfer with reason: audit branch is the new branch, loans follow
select public.assign_borrower_branch(:'alice',:'bb'::uuid,'Customer relocated');
select pg_temp.chk('transfer: audit row filed under the destination, with names, reason and loan count', (select branch_id=:'bb'::uuid and details->>'from_name'='Alpha' and details->>'to_name'='Beta' and details->>'reason'='Customer relocated' and (details->>'loans_moved')::int=1 and (details->>'open_principal_minor')::bigint=2000000 from public.audit_logs where action='ASSIGN_BRANCH' and entity_id=:'alice' order by created_at desc limit 1));
select pg_temp.chk('transfer: loans follow the borrower', (select branch_id=:'bb'::uuid from public.loans where id=:'l1'));
select pg_temp.chk('transfer: reason is mandatory between branches', pg_temp.fails(format($q$select public.assign_borrower_branch(%L,%L,'  ')$q$,:'alice',:'ba'),'%reason%'));
select set_config('t.r', public.branch_reconciliation('MWK')::text, false);
select pg_temp.chk('transfer: totals still reconcile (only the stray 500,000 remains)', pg_temp.rr('collected','difference_minor')=0 and pg_temp.rr('disbursed','difference_minor')=500000);

select 'RESULT: '||count(*) filter(where ok)||' passed, '||count(*) filter(where not ok)||' failed' from t_res;
select 'FAILED - '||name from t_res where not ok;
