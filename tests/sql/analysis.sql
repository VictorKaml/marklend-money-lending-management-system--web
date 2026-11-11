-- Analysis breakdown tests (1.9.0) on the same hand-computed fixture as performance.sql. Fresh DB after stubs.sql + schema.sql.
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
select set_config('t.a', public.analysis_breakdown('MWK')::text, false);
create or replace function pg_temp.j(p_path text[]) returns jsonb language sql as $$ select current_setting('t.a')::jsonb #> p_path $$;
select pg_temp.chk('by_branch: Alpha 2,000,000 outstanding / 1,000,000 collected', (select (e->>'outstanding_minor')::bigint=2000000 and (e->>'collected_minor')::bigint=1000000 from jsonb_array_elements(pg_temp.j('{by_branch}')) e where e->>'code'='AAA'));
select pg_temp.chk('by_branch: Beta 1,000,000 outstanding / 2,000,000 collected', (select (e->>'outstanding_minor')::bigint=1000000 and (e->>'collected_minor')::bigint=2000000 from jsonb_array_elements(pg_temp.j('{by_branch}')) e where e->>'code'='BBB'));
select pg_temp.chk('by_branch: Head Office present with zeros', (select (e->>'outstanding_minor')::bigint=0 and (e->>'collected_minor')::bigint=0 from jsonb_array_elements(pg_temp.j('{by_branch}')) e where e->>'code'='HO'));
select pg_temp.chk('loan_status: Active 2, Completed 1', (select (select (e->>'count')::int from jsonb_array_elements(pg_temp.j('{loan_status}')) e where e->>'status'='Active')=2 and (select (e->>'count')::int from jsonb_array_elements(pg_temp.j('{loan_status}')) e where e->>'status'='Completed')=1));
select pg_temp.chk('kyc: Verified 2, Pending 1', (select (select (e->>'count')::int from jsonb_array_elements(pg_temp.j('{kyc}')) e where e->>'status'='Verified')=2 and (select (e->>'count')::int from jsonb_array_elements(pg_temp.j('{kyc}')) e where e->>'status'='Pending')=1));
select pg_temp.chk('risk: all Low, 3,000,000 over 2 loans', (jsonb_array_length(pg_temp.j('{risk}'))=1 and (pg_temp.j('{risk,0,outstanding_minor}'))::text::bigint=3000000 and pg_temp.j('{risk,0,risk}')='"Low"'::jsonb and (pg_temp.j('{risk,0,count}'))::text::int=2));
select pg_temp.chk('currency_mix: MWK 2 loans', (jsonb_array_length(pg_temp.j('{currency_mix}'))=1 and pg_temp.j('{currency_mix,0,currency}')='"MWK"'::jsonb and (pg_temp.j('{currency_mix,0,count}'))::text::int=2));
select pg_temp.chk('slices add up: branch outstanding = risk total = currency total', (select (select sum((e->>'outstanding_minor')::bigint) from jsonb_array_elements(pg_temp.j('{by_branch}')) e) = (pg_temp.j('{risk,0,outstanding_minor}'))::text::bigint and (pg_temp.j('{risk,0,outstanding_minor}'))::text::bigint = (pg_temp.j('{currency_mix,0,outstanding_minor}'))::text::bigint));
select pg_temp.chk('collected total equals the repayments posted (3,000,000)', (select sum((e->>'collected_minor')::bigint)=3000000 from jsonb_array_elements(pg_temp.j('{by_branch}')) e));

-- period applies only to collections
select set_config('t.a', public.analysis_breakdown('MWK', current_date+1, current_date+5)::text, false);
select pg_temp.chk('future window: collections 0, snapshots unchanged', (select sum((e->>'collected_minor')::bigint)=0 and sum((e->>'outstanding_minor')::bigint)=3000000 from jsonb_array_elements(pg_temp.j('{by_branch}')) e));
select set_config('t.a', public.analysis_breakdown('USD')::text, false);
select pg_temp.chk('USD: no money in any branch, no risk slices, but status counts still show', (select sum((e->>'outstanding_minor')::bigint)=0 from jsonb_array_elements(pg_temp.j('{by_branch}')) e) and jsonb_array_length(pg_temp.j('{risk}'))=0 and jsonb_array_length(pg_temp.j('{loan_status}'))>0);
select pg_temp.chk('currency_mix is not filtered by the selected currency', jsonb_array_length(pg_temp.j('{currency_mix}'))=1);
select pg_temp.chk('bad range rejected', pg_temp.fails('select public.analysis_breakdown(''MWK'', current_date, current_date-1)', '%after the end date%'));

-- scoping
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',false); set role authenticated;
select set_config('t.a', public.analysis_breakdown('MWK')::text, false);
select pg_temp.chk('officer B sees only Beta', (jsonb_array_length(pg_temp.j('{by_branch}'))=1 and pg_temp.j('{by_branch,0,code}')='"BBB"'::jsonb));
select pg_temp.chk('officer B status counts: Active 1, Completed 1 only', (select sum((e->>'count')::int)=2 from jsonb_array_elements(pg_temp.j('{loan_status}')) e));
select pg_temp.chk('officer B KYC: only their Verified borrower', (jsonb_array_length(pg_temp.j('{kyc}'))=1 and (pg_temp.j('{kyc,0,count}'))::text::int=1));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select set_config('t.a', public.analysis_breakdown('MWK')::text, false);
select pg_temp.chk('manager A sees only Alpha with its pending borrower', (jsonb_array_length(pg_temp.j('{by_branch}'))=1 and pg_temp.j('{by_branch,0,code}')='"AAA"'::jsonb and (select (e->>'count')::int from jsonb_array_elements(pg_temp.j('{kyc}')) e where e->>'status'='Pending')=1));

-- borrowers are refused; repayment_summary exposes the branch
reset role; insert into auth.users(id,email) values ('00000000-0000-0000-0000-0000000000b9','bor@x.com');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b9',false); set role authenticated;
select pg_temp.chk('borrower is refused', pg_temp.fails('select public.analysis_breakdown(''MWK'')', '%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('repayment_summary carries branch_id', (select count(*)=2 and bool_and(branch_id is not null) from public.repayment_summary));

reset role;
select 'RESULT: ' || count(*) filter(where ok) || ' passed, ' || count(*) filter(where not ok) || ' failed' from t_res;
