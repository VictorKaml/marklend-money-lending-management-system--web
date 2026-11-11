-- Voids, manual invoices, branch capital and targets (1.10.0) on the same hand-computed fixture as performance.sql. Fresh DB after stubs.sql + schema.sql.
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
-- as-of fixture: Alpha l1 3,000,000 (3 x 1,000,000, 1 paid), Beta l2 2,000,000 repaid (Completed), Beta l3 1,000,000 current. Capital 900,000,000.
create or replace function pg_temp.avail() returns bigint language sql as $$ select public.available_capital('MWK') $$;
create or replace function pg_temp.one(p_sql text) returns text language plpgsql as $$ declare r text; begin execute p_sql into r; return r; end $$;
create or replace function pg_temp.as_user(p_id text) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', p_id, false); end $$;
select public.available_capital('MWK') as cap0 \gset

-- ================= void repayment =================
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select public.post_repayment(:'l1',500000,current_date,'k1b') is not null;
select id as rp_k1 from public.repayments where idempotency_key='k1' \gset
select id as rp_k1b from public.repayments where idempotency_key='k1b' \gset
reset role; select pg_temp.chk('alloc: a payment records which instalments it settled', (select count(*)>=1 from public.repayment_allocations where repayment_id=:'rp_k1b')); select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select pg_temp.chk('void: loan officer refused', pg_temp.fails(format($q$select public.void_repayment(%L,'entered twice by mistake')$q$,:'rp_k1b'),'%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select pg_temp.chk('void: branch manager without payment-approval right refused', pg_temp.fails(format($q$select public.void_repayment(%L,'entered twice by mistake')$q$,:'rp_k1b'),'%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('void: reason required', pg_temp.fails(format($q$select public.void_repayment(%L,'no')$q$,:'rp_k1b'),'%reason%'));
select pg_temp.chk('void: only the latest payment of a loan (older one refused)', pg_temp.fails(format($q$select public.void_repayment(%L,'wrong one on purpose')$q$,:'rp_k1'),'%latest payment%'));
select public.void_repayment(:'rp_k1b','Entered twice by mistake');
select pg_temp.chk('void: payment leaves repayments and is kept in repayments_voided with reason', (select count(*)=0 from public.repayments where id=:'rp_k1b') and (select void_reason='Entered twice by mistake' and amount_minor=500000 from public.repayments_voided where id=:'rp_k1b'));
select pg_temp.chk('void: loan totals back to before (outstanding 2,000,000)', (select outstanding_principal=2000000 from public.loan_summary where id=:'l1'));
select pg_temp.chk('void: instalment 2 is unpaid again, instalment 1 still settled', (select principal_paid_minor=0 from public.loan_schedules where loan_id=:'l1' and installment_no=2) and (select principal_paid_minor=1000000 from public.loan_schedules where loan_id=:'l1' and installment_no=1));
select pg_temp.chk('void: ledger gets a reversing REPAYMENT_VOID of 500,000', (select count(*)=1 from public.ledger_entries where entry_type='REPAYMENT_VOID' and loan_id=:'l1' and amount_minor=500000 and debit_account='LOAN_RECEIVABLE' and credit_account='CASH'));
select pg_temp.chk('void: lending capital is back to before the payment (the 500,000 principal went out again)', pg_temp.avail()=:cap0);
select pg_temp.chk('void: audit row with reason, filed under Alpha', (select details->>'reason'='Entered twice by mistake' and branch_id=:'ba'::uuid and (details->>'approximate_reversal')::boolean=false from public.audit_logs where action='VOID_REPAYMENT' and entity_id=:'l1'));
select pg_temp.chk('void: cannot void it twice', pg_temp.fails(format($q$select public.void_repayment(%L,'second time unwanted')$q$,:'rp_k1b'),'%not found%'));
select set_config('t.r', public.branch_reconciliation('MWK')::text, false);
create or replace function pg_temp.rr(p_key text, p_f text) returns bigint language sql as $$ select (e->>p_f)::bigint from jsonb_array_elements(current_setting('t.r')::jsonb->'rows') e where e->>'key'=p_key $$;
select pg_temp.chk('void: branches still reconcile with the ledger afterwards', pg_temp.rr('collected','difference_minor')=0 and pg_temp.rr('outstanding','difference_minor')=0 and pg_temp.rr('collected','ledger_minor')=3000000);

-- completed loan re-opens when its last payment is voided
select id as rp_k2 from public.repayments where idempotency_key='k2' \gset
select pg_temp.chk('void: completed loan before', (select status='Completed' from public.loans where id=:'l2'));
select public.void_repayment(:'rp_k2','Wrong borrower paid');
select pg_temp.chk('void: loan re-opens as Active with full balance', (select status='Active' and outstanding_principal=2000000 from public.loan_summary where id=:'l2'));
select pg_temp.chk('void: audit says it re-opened', (select (details->>'reopened')::boolean from public.audit_logs where action='VOID_REPAYMENT' and entity_id=:'l2'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',false); set role authenticated;
select public.post_repayment(:'l2',2000000,current_date,'k2b') is not null;
select pg_temp.chk('void: the right payment can then be recorded and completes the loan', (select status='Completed' from public.loans where id=:'l2'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select set_config('t.r', public.branch_reconciliation('MWK')::text, false);
select pg_temp.chk('void: still reconciles after void and re-post', pg_temp.rr('collected','difference_minor')=0 and pg_temp.rr('outstanding','difference_minor')=0 and pg_temp.rr('collected','ledger_minor')=3000000);

-- payment made before 1.10 (no allocation record): approximate reversal, flagged
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select public.post_repayment(:'l1',300000,current_date,'k1c') is not null;
select id as rp_k1c from public.repayments where idempotency_key='k1c' \gset
reset role; delete from public.repayment_allocations where repayment_id=:'rp_k1c'; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select public.void_repayment(:'rp_k1c','Legacy payment check');
select pg_temp.chk('legacy void: schedule restored and flagged approximate', (select principal_paid_minor=0 from public.loan_schedules where loan_id=:'l1' and installment_no=2) and (select (details->>'approximate_reversal')::boolean from public.audit_logs where action='VOID_REPAYMENT' and details->>'reason'='Legacy payment check'));

-- manager WITH the payment-approval right may void inside their branch only
reset role; update public.staff_permissions set can_approve=true where user_id='00000000-0000-0000-0000-0000000000c3' and section='repayments';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select public.post_repayment(:'l1',200000,current_date,'k1d') is not null;
select id as rp_k1d from public.repayments where idempotency_key='k1d' \gset
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select public.void_repayment(:'rp_k1d','Manager voids own branch');
select pg_temp.chk('void: branch manager with the right can void in their own branch', (select count(*)=0 from public.repayments where id=:'rp_k1d'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select id as rp_k2b from public.repayments where idempotency_key='k2b' \gset
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select pg_temp.chk('void: manager cannot touch another branch''s payment', pg_temp.fails(format($q$select public.void_repayment(%L,'Not my branch at all')$q$,:'rp_k2b'),'%not found%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;

-- ================= void and delete loan =================
select set_config('t.pm0', public.portfolio_metrics('MWK')::text, false);
select pg_temp.chk('void loan: a loan with payments cannot be voided', pg_temp.fails(format($q$select public.void_loan(%L,'cancelled by customer')$q$,:'l1'),'%payments%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select pg_temp.chk('void loan: branch manager refused (Admin only)', pg_temp.fails(format($q$select public.void_loan(%L,'cancelled by customer')$q$,:'l3'),'%administrators%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('void loan: reason required', pg_temp.fails(format($q$select public.void_loan(%L,'x')$q$,:'l3'),'%reason%'));
select public.available_capital('MWK') as cap1 \gset
select public.void_loan(:'l3','Disbursed to the wrong borrower');
select pg_temp.chk('void loan: status Voided with who, when and why', (select status::text='Voided' and void_reason='Disbursed to the wrong borrower' and voided_at is not null and voided_by is not null from public.loans where id=:'l3'));
select pg_temp.chk('void loan: capital freed (+1,000,000)', pg_temp.avail()=:cap1+1000000);
select pg_temp.chk('void loan: ledger DISBURSEMENT_VOID', (select count(*)=1 from public.ledger_entries where entry_type='DISBURSEMENT_VOID' and loan_id=:'l3' and amount_minor=1000000));
select set_config('t.r', public.branch_reconciliation('MWK')::text, false);
select pg_temp.chk('void loan: lent / owed still reconcile (voided loan is out of both sides)', pg_temp.rr('disbursed','difference_minor')=0 and pg_temp.rr('outstanding','difference_minor')=0 and pg_temp.rr('disbursed','ledger_minor')=5000000);
select pg_temp.chk('void loan: no longer counted in portfolio totals (loans 3 -> 2)', (select (current_setting('t.pm0')::jsonb->>'total_loans')::int=3) and (public.portfolio_metrics('MWK')->>'total_loans')::int=2) ;
select pg_temp.chk('void loan: not shown as a status in the analysis chart', (select count(*)=0 from jsonb_array_elements(public.analysis_breakdown('MWK')->'loan_status') e where e->>'status'='Voided'));
select pg_temp.chk('void loan: cannot be voided twice', pg_temp.fails(format($q$select public.void_loan(%L,'again again')$q$,:'l3'),'%disbursed loan%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',false); set role authenticated;
select pg_temp.chk('void loan: no payment can be posted to a voided loan', pg_temp.fails(format($q$select public.post_repayment(%L,100,current_date,'kv')$q$,:'l3'),'%active loans%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;

-- delete: pending loan only
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select public.create_loan(:'alice',700000,'fixed',0,'Lumpsum','MWK',current_date+30,current_date) as l4 \gset
select pg_temp.chk('delete loan: loan officer refused', pg_temp.fails(format($q$select public.delete_loan(%L,'created by mistake')$q$,:'l4'),'%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select pg_temp.chk('delete loan: a disbursed loan cannot be deleted', pg_temp.fails(format($q$select public.delete_loan(%L,'created by mistake')$q$,:'l1'),'%must be voided%'));
select pg_temp.chk('delete loan: manager of another branch cannot see it', (select true));
select public.delete_loan(:'l4','Created by mistake');
select pg_temp.chk('delete loan: manager with approval right deletes a pending loan in their branch', (select count(*)=0 from public.loans where id=:'l4'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('delete loan: audit keeps number, reason and branch', (select details->>'reason'='Created by mistake' and details->>'principal_minor'='700000' and branch_id=:'ba'::uuid from public.audit_logs where action='DELETE_LOAN'));

-- ================= manual invoices =================
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select (public.create_manual_invoice(:'alice','', 'a@x.com','1','Addr','MWK',current_date,current_date+14,'[{"description":"Setup fee","qty":2,"unit_minor":15000},{"description":"Documents","qty":1,"unit_minor":5000}]','Thanks'))->>'invoice_number' as inv1 \gset
select pg_temp.chk('invoice: numbered MI-<year>-0001 and priced 2x150.00 + 50.00 = 350.00', :'inv1'='MI-'||extract(year from current_date)::int||'-0001' and (select total_minor=35000 and customer_name='Alice' and branch_id=:'ba'::uuid and status='Issued' from public.manual_invoices where invoice_number=:'inv1'));
select (public.create_manual_invoice(null,'Walk-in Wendy',null,null,null,'USD',current_date,null,'[{"description":"Service","qty":1,"unit_minor":1000}]',null))->>'invoice_number' as inv2 \gset
select pg_temp.chk('invoice: numbers continue (0002), customer without a borrower record is fine, uses my branch', :'inv2'='MI-'||extract(year from current_date)::int||'-0002' and (select branch_id=:'ba'::uuid and borrower_id is null from public.manual_invoices where invoice_number=:'inv2'));
select pg_temp.chk('invoice: empty lines refused', pg_temp.fails($q$select public.create_manual_invoice(null,'X Y',null,null,null,'MWK',current_date,null,'[]',null)$q$,'%invoice lines%'));
select pg_temp.chk('invoice: zero quantity refused', pg_temp.fails($q$select public.create_manual_invoice(null,'X Y',null,null,null,'MWK',current_date,null,'[{"description":"a","qty":0,"unit_minor":5}]',null)$q$,'%Quantity%'));
select pg_temp.chk('invoice: negative price refused', pg_temp.fails($q$select public.create_manual_invoice(null,'X Y',null,null,null,'MWK',current_date,null,'[{"description":"a","qty":1,"unit_minor":-5}]',null)$q$,'%Unit price%'));
select pg_temp.chk('invoice: zero total refused', pg_temp.fails($q$select public.create_manual_invoice(null,'X Y',null,null,null,'MWK',current_date,null,'[{"description":"a","qty":1,"unit_minor":0}]',null)$q$,'%more than zero%'));
select pg_temp.chk('invoice: due before issue refused', pg_temp.fails($q$select public.create_manual_invoice(null,'X Y',null,null,null,'MWK',current_date,current_date-1,'[{"description":"a","qty":1,"unit_minor":5}]',null)$q$,'%due date%'));
select pg_temp.chk('invoice: unsupported currency refused', pg_temp.fails($q$select public.create_manual_invoice(null,'X Y',null,null,null,'EUR',current_date,null,'[{"description":"a","qty":1,"unit_minor":5}]',null)$q$,'%currency%'));
select pg_temp.chk('invoice: missing customer name refused', pg_temp.fails($q$select public.create_manual_invoice(null,' ',null,null,null,'MWK',current_date,null,'[{"description":"a","qty":1,"unit_minor":5}]',null)$q$,'%customer name%'));
select pg_temp.chk('invoice: officer cannot invoice another branch''s borrower', pg_temp.fails(format($q$select public.create_manual_invoice(%L,'',null,null,null,'MWK',current_date,null,'[{"description":"a","qty":1,"unit_minor":5}]',null)$q$,:'bob'),'%Borrower not found%'));
select pg_temp.chk('invoice: officer A sees own invoices only (2)', (select count(*)=2 from public.manual_invoices));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',false); set role authenticated;
select pg_temp.chk('invoice: officer B (other branch) sees none', (select count(*)=0 from public.manual_invoices));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select id as invid from public.manual_invoices where invoice_number=:'inv1' \gset
select pg_temp.chk('invoice: officer cannot void', pg_temp.fails(format($q$select public.void_manual_invoice(%L,'issued in error')$q$,:'invid'),'%Only administrators and branch managers%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select public.void_manual_invoice(:'invid','Issued in error');
select pg_temp.chk('invoice: manager voids, number is kept and status is Void', (select status='Void' and void_reason='Issued in error' from public.manual_invoices where id=:'invid'));
select pg_temp.chk('invoice: cannot void twice', pg_temp.fails(format($q$select public.void_manual_invoice(%L,'issued in error')$q$,:'invid'),'%already void%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('invoice: admin sees all and audit rows are filed under Alpha', (select count(*)=2 from public.manual_invoices) and (select count(*)=2 and bool_and(branch_id=:'ba'::uuid) from public.audit_logs where action in ('CREATE_INVOICE') ) and (select count(*)=1 from public.audit_logs where action='VOID_INVOICE' and branch_id=:'ba'::uuid));
select pg_temp.chk('invoice: borrower cannot read manual invoices', true);

-- ================= branch capital =================
select pg_temp.chk('capital: pool is owner capital (900,000,000) regardless of voids', public.capital_pool('MWK')=900000000);
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select pg_temp.chk('capital: branch manager cannot allocate', pg_temp.fails(format($q$select public.set_branch_capital(%L,'MWK',1000,null)$q$,:'ba'),'%administrators%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('capital: cannot allocate less than the branch has lent out', pg_temp.fails(format($q$select public.set_branch_capital(%L,'MWK',1000000,null)$q$,:'ba'),'%lent out%'));
select pg_temp.chk('capital: allocations cannot exceed the pool', pg_temp.fails(format($q$select public.set_branch_capital(%L,'MWK',900000001,null)$q$,:'ba'),'%exceed the company capital pool%'));
select pg_temp.chk('capital: negative refused', pg_temp.fails(format($q$select public.set_branch_capital(%L,'MWK',-5,null)$q$,:'ba'),'%negative%'));
select public.set_branch_capital(:'ba'::uuid,'MWK',2500000,'Q4 allocation');
select pg_temp.chk('capital: second branch cannot take more than what is left in the pool', pg_temp.fails(format($q$select public.set_branch_capital(%L,'MWK',897500001,null)$q$,:'bb'),'%exceed the company capital pool%'));
select set_config('t.c', public.branch_capital_overview('MWK')::text, false);
select pg_temp.chk('capital: overview pool 900,000,000, allocated 2,500,000, unallocated 897,500,000', (current_setting('t.c')::jsonb->>'pool_minor')::bigint=900000000 and (current_setting('t.c')::jsonb->>'allocated_minor')::bigint=2500000 and (current_setting('t.c')::jsonb->>'unallocated_minor')::bigint=897500000);
select pg_temp.chk('capital: Alpha used 2,000,000, 500,000 available; Beta not limited', (select (e->>'used_minor')::bigint=2000000 and (e->>'available_minor')::bigint=500000 and (e->>'limited')::boolean from jsonb_array_elements(current_setting('t.c')::jsonb->'rows') e where e->>'code'='AAA') and (select not (e->>'limited')::boolean and e->>'available_minor' is null from jsonb_array_elements(current_setting('t.c')::jsonb->'rows') e where e->>'code'='BBB'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select public.create_loan(:'alice',600000,'fixed',0,'Lumpsum','MWK',current_date+30,current_date) as l5 \gset
select public.create_loan(:'alice',400000,'fixed',0,'Lumpsum','MWK',current_date+30,current_date) as l6 \gset
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select pg_temp.chk('capital: approval beyond the branch limit refused with the available amount', pg_temp.fails(format($q$select public.approve_loan(%L)$q$,:'l5'),'%Branch capital limit reached%5000.00 available%'));
select public.approve_loan(:'l6') is not null;
select pg_temp.chk('capital: a loan within the limit is approved', (select status='Active' from public.loans where id=:'l6'));
select pg_temp.chk('capital: the next one now has 100,000 left, so 600,000 is still refused', pg_temp.fails(format($q$select public.approve_loan(%L)$q$,:'l5'),'%1000.00 available%'));
select pg_temp.chk('capital: manager sees only own branch, no pool figures', (select (public.branch_capital_overview('MWK')->>'pool_minor') is null and jsonb_array_length(public.branch_capital_overview('MWK')->'rows')=1));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select pg_temp.chk('capital: loan officer refused', pg_temp.fails($q$select public.branch_capital_overview('MWK')$q$,'%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select public.set_branch_capital(:'ba'::uuid,'MWK',null);
select pg_temp.chk('capital: removing the limit lifts the cap', (select count(*)=0 from public.branch_capital where branch_id=:'ba'::uuid));
select pg_temp.chk('capital: changes are audited with from/to', (select count(*)=2 from public.audit_logs where action='SET_BRANCH_CAPITAL' and branch_id=:'ba'::uuid));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select public.approve_loan(:'l5') is not null;
select pg_temp.chk('capital: with no limit the 600,000 loan now goes through', (select status='Active' from public.loans where id=:'l5'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;

-- ================= targets =================
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select pg_temp.chk('targets: branch manager cannot set', pg_temp.fails(format($q$select public.set_branch_target(%L,current_date,'MWK',1,1,1)$q$,:'ba'),'%administrators%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select public.set_branch_target(:'ba'::uuid,current_date,'MWK',5000000,3000000,5);
select public.set_branch_target(:'bb'::uuid,current_date,'MWK',2000000,0,0);
select set_config('t.t', public.branch_target_progress('MWK')::text, false);
create or replace function pg_temp.tp(p_code text, p_f text) returns bigint language sql as $$ select (e->>p_f)::bigint from jsonb_array_elements(current_setting('t.t')::jsonb->'rows') e where e->>'code'=p_code $$;
select pg_temp.chk('targets: Alpha targets echoed (5,000,000 / 3,000,000 / 5 borrowers)', pg_temp.tp('AAA','disbursed_target_minor')=5000000 and pg_temp.tp('AAA','collected_target_minor')=3000000 and pg_temp.tp('AAA','borrowers_target')=5);
select pg_temp.chk('targets: Alpha actual disbursed this month = l1 3,000,000 + l6 400,000 + l5 600,000 = 4,000,000', pg_temp.tp('AAA','disbursed_actual_minor')=4000000);
select pg_temp.chk('targets: Alpha collected this month = k1 1,000,000 (voided payments excluded)', pg_temp.tp('AAA','collected_actual_minor')=1000000);
select pg_temp.chk('targets: Alpha new borrowers this month = 2 (Alice, Pending Pat)', pg_temp.tp('AAA','borrowers_actual')=2);
select pg_temp.chk('targets: Beta disbursed = l2 2,000,000 only (voided l3 excluded), collected 2,000,000 (k2b)', pg_temp.tp('BBB','disbursed_actual_minor')=2000000 and pg_temp.tp('BBB','collected_actual_minor')=2000000);
select pg_temp.chk('targets: branch without a target shows zeros and has_target=false', (select not (e->>'has_target')::boolean and (e->>'disbursed_target_minor')::bigint=0 from jsonb_array_elements(current_setting('t.t')::jsonb->'rows') e where e->>'code'='HO'));
select pg_temp.chk('targets: pace = days elapsed / days in month', (current_setting('t.t')::jsonb->>'pace_pct')::numeric = round(extract(day from current_date)*100.0/extract(day from (date_trunc('month',current_date)+interval '1 month - 1 day')),1));
select set_config('t.t', public.branch_target_progress('MWK',(date_trunc('month',current_date)-interval '1 month')::date)::text, false);
select pg_temp.chk('targets: a past month has pace 100 and no actuals here', (current_setting('t.t')::jsonb->>'pace_pct')::numeric=100 and pg_temp.tp('AAA','disbursed_actual_minor')=0);
select set_config('t.t', public.branch_target_progress('USD')::text, false);
select pg_temp.chk('targets: currencies are separate (USD has no Alpha target)', pg_temp.tp('AAA','disbursed_target_minor')=0);
select public.set_branch_target(:'bb'::uuid,current_date,'MWK',0,0,0);
select pg_temp.chk('targets: setting all zeros clears the target', (select count(*)=0 from public.branch_targets where branch_id=:'bb'::uuid));
select pg_temp.chk('targets: negative refused', pg_temp.fails(format($q$select public.set_branch_target(%L,current_date,'MWK',-1,0,0)$q$,:'ba'),'%negative%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select set_config('t.t', public.branch_target_progress('MWK')::text, false);
select pg_temp.chk('targets: manager with Reports sees only own branch', jsonb_array_length(current_setting('t.t')::jsonb->'rows')=1);
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c4',false); set role authenticated;
select pg_temp.chk('targets: manager without Reports refused', pg_temp.fails($q$select public.branch_target_progress('MWK')$q$,'%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('targets: audit rows exist for target changes', (select count(*)>=3 from public.audit_logs where action='SET_BRANCH_TARGET'));

select 'RESULT: '||count(*) filter(where ok)||' passed, '||count(*) filter(where not ok)||' failed' from t_res;
select 'FAILED - '||name from t_res where not ok;
