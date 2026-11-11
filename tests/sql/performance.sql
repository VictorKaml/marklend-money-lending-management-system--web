-- Branch performance tests (1.8.2) with hand-computed expectations. Fresh DB after stubs.sql + schema.sql.
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

-- admin view
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select public.branch_metrics('MWK') as m \gset
select set_config('t.m', :'m', false);
select pg_temp.chk('admin sees both branches', (jsonb_array_length(current_setting('t.m')::jsonb)=3));  -- Head Office + Alpha + Beta
select pg_temp.chk('A: borrowers 2, verified 1, 3 staff', (select (e->>'borrowers')::int=2 and (e->>'kyc_verified')::int=1 and (e->>'officers')::int=3 from (select pg_temp.row('AAA',current_setting('t.m')::jsonb) e) q));
select pg_temp.chk('A: active 1, outstanding 2,000,000, disbursed 3,000,000', (select (e->>'active_loans')::int=1 and (e->>'outstanding_minor')::bigint=2000000 and (e->>'disbursed_minor')::bigint=3000000 and (e->>'disbursed_count')::int=1 from (select pg_temp.row('AAA',current_setting('t.m')::jsonb) e) q));
select pg_temp.chk('A: collected 1,000,000; due 3,000,000; paid 1,000,000 (33.3%)', (select (e->>'collected_minor')::bigint=1000000 and (e->>'due_minor')::bigint=3000000 and (e->>'paid_on_due_minor')::bigint=1000000 from (select pg_temp.row('AAA',current_setting('t.m')::jsonb) e) q));
select pg_temp.chk('A: PAR30 is all of outstanding (2,000,000)', (select (e->>'par30_minor')::bigint=2000000 from (select pg_temp.row('AAA',current_setting('t.m')::jsonb) e) q));
select pg_temp.chk('B: collected and due both 2,000,000, nothing at risk', (select (e->>'collected_minor')::bigint=2000000 and (e->>'due_minor')::bigint=2000000 and (e->>'paid_on_due_minor')::bigint=2000000 and (e->>'par30_minor')::bigint=0 from (select pg_temp.row('BBB',current_setting('t.m')::jsonb) e) q));
select pg_temp.chk('B: only the current loan is active (1,000,000); 2 loans disbursed', (select (e->>'active_loans')::int=1 and (e->>'outstanding_minor')::bigint=1000000 and (e->>'disbursed_count')::int=2 and (e->>'disbursed_minor')::bigint=3000000 from (select pg_temp.row('BBB',current_setting('t.m')::jsonb) e) q));
select pg_temp.chk('B: loan not yet due is excluded from the collection rate', (select (e->>'due_minor')::bigint=2000000 from (select pg_temp.row('BBB',current_setting('t.m')::jsonb) e) q));
select pg_temp.chk('Head Office has zeros', (select (e->>'active_loans')::int=0 and (e->>'disbursed_minor')::bigint=0 from (select pg_temp.row('HO',current_setting('t.m')::jsonb) e) q));

-- period and currency filters
select set_config('t.m2', public.branch_metrics('MWK', current_date+1, current_date+10)::text, false);
select pg_temp.chk('future window: nothing disbursed or collected, outstanding unchanged', (select (e->>'disbursed_minor')::bigint=0 and (e->>'collected_minor')::bigint=0 and (e->>'outstanding_minor')::bigint=2000000 from (select pg_temp.row('AAA',current_setting('t.m2')::jsonb) e) q));
select set_config('t.m3', public.branch_metrics('MWK', null, current_date-80)::text, false);
select pg_temp.chk('window ending 80 days ago: no instalments due yet -> due 0', (select (e->>'due_minor')::bigint=0 from (select pg_temp.row('AAA',current_setting('t.m3')::jsonb) e) q));
select set_config('t.m4', public.branch_metrics('USD')::text, false);
select pg_temp.chk('USD view is empty for MWK loans (no mixing)', (select (e->>'outstanding_minor')::bigint=0 and (e->>'disbursed_minor')::bigint=0 from (select pg_temp.row('AAA',current_setting('t.m4')::jsonb) e) q));
select pg_temp.chk('bad range rejected', pg_temp.fails('select public.branch_metrics(''MWK'', current_date, current_date-1)', '%after the end date%'));
select pg_temp.chk('unsupported currency rejected', pg_temp.fails('select public.branch_metrics(''EUR'')', '%Unsupported currency%'));

-- officers
select set_config('t.o', public.officer_metrics(:'ba'::uuid,'MWK')::text, false);
select pg_temp.chk('officer A: 1 loan created, 3,000,000 requested, 1 open, outstanding 2,000,000, PAR30 2,000,000', (select (e->>'loans_created')::int=1 and (e->>'requested_minor')::bigint=3000000 and (e->>'open_loans')::int=1 and (e->>'outstanding_minor')::bigint=2000000 and (e->>'par30_minor')::bigint=2000000 from jsonb_array_elements(current_setting('t.o')::jsonb) e where e->>'name'='Officer A'));
select pg_temp.chk('officer A verified 1 borrower KYC', (select (e->>'kyc_verified')::int=1 from jsonb_array_elements(current_setting('t.o')::jsonb) e where e->>'name'='Officer A'));
select pg_temp.chk('manager A listed with zero loans', (select (e->>'loans_created')::int=0 from jsonb_array_elements(current_setting('t.o')::jsonb) e where e->>'name'='Manager A'));
select pg_temp.chk('branch totals equal the sum of officer rows', (select sum((e->>'outstanding_minor')::bigint)=2000000 and sum((e->>'disbursed_minor')::bigint)=3000000 from jsonb_array_elements(current_setting('t.o')::jsonb) e));
select pg_temp.chk('no "not recorded" row when every loan has a creator', (select count(*)=0 from jsonb_array_elements(current_setting('t.o')::jsonb) e where e->>'user_id' is null));

-- loans without a recorded creator (pre-1.8.1) are reported separately
reset role; update public.loans set created_by=null where id=:'l1'; set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select set_config('t.o2', public.officer_metrics(:'ba'::uuid,'MWK')::text, false);
select pg_temp.chk('creator-less loan shows under "Not recorded"', (select (e->>'outstanding_minor')::bigint=2000000 from jsonb_array_elements(current_setting('t.o2')::jsonb) e where e->>'user_id' is null));
reset role; update public.loans set created_by='00000000-0000-0000-0000-0000000000c1' where id=:'l1'; set role authenticated;

-- access control
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select set_config('t.mm', public.branch_metrics('MWK')::text, false);
select pg_temp.chk('manager (with Reports) sees only their own branch', (jsonb_array_length(current_setting('t.mm')::jsonb)=1 and current_setting('t.mm')::jsonb->0->>'code'='AAA'));
select pg_temp.chk('manager sees own officers', (jsonb_array_length(public.officer_metrics(:'ba'::uuid,'MWK'))>=2));
select pg_temp.chk('manager cannot read another branch officers', pg_temp.fails(format('select public.officer_metrics(%L,''MWK'')', :'bb'), '%Branch not found%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c4',false); set role authenticated;
select pg_temp.chk('manager without Reports access is refused', pg_temp.fails('select public.branch_metrics(''MWK'')', '%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select pg_temp.chk('loan officer is refused branch performance', pg_temp.fails('select public.branch_metrics(''MWK'')', '%Not authorized%'));
select pg_temp.chk('loan officer is refused officer performance', pg_temp.fails(format('select public.officer_metrics(%L,''MWK'')', :'ba'), '%Not authorized%'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
select 'RESULT: ' || count(*) filter(where ok) || ' passed, ' || count(*) filter(where not ok) || ' failed' from t_res;
