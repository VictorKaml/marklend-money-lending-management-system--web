-- Loan officer workflow tests (1.8.1): KYC rules and maker-checker. Run on a FRESH database after stubs.sql + schema.sql.
\set ON_ERROR_STOP off
\pset tuples_only on
create temp table t_res(ok boolean, name text);
grant all on t_res to public;
create or replace function pg_temp.chk(p_name text, p_ok boolean) returns void language plpgsql as $$
begin insert into t_res values(coalesce(p_ok,false), p_name); raise notice '% %', case when coalesce(p_ok,false) then 'PASS' else 'FAIL' end, p_name; end $$;
create or replace function pg_temp.fails(p_sql text, p_like text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return sqlerrm like p_like; end $$;
grant execute on function pg_temp.chk(text,boolean), pg_temp.fails(text,text) to public;

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@x.com'),('00000000-0000-0000-0000-0000000000c1','off@x.com'),
 ('00000000-0000-0000-0000-0000000000c3','mgr@x.com'),('00000000-0000-0000-0000-0000000000b9','bor@x.com');
update public.profiles set role='Admin' where id='00000000-0000-0000-0000-0000000000a1';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;
select public.create_branch('Main','MAIN') as br \gset
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c1','Officer','off@x.com','Loan Officer',array['dashboard','borrowers','loans','repayments','reports'], :'br'::uuid);
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c3','Manager','mgr@x.com','Branch Manager',array['dashboard','borrowers','loans','repayments','reports'], :'br'::uuid);
select public.add_capital(900000000,'MWK','Owner','F1') is not null;

-- officer creates a borrower (Pending) and tries to lend
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
insert into public.borrowers(full_name,phone,email) values('Chipo','0991','c@x.com');
select id as bid from public.borrowers where full_name='Chipo' \gset
select pg_temp.chk('loan blocked while KYC is Pending', pg_temp.fails(format('select public.create_loan(%L,1000000,''fixed'',1000,''Monthly'',''MWK'',current_date+90)', :'bid'), '%KYC must be Verified%'));
select pg_temp.chk('cannot verify without ID details', pg_temp.fails(format('update public.borrowers set kyc_status=''Verified'' where id=%L', :'bid'), '%ID type, ID number and address%'));
update public.borrowers set id_type='National ID', id_number='MW123', address='Area 3', next_of_kin_name='Kin', next_of_kin_phone='0888' where id=:'bid';
select pg_temp.chk('cannot reject without a reason', pg_temp.fails(format('update public.borrowers set kyc_status=''Rejected'' where id=%L', :'bid'), '%reason is required%'));
update public.borrowers set kyc_status='Rejected', kyc_reason='Blurry ID photo' where id=:'bid';
select pg_temp.chk('rejection stores reason and clears verifier', (select kyc_reason='Blurry ID photo' and kyc_verified_by is null from public.borrowers where id=:'bid'));
select pg_temp.chk('loan blocked while KYC is Rejected', pg_temp.fails(format('select public.create_loan(%L,1000000,''fixed'',1000,''Monthly'',''MWK'',current_date+90)', :'bid'), '%KYC must be Verified%'));
update public.borrowers set kyc_status='Verified' where id=:'bid';
select pg_temp.chk('verify stamps verifier and time, clears reason', (select kyc_verified_by='00000000-0000-0000-0000-0000000000c1' and kyc_verified_at is not null and kyc_reason is null from public.borrowers where id=:'bid'));
select pg_temp.chk('every KYC change is audited with the branch', (select count(*)=2 and bool_and((details->>'branch_id')=:'br') from public.audit_logs where action='KYC_CHANGE' and entity_id=:'bid'::uuid));
select pg_temp.chk('audit trail records from/to and reason', exists(select 1 from public.audit_logs where action='KYC_CHANGE' and details->>'to'='Rejected' and details->>'reason'='Blurry ID photo' and details->>'from'='Pending'));

-- maker-checker
select public.create_loan(:'bid',5000000,'fixed',1000,'Monthly','MWK',current_date+90) as l1 \gset
select pg_temp.chk('loan records its creator', (select created_by='00000000-0000-0000-0000-0000000000c1' from public.loans where id=:'l1'));
select pg_temp.chk('officer cannot approve own loan', pg_temp.fails(format('select public.approve_loan(%L)', :'l1'), '%another person must approve%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select public.approve_loan(:'l1') is not null as approved;
select pg_temp.chk('manager approves officer loan', (select status='Active' from public.loans where id=:'l1'));
select pg_temp.chk('approval audit has branch, maker, no self-approval', exists(select 1 from public.audit_logs where action='APPROVE' and entity_id=:'l1'::uuid and details->>'branch_id'=:'br' and details->>'created_by'='00000000-0000-0000-0000-0000000000c1' and details->>'self_approved'='false'));

-- manager cannot approve a loan they created either
update public.borrowers set kyc_status='Verified' where id=:'bid';  -- no-op
select public.create_loan(:'bid',2000000,'fixed',1000,'Monthly','MWK',current_date+90) as l2 \gset
select pg_temp.chk('manager cannot approve own loan', pg_temp.fails(format('select public.approve_loan(%L)', :'l2'), '%another person must approve%'));
select pg_temp.chk('creator may still reject (withdraw) own loan', (select public.reject_loan(:'l2','Entered by mistake') is not null));
select pg_temp.chk('reject audit carries branch', exists(select 1 from public.audit_logs where action='REJECT' and entity_id=:'l2'::uuid and details->>'branch_id'=:'br'));

-- admin exception is explicit and audited
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select public.create_loan(:'bid',1000000,'fixed',1000,'Monthly','MWK',current_date+90) as l3 \gset
select public.approve_loan(:'l3') is not null as admin_self;
select pg_temp.chk('admin may self-approve, flagged in audit', exists(select 1 from public.audit_logs where action='APPROVE' and entity_id=:'l3'::uuid and details->>'self_approved'='true'));

-- borrower cannot touch verification fields
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b9',false); set role authenticated;
select pg_temp.chk('borrower cannot self-verify', pg_temp.fails('update public.borrowers set kyc_status=''Verified'' where user_id=auth.uid()', '%Only authorized staff%'));
select pg_temp.chk('borrower cannot edit kyc_reason', pg_temp.fails('update public.borrowers set kyc_reason=''x'' where user_id=auth.uid()', '%Only authorized staff%'));
update public.borrowers set address='My street' where user_id=auth.uid();
select pg_temp.chk('borrower can still edit own address', (select address='My street' from public.borrowers where user_id=auth.uid()));

reset role;
select 'RESULT: ' || count(*) filter(where ok) || ' passed, ' || count(*) filter(where not ok) || ' failed' from t_res;
