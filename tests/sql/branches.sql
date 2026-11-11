-- Branch isolation tests (1.8). Run on a FRESH database after stubs.sql and supabase/schema.sql.
-- Every check prints PASS/FAIL; the script ends with a FAIL count (expect 0).
\set ON_ERROR_STOP off
\pset tuples_only on
create temp table t_res(ok boolean, name text);
grant all on t_res to public;
create or replace function pg_temp.chk(p_name text, p_ok boolean) returns void language plpgsql as $$
begin insert into t_res values(coalesce(p_ok,false), p_name); raise notice '% %', case when coalesce(p_ok,false) then 'PASS' else 'FAIL' end, p_name; end $$;

insert into auth.users(id,email) values
 ('00000000-0000-0000-0000-0000000000a1','admin@x.com'),
 ('00000000-0000-0000-0000-0000000000c1','offa@x.com'),
 ('00000000-0000-0000-0000-0000000000c2','offb@x.com'),
 ('00000000-0000-0000-0000-0000000000c3','mgra@x.com'),
 ('00000000-0000-0000-0000-0000000000b9','selfsignup@x.com');
update public.profiles set role='Admin' where id='00000000-0000-0000-0000-0000000000a1';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false);
set role authenticated;

-- admin builds two branches and staff
select public.create_branch('Lilongwe','LLW','City Centre','0111') as ba \gset
select public.create_branch('Blantyre','BT') as bb \gset
do $$ begin begin perform public.create_branch('lilongwe','X1'); perform pg_temp.chk('duplicate name rejected', false); exception when others then perform pg_temp.chk('duplicate name rejected', sqlerrm like '%already exists%'); end; end $$;
do $$ begin begin perform public.create_branch('New','bad code!'); perform pg_temp.chk('bad code rejected', false); exception when others then perform pg_temp.chk('bad code rejected', sqlerrm like '%2-10%'); end; end $$;
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c1','Off A','offa@x.com','Loan Officer',array['dashboard','borrowers','loans','repayments','ledger','reports'], :'ba'::uuid);
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c2','Off B','offb@x.com','Loan Officer',array['dashboard','borrowers','loans','repayments','ledger','reports'], :'bb'::uuid);
select public.provision_staff_profile('00000000-0000-0000-0000-0000000000c3','Mgr A','mgra@x.com','Branch Manager',array['dashboard','borrowers','loans','repayments','ledger','reports'], :'ba'::uuid);
do $$ begin begin perform public.provision_staff_profile('00000000-0000-0000-0000-0000000000c1','x','x@x.com','Loan Officer',array['loans'],null); perform pg_temp.chk('officer without branch rejected', false); exception when others then perform pg_temp.chk('officer without branch rejected', sqlerrm like '%Choose a branch%'); end; end $$;
select public.update_branch(:'ba'::uuid,'Lilongwe','LLW','City Centre','0111','00000000-0000-0000-0000-0000000000c3');
do $$ begin begin perform public.update_branch((select id from public.branches where code='BT'),'Blantyre','BT',null,null,'00000000-0000-0000-0000-0000000000c3'); perform pg_temp.chk('manager of another branch rejected', false); exception when others then perform pg_temp.chk('manager of another branch rejected', sqlerrm like '%assigned to this branch%'); end; end $$;
select public.add_capital(500000000,'MWK','Owner','F1') is not null;

-- officers create borrowers; branch is server-assigned and cannot be spoofed
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
insert into public.borrowers(full_name,phone,email,branch_id) values('Alice A','0991','a@x.com',:'bb'::uuid);
select pg_temp.chk('officer A insert ignores spoofed branch', (select branch_id=:'ba'::uuid from public.borrowers where full_name='Alice A'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',false); set role authenticated;
insert into public.borrowers(full_name,phone,email) values('Bob B','0992','b@x.com');
select pg_temp.chk('officer B sees only own branch borrowers', (select count(*)=1 and bool_and(full_name='Bob B') from public.borrowers where user_id is null));
select pg_temp.chk('officer B cannot see branch A borrower by id', (select count(*)=0 from public.borrowers where full_name='Alice A'));
update public.borrowers set kyc_status='Verified' where full_name='Alice A';
reset role; select pg_temp.chk('officer B cannot update branch A borrower', (select kyc_status='Pending' from public.borrowers where full_name='Alice A')); set role authenticated;
do $$ begin begin update public.borrowers set branch_id=(select id from public.branches where code='LLW') where full_name='Bob B'; perform pg_temp.chk('direct branch change blocked', false); exception when others then perform pg_temp.chk('direct branch change blocked', sqlerrm like '%assign functions%'); end; end $$;

-- loans
reset role; update public.borrowers set id_type='National ID', id_number='X1', address='Addr', kyc_status='Verified' where true; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select public.create_loan((select id from public.borrowers where full_name='Alice A'),10000000,'fixed',1000,'Monthly','MWK',current_date+90,current_date-60) as loan_a \gset
do $$ begin begin perform public.create_loan((select id from public.borrowers where full_name='Bob B'),1000000,'fixed',1000,'Monthly','MWK',current_date+90); perform pg_temp.chk('officer A cannot create loan for branch B borrower', false); exception when others then perform pg_temp.chk('officer A cannot create loan for branch B borrower', sqlerrm like '%Borrower not found%'); end; end $$;
select pg_temp.chk('loan inherits borrower branch', (select branch_id=:'ba'::uuid from public.loans where id=:'loan_a'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select public.approve_loan(:'loan_a') is not null as approved_by_manager;
select pg_temp.chk('manager approves own branch loan', (select status='Active' from public.loans where id=:'loan_a'));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',false); set role authenticated;
select pg_temp.chk('officer B cannot read branch A loan', (select count(*)=0 from public.loans));
select pg_temp.chk('officer B cannot read branch A schedules', (select count(*)=0 from public.loan_schedules));
select pg_temp.chk('officer B cannot read branch A ledger loan entries', (select count(*)=0 from public.ledger_entries where loan_id is not null));
select pg_temp.chk('officer B sees company capital ledger (shared)', (select count(*)>=1 from public.ledger_entries where loan_id is null));
select set_config('t.la', :'loan_a', false);
do $$ begin begin perform public.repayment_preview(current_setting('t.la')::uuid, 100); perform pg_temp.chk('preview of foreign loan blocked', false); exception when others then perform pg_temp.chk('preview of foreign loan blocked', sqlerrm like '%Loan not found%'); end; end $$;
do $$ begin begin perform public.loan_schedule(current_setting('t.la')::uuid); perform pg_temp.chk('schedule of foreign loan blocked', false); exception when others then perform pg_temp.chk('schedule of foreign loan blocked', sqlerrm like '%Not authorized%'); end; end $$;
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',false); set role authenticated;
select pg_temp.chk('officer B metrics show zero active', ((public.portfolio_metrics('MWK')->>'active_count')::int = 0));
select pg_temp.chk('officer B overdue list empty', (select count(*)=0 from public.overdue_loans('MWK')));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c1',false); set role authenticated;
select pg_temp.chk('officer A metrics see their loan', ((public.portfolio_metrics('MWK')->>'active_count')::int = 1));
select pg_temp.chk('officer A overdue list sees their loan', (select count(*)=1 from public.overdue_loans('MWK')));
select (public.repayment_preview(:'loan_a',1)->>'due_now')::bigint as due_now \gset
select public.post_repayment(:'loan_a', :due_now, current_date, 'k1') is not null as posted;
select pg_temp.chk('officer A sees own repayment', (select count(*)=1 from public.repayments));
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c2',false); set role authenticated;
select pg_temp.chk('officer B cannot see branch A repayments', (select count(*)=0 from public.repayments));
do $$ begin begin perform public.post_repayment(current_setting('t.la')::uuid,1,current_date,'z2'); perform pg_temp.chk('officer B cannot post to branch A loan', false); exception when others then perform pg_temp.chk('officer B cannot post to branch A loan', sqlerrm like '%Loan not found%'); end; end $$;
do $$ begin begin perform public.approve_loan(current_setting('t.la')::uuid); perform pg_temp.chk('officer B cannot approve branch A loan', false); exception when others then perform pg_temp.chk('officer B cannot approve branch A loan', sqlerrm like '%Loan not found%' or sqlerrm like '%Not authorized%'); end; end $$;
select pg_temp.chk('officer B cannot read branch A audit entries', (select count(*)=0 from public.audit_logs where entity_type='loan'));
select pg_temp.chk('officer B cannot read branch row of A', (select count(*)=1 and bool_and(code='BT') from public.branches));

-- unassigned (self signup) borrower
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000c3',false); set role authenticated;
select pg_temp.chk('self-signup borrower is unassigned', (select branch_id is null from public.borrowers where user_id='00000000-0000-0000-0000-0000000000b9'));
do $$ begin begin perform public.create_loan((select id from public.borrowers where user_id='00000000-0000-0000-0000-0000000000b9'),1000000,'fixed',1000,'Monthly','MWK',current_date+90); perform pg_temp.chk('loan for unassigned borrower blocked', false); exception when others then perform pg_temp.chk('loan for unassigned borrower blocked', sqlerrm like '%Assign this borrower%'); end; end $$;
select public.assign_borrower_branch((select id from public.borrowers where user_id='00000000-0000-0000-0000-0000000000b9'), :'ba'::uuid);
select pg_temp.chk('manager claims unassigned borrower', (select branch_id=:'ba'::uuid from public.borrowers where user_id='00000000-0000-0000-0000-0000000000b9'));
do $$ begin begin perform public.assign_borrower_branch((select id from public.borrowers where full_name='Bob B'), (select id from public.branches where code='LLW')); perform pg_temp.chk('manager cannot steal borrower', false); exception when others then perform pg_temp.chk('manager cannot steal borrower', true); end; end $$;
do $$ begin begin perform public.create_branch('Hack','HK'); perform pg_temp.chk('manager cannot create branch', false); exception when others then perform pg_temp.chk('manager cannot create branch', sqlerrm like '%administrators%'); end; end $$;

-- borrower portal unaffected
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000b9',false); set role authenticated;
select pg_temp.chk('borrower still sees own borrower row', (select count(*)=1 from public.borrowers));
select pg_temp.chk('borrower sees no branches', (select count(*)=0 from public.branches));

-- admin: sees all, close rules, transfer moves loans
reset role; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',false); set role authenticated;
select pg_temp.chk('admin sees all loans', (select count(*)=1 from public.loans));
select pg_temp.chk('admin sees both branches', (select count(*)=3 from public.branches));
do $$ begin begin perform public.set_branch_status((select id from public.branches where code='LLW'),'Closed'); perform pg_temp.chk('branch with open loans cannot close', false); exception when others then perform pg_temp.chk('branch with open loans cannot close', sqlerrm like '%open loan%'); end; end $$;
do $$ begin begin perform public.assign_borrower_branch((select id from public.borrowers where full_name='Alice A'), (select id from public.branches where code='BT')); perform pg_temp.chk('transfer without a reason refused', false); exception when others then perform pg_temp.chk('transfer without a reason refused', sqlerrm like '%reason%'); end; end $$;
select public.assign_borrower_branch((select id from public.borrowers where full_name='Alice A'), (select id from public.branches where code='BT'), 'Customer moved city');
select pg_temp.chk('transfer audit records reason, names and loans moved', (select details->>'reason'='Customer moved city' and details->>'to_name'=(select name from public.branches where code='BT') and (details->>'loans_moved')::int=1 from public.audit_logs where action='ASSIGN_BRANCH' and entity_type='borrower' order by created_at desc limit 1));
do $$ begin begin perform public.assign_borrower_branch((select id from public.borrowers where full_name='Alice A'), (select id from public.branches where code='BT'), 'again'); perform pg_temp.chk('transfer to the same branch refused', false); exception when others then perform pg_temp.chk('transfer to the same branch refused', sqlerrm like '%already%'); end; end $$;
select pg_temp.chk('admin transfer moves borrower and loans', (select count(*)=1 from public.loans where branch_id=(select id from public.branches where code='BT')));
select public.set_branch_status((select id from public.branches where code='HO'),'Closed');
do $$ begin begin insert into public.borrowers(full_name,branch_id) values('Late',(select id from public.branches where code='HO')); perform pg_temp.chk('closed branch rejects new borrower', false); exception when others then perform pg_temp.chk('closed branch rejects new borrower', sqlerrm like '%closed%'); end; end $$;
select pg_temp.chk('admin sees branch audit rows', (select count(*)>=3 from public.audit_logs where entity_type='branch'));

reset role;
select 'RESULT: ' || count(*) filter(where ok) || ' passed, ' || count(*) filter(where not ok) || ' failed' from t_res;
