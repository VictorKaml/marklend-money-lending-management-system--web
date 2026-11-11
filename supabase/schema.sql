-- =====================================================================
-- MarkLend 1.5 -- consolidated Supabase schema (fresh install OR re-run)
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Includes everything through 1.4 (capital, approvals, staff permissions,
-- borrower self-signup, audit logs) plus 1.5 profile avatars.
-- Existing databases: running this file also upgrades them (views are
-- dropped/recreated, columns added with IF NOT EXISTS).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname='loan_status' and typnamespace='public'::regnamespace) then
    create type public.loan_status as enum
      ('Pending Approval','Active','Defaulted','Restructured','Completed','Written-Off','Rejected','Voided');
  end if;
  if not exists (select 1 from pg_type where typname='risk_level' and typnamespace='public'::regnamespace) then
    create type public.risk_level as enum ('Low','Medium','High');
  end if;
  if not exists (select 1 from pg_type where typname='kyc_status' and typnamespace='public'::regnamespace) then
    create type public.kyc_status as enum ('Pending','Verified','Rejected');
  end if;
end $$;

-- Upgrade path for databases created before 'Rejected' existed.
alter type public.loan_status add value if not exists 'Rejected';
alter type public.loan_status add value if not exists 'Voided';   -- 1.10: a disbursed loan cancelled by mistake (never used in view/index definitions, only compared as text)

-- ---------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles(
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar text,
  role text not null default 'Loan Officer' check(role in ('Admin','Branch Manager','Loan Officer','Borrower')),
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists avatar text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='profiles_avatar_format') then
    alter table public.profiles add constraint profiles_avatar_format
      check (avatar is null or avatar ~ '^[a-z0-9_-]{1,32}$');
  end if;
end $$;

create table if not exists public.borrowers(
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  full_name text not null,
  phone text,
  email text,
  risk_level public.risk_level not null default 'Low',
  kyc_status public.kyc_status not null default 'Pending',
  borrower_type text not null default 'Individual',
  business_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.borrowers add column if not exists borrower_type text not null default 'Individual';
alter table public.borrowers add column if not exists business_name text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='borrowers_borrower_type_check') then
    alter table public.borrowers add constraint borrowers_borrower_type_check
      check (borrower_type in ('Individual','Business'));
  end if;
end $$;

create table if not exists public.loans(
  id uuid primary key default gen_random_uuid(),
  loan_number text unique not null,
  borrower_id uuid not null references public.borrowers(id),
  principal_minor bigint not null check(principal_minor > 0),
  currency char(3) not null default 'MWK',
  interest_type text not null check(interest_type in ('fixed','declining')),
  interest_rate_bps integer not null default 0 check(interest_rate_bps >= 0),
  frequency text not null check(frequency in ('Daily','Weekly','Monthly','Lumpsum')),
  disbursement_date date,
  maturity_date date,
  status public.loan_status not null default 'Pending Approval',
  rejection_reason text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.loans add column if not exists rejection_reason text;
alter table public.loans add column if not exists start_date date;
alter table public.loans add column if not exists voided_at timestamptz;
alter table public.loans add column if not exists voided_by uuid;
alter table public.loans add column if not exists void_reason text;
-- 1.14.2: optional collateral recorded at loan creation.
alter table public.loans add column if not exists collateral_type text;
alter table public.loans add column if not exists collateral_description text;
alter table public.loans add column if not exists collateral_value_minor bigint;
alter table public.loans add column if not exists collateral_reference text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='loans_collateral_value_nonnegative' and conrelid='public.loans'::regclass) then
    alter table public.loans add constraint loans_collateral_value_nonnegative
      check(collateral_value_minor is null or collateral_value_minor >= 0);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3a. Branches (1.8). Staff belong to one branch and see only that branch's borrowers,
--     loans, instalments, repayments and ledger entries. Admins see every branch.
--     Borrowers with no branch (public self-signups) are "unassigned" until claimed.
-- ---------------------------------------------------------------------
create table if not exists public.branches(
  id uuid primary key default gen_random_uuid(),
  name text not null check(length(trim(name)) between 2 and 80),
  code text not null check(code ~ '^[A-Za-z0-9]{2,10}$'),
  address text,
  phone text,
  manager_id uuid references public.profiles(id) on delete set null,
  status text not null default 'Active' check(status in ('Active','Closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create unique index if not exists uq_branches_name on public.branches(lower(name));
create unique index if not exists uq_branches_code on public.branches(upper(code));

alter table public.profiles  add column if not exists branch_id uuid references public.branches(id);
alter table public.borrowers add column if not exists branch_id uuid references public.branches(id);
alter table public.loans     add column if not exists branch_id uuid references public.branches(id);
-- 1.8.1: KYC details, who verified, and who created each loan (maker-checker).
alter table public.borrowers add column if not exists id_type text;
alter table public.borrowers add column if not exists id_number text;
alter table public.borrowers add column if not exists address text;
alter table public.borrowers add column if not exists next_of_kin_name text;
alter table public.borrowers add column if not exists next_of_kin_phone text;
alter table public.borrowers add column if not exists kyc_reason text;
alter table public.borrowers add column if not exists kyc_verified_by uuid references auth.users(id);
alter table public.borrowers add column if not exists kyc_verified_at timestamptz;
alter table public.loans     add column if not exists created_by uuid references auth.users(id);
do $$ begin
  if not exists(select 1 from pg_constraint where conname='borrowers_id_type_check') then
    alter table public.borrowers add constraint borrowers_id_type_check
      check(id_type is null or id_type in ('National ID','Passport','Driving licence','Other'));
  end if;
end $$;
create index if not exists idx_profiles_branch  on public.profiles(branch_id);
create index if not exists idx_borrowers_branch on public.borrowers(branch_id);
create index if not exists idx_loans_branch     on public.loans(branch_id);

do $$
declare v_ho uuid;
begin
  -- allow the new role on existing databases
  if exists(select 1 from pg_constraint where conname='profiles_role_check' and conrelid='public.profiles'::regclass) then
    alter table public.profiles drop constraint profiles_role_check;
  end if;
  alter table public.profiles add constraint profiles_role_check
    check(role in ('Admin','Branch Manager','Loan Officer','Borrower'));

  -- First migration only: everything that exists today belongs to "Head Office".
  -- (Later re-runs must not re-assign borrowers that were deliberately left unassigned.)
  if not exists(select 1 from public.branches) then
    insert into public.branches(name, code) values('Head Office','HO') returning id into v_ho;
    update public.profiles  set branch_id = v_ho where branch_id is null and role in ('Loan Officer','Branch Manager');
    update public.borrowers set branch_id = v_ho where branch_id is null;
    update public.loans l   set branch_id = coalesce((select b.branch_id from public.borrowers b where b.id = l.borrower_id), v_ho)
     where l.branch_id is null;
  end if;
end $$;

create table if not exists public.loan_schedules(
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  installment_no integer not null,
  due_date date not null,
  principal_due_minor bigint not null default 0,
  interest_due_minor bigint not null default 0,
  fee_due_minor bigint not null default 0,
  penalty_due_minor bigint not null default 0,
  principal_paid_minor bigint not null default 0,
  interest_paid_minor bigint not null default 0,
  fee_paid_minor bigint not null default 0,
  penalty_paid_minor bigint not null default 0,
  unique(loan_id, installment_no)
);

create table if not exists public.penalty_rules(
  id uuid primary key default gen_random_uuid(),
  name text not null,
  grace_days integer not null default 0,
  flat_rate_bps integer not null default 0,
  daily_rate_bps integer not null default 0,
  cap_principal_bps integer,
  active boolean not null default true
);

create table if not exists public.ledger_entries(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  entry_type text not null,
  reference text,
  loan_id uuid references public.loans(id),
  borrower_id uuid references public.borrowers(id),
  debit_account text not null,
  credit_account text not null,
  amount_minor bigint not null check(amount_minor > 0),
  currency char(3) not null default 'MWK',
  idempotency_key text unique,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.repayments(
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id),
  payment_date date not null default current_date,
  amount_minor bigint not null check(amount_minor > 0),
  fee_component_minor bigint not null default 0,
  penalty_component_minor bigint not null default 0,
  interest_component_minor bigint not null default 0,
  principal_component_minor bigint not null default 0,
  currency char(3) not null default 'MWK',
  idempotency_key text unique not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- Which instalment each payment settled, so a payment can be voided exactly (1.10).
create table if not exists public.repayment_allocations(
  repayment_id uuid not null references public.repayments(id) on delete cascade,
  schedule_id uuid not null references public.loan_schedules(id) on delete cascade,
  fee_minor bigint not null default 0, penalty_minor bigint not null default 0,
  interest_minor bigint not null default 0, principal_minor bigint not null default 0,
  primary key(repayment_id, schedule_id)
);
-- Voided payments are moved here, so every total that reads public.repayments excludes them automatically.
create table if not exists public.repayments_voided(
  id uuid primary key,
  loan_id uuid not null references public.loans(id),
  payment_date date not null,
  amount_minor bigint not null,
  fee_component_minor bigint not null default 0, penalty_component_minor bigint not null default 0,
  interest_component_minor bigint not null default 0, principal_component_minor bigint not null default 0,
  currency char(3) not null,
  idempotency_key text not null,
  created_by uuid, created_at timestamptz not null,
  voided_at timestamptz not null default now(), voided_by uuid, void_reason text not null
);

create table if not exists public.audit_logs(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb
);

create table if not exists public.capital_transactions(
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  transaction_type text not null
    check(transaction_type in ('FUNDING','DISBURSEMENT','REPAYMENT','WITHDRAWAL','ADJUSTMENT_IN','ADJUSTMENT_OUT')),
  amount_minor bigint not null check(amount_minor > 0),
  currency char(3) not null default 'MWK',
  reference text not null unique,
  source text,
  loan_id uuid references public.loans(id),
  created_by uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.staff_permissions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  section text not null,
  can_view boolean not null default true,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_approve boolean not null default false,
  created_at timestamptz not null default now(),
  unique(user_id, section)
);

-- ---------------------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------------------
create index if not exists idx_borrowers_type               on public.borrowers(borrower_type);
create index if not exists idx_borrowers_user_id            on public.borrowers(user_id);
create index if not exists idx_loans_borrower_id            on public.loans(borrower_id);
create index if not exists idx_loans_status                 on public.loans(status);
create index if not exists idx_schedule_loan_due            on public.loan_schedules(loan_id, due_date);
create index if not exists idx_repayments_loan_date         on public.repayments(loan_id, payment_date);
create index if not exists idx_ledger_loan_created          on public.ledger_entries(loan_id, created_at);
create index if not exists idx_audit_entity                 on public.audit_logs(entity_type, entity_id);
create index if not exists idx_audit_created                on public.audit_logs(created_at desc);
create index if not exists idx_audit_actor_action           on public.audit_logs(actor_id, action, created_at desc);
create index if not exists idx_capital_transactions_created on public.capital_transactions(created_at);
create index if not exists idx_capital_transactions_type    on public.capital_transactions(transaction_type);
create index if not exists idx_capital_currency_created     on public.capital_transactions(currency, created_at);
create index if not exists idx_staff_permissions_user       on public.staff_permissions(user_id);

-- ---------------------------------------------------------------------
-- 4. Role helper
-- ---------------------------------------------------------------------
create or replace function public.current_role()
returns text
language sql stable security definer set search_path=public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'Borrower')
$$;

-- 1.8: branch helpers. Admin sees every branch; everyone else only their own.
create or replace function public.my_branch()
returns uuid
language sql stable security definer set search_path=public
as $$ select branch_id from public.profiles where id = auth.uid() $$;

create or replace function public.can_see_branch(p_branch uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select public.current_role() = 'Admin'
      or (p_branch is not null and p_branch = (select branch_id from public.profiles where id = auth.uid()))
$$;

-- Is this audit actor a colleague in my branch? (used by the audit policy; avoids profiles RLS recursion)
create or replace function public.actor_in_my_branch(p_actor uuid)
returns boolean
language sql stable security definer set search_path=public
as $$
  select p_actor is not null and exists(select 1 from public.profiles a
         where a.id = p_actor and a.branch_id is not null
           and a.branch_id = (select branch_id from public.profiles where id = auth.uid()))
$$;

-- ---------------------------------------------------------------------
-- 5. Permission helper (must exist before the policies that use it)
-- ---------------------------------------------------------------------
create or replace function public.has_permission(p_section text, p_action text default 'view')
returns boolean
language sql stable security definer set search_path=public
as $$
  select public.current_role() = 'Admin'
  or exists(
    select 1 from public.staff_permissions sp
    where sp.user_id = auth.uid() and sp.section = p_section
      and case p_action
            when 'view'    then sp.can_view
            when 'create'  then sp.can_create
            when 'edit'    then sp.can_edit
            when 'approve' then sp.can_approve
            else false end
  )
$$;

-- ---------------------------------------------------------------------
-- 6. Loan functions
-- ---------------------------------------------------------------------
drop function if exists public.create_loan(uuid,bigint,text,integer,text,char(3),date);
drop function if exists public.create_loan(uuid,bigint,text,integer,text,char(3),date,date);
drop function if exists public.create_loan(uuid,bigint,text,integer,text,char(3),date,date,text,text,bigint,text);
create or replace function public.create_loan(
  p_borrower_id uuid,
  p_principal_minor bigint,
  p_interest_type text,
  p_interest_rate_bps integer,
  p_frequency text,
  p_currency char(3),
  p_maturity_date date,
  p_start_date date default null,
  p_collateral_type text default null,
  p_collateral_description text default null,
  p_collateral_value_minor bigint default null,
  p_collateral_reference text default null
)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_id uuid;
  v_no text;
  v_start date;
  v_periods integer;
  v_i integer;
  v_due date;
  v_principal bigint;
  v_interest bigint;
  v_base bigint;
  v_total_interest bigint;
  v_branch uuid;
begin
  if not public.has_permission('loans','create') then raise exception 'Not authorized to create loans'; end if;
  v_start := coalesce(p_start_date, current_date);
  if p_principal_minor <= 0 then raise exception 'Principal must be positive'; end if;
  if p_interest_rate_bps < 0 then raise exception 'Interest rate cannot be negative'; end if;
  if p_interest_type not in ('fixed','declining') then raise exception 'Invalid interest type'; end if;
  if p_frequency not in ('Daily','Weekly','Monthly','Lumpsum') then raise exception 'Invalid repayment frequency'; end if;
  if p_maturity_date is null or p_maturity_date <= v_start then raise exception 'End date must be after the start date'; end if;
  select branch_id into v_branch from public.borrowers where id = p_borrower_id;
  if not found then raise exception 'Borrower not found'; end if;
  if v_branch is null then raise exception 'Assign this borrower to a branch before creating a loan'; end if;
  if not public.can_see_branch(v_branch) then raise exception 'Borrower not found'; end if;
  if (select status from public.branches where id = v_branch) <> 'Active' then raise exception 'This branch is closed'; end if;
  if (select kyc_status from public.borrowers where id = p_borrower_id) <> 'Verified' then
    raise exception 'KYC must be Verified before a loan can be created for this borrower';
  end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  if p_collateral_value_minor is not null and p_collateral_value_minor < 0 then raise exception 'Collateral value cannot be negative'; end if;
  if (nullif(btrim(coalesce(p_collateral_type,'')),'') is not null
      or p_collateral_value_minor is not null
      or nullif(btrim(coalesce(p_collateral_reference,'')),'') is not null)
     and nullif(btrim(coalesce(p_collateral_description,'')),'') is null then
    raise exception 'A collateral description is required when collateral details are provided';
  end if;

  v_no := 'ML-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS') || '-'
          || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  v_periods := case
    when p_frequency = 'Daily'   then greatest(1, p_maturity_date - v_start)
    when p_frequency = 'Weekly'  then greatest(1, ceil((p_maturity_date - v_start)::numeric / 7))::integer
    when p_frequency = 'Monthly' then greatest(1, (extract(year from age(p_maturity_date, v_start)) * 12
                                                   + extract(month from age(p_maturity_date, v_start)))::integer)
    else 1
  end;
  v_base := floor(p_principal_minor::numeric / v_periods)::bigint;
  v_total_interest := round(p_principal_minor::numeric * p_interest_rate_bps / 10000);

  insert into public.loans(loan_number, borrower_id, principal_minor, currency, interest_type,
                           interest_rate_bps, frequency, start_date, maturity_date, status, branch_id, created_by,
                           collateral_type, collateral_description, collateral_value_minor, collateral_reference)
  values(v_no, p_borrower_id, p_principal_minor, p_currency, p_interest_type,
         p_interest_rate_bps, p_frequency, v_start, p_maturity_date, 'Pending Approval', v_branch, auth.uid(),
         nullif(btrim(p_collateral_type),''), nullif(btrim(p_collateral_description),''), p_collateral_value_minor,
         nullif(btrim(p_collateral_reference),''))
  returning id into v_id;

  for v_i in 1..v_periods loop
    v_principal := case when v_i = v_periods then p_principal_minor - v_base * (v_periods - 1) else v_base end;
    v_interest := case
      when p_interest_type = 'declining'
        then round(((p_principal_minor - v_base * (v_i - 1))::numeric * p_interest_rate_bps) / 10000)
      when v_i = v_periods
        then v_total_interest - round(v_total_interest::numeric / v_periods) * (v_periods - 1)
      else round(v_total_interest::numeric / v_periods)
    end;
    v_due := case
      when p_frequency = 'Daily'   then v_start + v_i
      when p_frequency = 'Weekly'  then v_start + (7 * v_i)
      when p_frequency = 'Monthly' then (v_start + make_interval(months => v_i))::date
      else p_maturity_date
    end;
    if v_due > p_maturity_date then v_due := p_maturity_date; end if;

    insert into public.loan_schedules(loan_id, installment_no, due_date, principal_due_minor, interest_due_minor)
    values(v_id, v_i, v_due, v_principal, v_interest);
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'CREATE', 'loan', v_id,
         jsonb_build_object('loan_number', v_no, 'principal_minor', p_principal_minor, 'status', 'Pending Approval', 'branch_id', v_branch));
  return v_id;
end $$;

-- Atomic approval + disbursement with per-currency capital check.
-- An advisory lock per currency stops two simultaneous approvals from
-- both passing the balance check.
create or replace function public.approve_loan(p_loan_id uuid)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_principal bigint; v_currency char(3); v_status public.loan_status;
  v_available bigint; v_ref text; v_borrower uuid; v_number text; v_branch uuid; v_maker uuid; v_self boolean := false;
  v_cap bigint; v_used bigint;
begin
  if not public.has_permission('loans','approve') then raise exception 'Not authorized to approve loans'; end if;

  select principal_minor, currency, status, borrower_id, loan_number, branch_id, created_by
    into v_principal, v_currency, v_status, v_borrower, v_number, v_branch, v_maker
  from public.loans where id = p_loan_id for update;
  if not found or not public.can_see_branch(v_branch) then raise exception 'Loan not found'; end if;
  if v_status <> 'Pending Approval' then raise exception 'Only pending loans can be approved'; end if;
  -- maker-checker: the person who created a loan cannot approve it. Administrators are the one
  -- exception (a one-person company must still be able to operate); it is recorded in the audit log.
  if v_maker is not null and v_maker = auth.uid() then
    if public.current_role() <> 'Admin' then
      raise exception 'You created this loan, so another person must approve it';
    end if;
    v_self := true;
  end if;

  perform pg_advisory_xact_lock(hashtext('capital-' || v_currency));

  select coalesce(sum(case when transaction_type in ('FUNDING','REPAYMENT','ADJUSTMENT_IN')
                           then amount_minor else -amount_minor end), 0)
    into v_available from public.capital_transactions where currency = v_currency;
  if v_available < v_principal then
    raise exception 'Insufficient available lending capital for %', v_currency;
  end if;

  -- 1.10: a branch with an allocated capital limit cannot lend beyond it.
  select allocated_minor into v_cap from public.branch_capital where branch_id = v_branch and currency = v_currency;
  if found then
    select coalesce(sum(outstanding_principal),0) into v_used from public.loan_summary
     where branch_id = v_branch and currency = v_currency and status in ('Active','Defaulted','Restructured');
    if v_cap - v_used < v_principal then
      raise exception 'Branch capital limit reached: % % available of % allocated', v_currency, ((v_cap - v_used)/100.0)::numeric(18,2), (v_cap/100.0)::numeric(18,2);
    end if;
  end if;

  v_ref := 'DISB-' || p_loan_id::text;
  insert into public.capital_transactions(transaction_type, amount_minor, currency, reference, source, loan_id, created_by)
  values('DISBURSEMENT', v_principal, v_currency, v_ref, 'Loan disbursement', p_loan_id, auth.uid());

  update public.loans
     set status = 'Active', approved_at = now(), disbursement_date = current_date,
         updated_at = now(), rejection_reason = null
   where id = p_loan_id;

  insert into public.ledger_entries(entry_type, reference, loan_id, borrower_id, debit_account, credit_account,
                                    amount_minor, currency, idempotency_key, metadata)
  values('DISBURSEMENT', v_ref, p_loan_id, v_borrower, 'LOAN_RECEIVABLE', 'CASH',
         v_principal, v_currency, 'ledger-' || v_ref, jsonb_build_object('loan_number', v_number));

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'APPROVE', 'loan', p_loan_id,
         jsonb_build_object('loan_number', v_number, 'principal_minor', v_principal, 'currency', v_currency,
                            'branch_id', v_branch, 'created_by', v_maker, 'self_approved', v_self));
  return p_loan_id;
end $$;

create or replace function public.reject_loan(p_loan_id uuid, p_reason text)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_status public.loan_status; v_number text; v_branch uuid;
begin
  if not public.has_permission('loans','approve') then raise exception 'Not authorized to reject loans'; end if;
  if nullif(trim(p_reason),'') is null then raise exception 'A rejection reason is required'; end if;

  select status, loan_number, branch_id into v_status, v_number, v_branch from public.loans where id = p_loan_id for update;
  if not found or not public.can_see_branch(v_branch) then raise exception 'Loan not found'; end if;
  if v_status <> 'Pending Approval' then raise exception 'Only pending loans can be rejected'; end if;

  update public.loans set status = 'Rejected', rejection_reason = trim(p_reason), updated_at = now()
   where id = p_loan_id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'REJECT', 'loan', p_loan_id,
         jsonb_build_object('loan_number', v_number, 'reason', trim(p_reason), 'branch_id', v_branch));
  return p_loan_id;
end $$;

-- ---------------------------------------------------------------------
-- 7. Capital functions
-- ---------------------------------------------------------------------
create or replace function public.add_capital(p_amount_minor bigint, p_currency char(3), p_source text, p_reference text)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
  if not public.has_permission('capital','create') then raise exception 'Not authorized to add lending capital'; end if;
  if p_amount_minor <= 0 then raise exception 'Capital amount must be positive'; end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  if nullif(trim(p_source),'') is null or nullif(trim(p_reference),'') is null then
    raise exception 'Source and reference are required';
  end if;

  insert into public.capital_transactions(transaction_type, amount_minor, currency, reference, source, created_by)
  values('FUNDING', p_amount_minor, p_currency, p_reference, p_source, auth.uid())
  returning id into v_id;

  insert into public.ledger_entries(entry_type, reference, debit_account, credit_account, amount_minor, currency, idempotency_key, metadata)
  values('CAPITAL_FUNDING', p_reference, 'CASH', 'OWNER_CAPITAL', p_amount_minor, p_currency,
         'capital-' || p_reference, jsonb_build_object('source', p_source));

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'CAPITAL_FUNDING', 'capital', v_id,
         jsonb_build_object('amount_minor', p_amount_minor, 'currency', p_currency, 'reference', p_reference));
  return v_id;
end $$;

create or replace function public.withdraw_capital(p_amount_minor bigint, p_currency char(3), p_source text, p_reference text)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_id uuid; v_available bigint;
begin
  if not public.has_permission('capital','create') then raise exception 'Not authorized to withdraw lending capital'; end if;
  if p_amount_minor <= 0 then raise exception 'Withdrawal amount must be positive'; end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  if nullif(trim(p_source),'') is null or nullif(trim(p_reference),'') is null then
    raise exception 'Reason and reference are required';
  end if;

  perform pg_advisory_xact_lock(hashtext('capital-' || p_currency));

  select coalesce(sum(case when transaction_type in ('FUNDING','REPAYMENT','ADJUSTMENT_IN')
                           then amount_minor else -amount_minor end), 0)
    into v_available from public.capital_transactions where currency = p_currency;
  if p_amount_minor > v_available then raise exception 'Withdrawal exceeds available % capital', p_currency; end if;

  insert into public.capital_transactions(transaction_type, amount_minor, currency, reference, source, created_by)
  values('WITHDRAWAL', p_amount_minor, p_currency, p_reference, p_source, auth.uid())
  returning id into v_id;

  insert into public.ledger_entries(entry_type, reference, debit_account, credit_account, amount_minor, currency, idempotency_key, metadata)
  values('CAPITAL_WITHDRAWAL', p_reference, 'OWNER_DRAW', 'CASH', p_amount_minor, p_currency,
         'capital-' || p_reference, jsonb_build_object('reason', p_source));

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'CAPITAL_WITHDRAWAL', 'capital', v_id,
         jsonb_build_object('amount_minor', p_amount_minor, 'currency', p_currency, 'reference', p_reference));
  return v_id;
end $$;

create or replace function public.available_capital(p_currency char(3))
returns bigint
language plpgsql stable security definer set search_path=public
as $$
begin
  if not (public.has_permission('loans','approve') or public.has_permission('capital','view')) then
    raise exception 'Not authorized';
  end if;
  return coalesce((select sum(case when transaction_type in ('FUNDING','REPAYMENT','ADJUSTMENT_IN')
                                   then amount_minor else -amount_minor end)
                   from public.capital_transactions where currency = p_currency), 0);
end $$;

-- ---------------------------------------------------------------------
-- 8. Repayments: section permission, borrower on ledger, principal
--    returns to the capital pool. Waterfall: fee > penalty > interest > principal.
-- ---------------------------------------------------------------------
create or replace function public.post_repayment(
  p_loan_id uuid, p_amount_minor bigint, p_payment_date date, p_idempotency_key text
)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare
  v_id uuid; v_rem bigint := p_amount_minor;
  v_fee bigint := 0; v_pen bigint := 0; v_int bigint := 0; v_prin bigint := 0;
  v_apply bigint; r record;
  v_currency char(3); v_borrower uuid; v_status public.loan_status; v_branch uuid;
  v_alloc jsonb := '[]'::jsonb; a_fee bigint; a_pen bigint; a_int bigint; a_prin bigint;
begin
  if not public.has_permission('repayments','create') then raise exception 'Not authorized'; end if;
  if p_amount_minor <= 0 then raise exception 'Payment must be positive'; end if;
  if nullif(trim(p_idempotency_key),'') is null then raise exception 'Idempotency key is required'; end if;

  select id into v_id from public.repayments where idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;

  select currency, borrower_id, status, branch_id into v_currency, v_borrower, v_status, v_branch
  from public.loans where id = p_loan_id for update;
  if not found or not public.can_see_branch(v_branch) then raise exception 'Loan not found'; end if;
  if v_status not in ('Active','Defaulted','Restructured') then
    raise exception 'Repayments can only be posted to active loans (status: %)', v_status;
  end if;

  for r in select * from public.loan_schedules where loan_id = p_loan_id
           order by due_date, installment_no for update
  loop
    exit when v_rem = 0;
    a_fee := 0; a_pen := 0; a_int := 0; a_prin := 0;

    v_apply := least(v_rem, r.fee_due_minor - r.fee_paid_minor);
    if v_apply > 0 then
      v_fee := v_fee + v_apply; a_fee := v_apply; v_rem := v_rem - v_apply;
      update public.loan_schedules set fee_paid_minor = fee_paid_minor + v_apply where id = r.id;
    end if;

    v_apply := least(v_rem, r.penalty_due_minor - r.penalty_paid_minor);
    if v_apply > 0 then
      v_pen := v_pen + v_apply; a_pen := v_apply; v_rem := v_rem - v_apply;
      update public.loan_schedules set penalty_paid_minor = penalty_paid_minor + v_apply where id = r.id;
    end if;

    v_apply := least(v_rem, r.interest_due_minor - r.interest_paid_minor);
    if v_apply > 0 then
      v_int := v_int + v_apply; a_int := v_apply; v_rem := v_rem - v_apply;
      update public.loan_schedules set interest_paid_minor = interest_paid_minor + v_apply where id = r.id;
    end if;

    v_apply := least(v_rem, r.principal_due_minor - r.principal_paid_minor);
    if v_apply > 0 then
      v_prin := v_prin + v_apply; a_prin := v_apply; v_rem := v_rem - v_apply;
      update public.loan_schedules set principal_paid_minor = principal_paid_minor + v_apply where id = r.id;
    end if;

    if a_fee + a_pen + a_int + a_prin > 0 then
      v_alloc := v_alloc || jsonb_build_object('s', r.id, 'f', a_fee, 'p', a_pen, 'i', a_int, 'r', a_prin);
    end if;
  end loop;

  if v_rem > 0 then
    raise exception 'Payment exceeds the total amount due by % minor units', v_rem;
  end if;

  insert into public.repayments(loan_id, payment_date, amount_minor, fee_component_minor, penalty_component_minor,
                                interest_component_minor, principal_component_minor, currency, idempotency_key, created_by)
  values(p_loan_id, p_payment_date, p_amount_minor, v_fee, v_pen, v_int, v_prin, v_currency, p_idempotency_key, auth.uid())
  returning id into v_id;

  insert into public.repayment_allocations(repayment_id, schedule_id, fee_minor, penalty_minor, interest_minor, principal_minor)
  select v_id, (e->>'s')::uuid, (e->>'f')::bigint, (e->>'p')::bigint, (e->>'i')::bigint, (e->>'r')::bigint from jsonb_array_elements(v_alloc) e;

  if v_prin > 0 then
    insert into public.capital_transactions(transaction_type, amount_minor, currency, reference, source, loan_id, created_by)
    values('REPAYMENT', v_prin, v_currency, 'REPAY-' || p_idempotency_key, 'Principal repayment', p_loan_id, auth.uid());
  end if;

  insert into public.ledger_entries(entry_type, reference, loan_id, borrower_id, debit_account, credit_account,
                                    amount_minor, currency, idempotency_key, metadata)
  values('REPAYMENT', p_idempotency_key, p_loan_id, v_borrower, 'CASH', 'LOAN_RECEIVABLE',
         p_amount_minor, v_currency, 'ledger-' || p_idempotency_key,
         jsonb_build_object('fee', v_fee, 'penalty', v_pen, 'interest', v_int, 'principal', v_prin));

  if not exists(select 1 from public.loan_schedules where loan_id = p_loan_id
                and (principal_due_minor > principal_paid_minor or interest_due_minor > interest_paid_minor
                     or fee_due_minor > fee_paid_minor or penalty_due_minor > penalty_paid_minor)) then
    update public.loans set status = 'Completed', updated_at = now()
     where id = p_loan_id and status <> 'Written-Off';
  end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'POST_REPAYMENT', 'loan', p_loan_id,
         jsonb_build_object('amount_minor', p_amount_minor, 'fee', v_fee, 'penalty', v_pen,
                            'interest', v_int, 'principal', v_prin, 'idempotency_key', p_idempotency_key));
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 9. Staff access
-- ---------------------------------------------------------------------
drop function if exists public.provision_staff_profile(uuid,text,text,text[]);   -- old 4-arg version
drop function if exists public.provision_staff_profile(uuid,text,text,text,text[]); -- 1.7 5-arg version

create or replace function public.provision_staff_profile(
  p_user_id uuid, p_full_name text, p_email text, p_role text, p_sections text[], p_branch_id uuid default null
)
returns boolean
language plpgsql security definer set search_path=public
as $$
begin
  if public.current_role() <> 'Admin' then raise exception 'Only administrators can create staff access'; end if;
  if p_role not in ('Admin','Branch Manager','Loan Officer') then raise exception 'Invalid staff role'; end if;

  if p_role <> 'Admin' and p_branch_id is null then raise exception 'Choose a branch for this staff member'; end if;
  if p_branch_id is not null and not exists(select 1 from public.branches where id = p_branch_id and status = 'Active') then
    raise exception 'Branch not found or closed';
  end if;

  insert into public.profiles(id, full_name, email, role, branch_id) values(p_user_id, p_full_name, p_email, p_role, p_branch_id)
  on conflict(id) do update set full_name = excluded.full_name, email = excluded.email, role = excluded.role, branch_id = excluded.branch_id;

  -- The signup trigger auto-creates a borrower record for every new auth user.
  -- Staff are not borrowers, so remove it unless it already has loans.
  delete from public.borrowers b
   where b.user_id = p_user_id
     and not exists(select 1 from public.loans l where l.borrower_id = b.id);

  delete from public.staff_permissions where user_id = p_user_id;
  insert into public.staff_permissions(user_id, section, can_view, can_create, can_edit, can_approve)
  select p_user_id, x, true,
         (x in ('borrowers','loans','repayments','capital')),
         (x = 'borrowers'),
         (x = 'loans')
  from unnest(coalesce(p_sections,'{}'::text[])) x;
  return true;
end $$;

create or replace function public.update_staff_permissions(p_user_id uuid, p_sections text[])
returns boolean
language plpgsql security definer set search_path=public
as $$
begin
  if public.current_role() <> 'Admin' then raise exception 'Only administrators can edit staff access'; end if;
  if not exists(select 1 from public.profiles where id = p_user_id and role in ('Admin','Branch Manager','Loan Officer')) then
    raise exception 'Staff user not found';
  end if;
  delete from public.staff_permissions where user_id = p_user_id;
  insert into public.staff_permissions(user_id, section, can_view, can_create, can_edit, can_approve)
  select p_user_id, x, true, (x in ('borrowers','loans','repayments','capital')), (x = 'borrowers'), (x = 'loans')
  from unnest(coalesce(p_sections,'{}'::text[])) x;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'UPDATE_ACCESS', 'profile', p_user_id, jsonb_build_object('sections', p_sections));
  return true;
end $$;

create or replace function public.update_staff_permissions_json(p_user_id uuid, p_permissions jsonb)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare v_section text; v_value jsonb;
begin
  if public.current_role() <> 'Admin' then raise exception 'Only administrators can edit staff access'; end if;
  if not exists(select 1 from public.profiles where id = p_user_id and role in ('Admin','Branch Manager','Loan Officer')) then
    raise exception 'Staff user not found';
  end if;
  delete from public.staff_permissions where user_id = p_user_id;
  for v_section, v_value in select key, value from jsonb_each(coalesce(p_permissions,'{}'::jsonb)) loop
    if coalesce((v_value->>'can_view')::boolean,false) or coalesce((v_value->>'can_create')::boolean,false)
       or coalesce((v_value->>'can_edit')::boolean,false) or coalesce((v_value->>'can_approve')::boolean,false) then
      insert into public.staff_permissions(user_id, section, can_view, can_create, can_edit, can_approve)
      values(p_user_id, v_section,
             coalesce((v_value->>'can_view')::boolean,false),
             coalesce((v_value->>'can_create')::boolean,false),
             coalesce((v_value->>'can_edit')::boolean,false),
             coalesce((v_value->>'can_approve')::boolean,false));
    end if;
  end loop;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'UPDATE_PERMISSIONS', 'profile', p_user_id, jsonb_build_object('permissions', p_permissions));
  return true;
end $$;

-- ---------------------------------------------------------------------
-- 10. Portfolio metrics (real PAR30/60/90, restricted to staff)
-- ---------------------------------------------------------------------
-- 1.7: metrics are per currency (default MWK keeps old callers working).
drop function if exists public.portfolio_metrics();
create or replace function public.portfolio_metrics(p_currency char(3) default 'MWK')
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare v_result jsonb;
begin
  if public.current_role() not in ('Admin','Branch Manager','Loan Officer') then
    raise exception 'Not authorized to view portfolio metrics';
  end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;

  with x as (select * from public.loan_summary where currency = p_currency and status::text <> 'Voided' and public.can_see_branch(branch_id)),
  unpaid as (
    select s.loan_id, min(s.due_date) as oldest_due
    from public.loan_schedules s join x on x.id = s.loan_id
    where s.principal_due_minor > s.principal_paid_minor or s.interest_due_minor > s.interest_paid_minor
       or s.fee_due_minor > s.fee_paid_minor or s.penalty_due_minor > s.penalty_paid_minor
    group by s.loan_id
  ),
  t as (
    select coalesce(sum(principal_minor) filter(where disbursement_date is not null),0) lent,
           coalesce(sum(outstanding_principal) filter(where status in ('Active','Defaulted','Restructured')),0) active,
           coalesce(sum(principal_minor) filter(where status = 'Pending Approval'),0) pending_principal,
           count(*) filter(where status = 'Active') active_count,
           count(*) filter(where status = 'Pending Approval') pending_count,
           count(*) filter(where status = 'Defaulted') defaulted_count,
           count(*) filter(where status = 'Completed') completed_count,
           count(*) total
    from x
  ),
  i as (select coalesce(sum(r.interest_component_minor),0) collected from public.repayments r join x on x.id = r.loan_id where r.currency = p_currency),
  e as (select coalesce(sum(s.interest_due_minor),0) expected
        from public.loan_schedules s join x on x.id = s.loan_id),
  c as (
    select coalesce(sum(case when transaction_type in ('FUNDING','REPAYMENT','ADJUSTMENT_IN')
                             then amount_minor else -amount_minor end),0) available,
           coalesce(sum(amount_minor) filter(where transaction_type = 'FUNDING'),0) funded
    from public.capital_transactions where currency = p_currency
  ),
  par as (
    select
      coalesce(sum(x.outstanding_principal) filter(where u.oldest_due <= current_date - 30),0) p30,
      coalesce(sum(x.outstanding_principal) filter(where u.oldest_due <= current_date - 60),0) p60,
      coalesce(sum(x.outstanding_principal) filter(where u.oldest_due <= current_date - 90),0) p90
    from x join unpaid u on u.loan_id = x.id
    where x.status in ('Active','Defaulted','Restructured')
  )
  select jsonb_build_object(
    'currency', p_currency,
    'total_capital_lent', t.lent/100.0, 'active_portfolio', t.active/100.0,
    'pending_principal', t.pending_principal/100.0,
    'available_lending_capital', c.available/100.0, 'total_capital_funded', c.funded/100.0,
    'active_count', t.active_count, 'pending_count', t.pending_count,
    'defaulted_count', t.defaulted_count, 'completed_count', t.completed_count, 'total_loans', t.total,
    'collected_interest', i.collected/100.0, 'expected_interest', e.expected/100.0,
    'default_rate', case when t.total = 0 then 0 else t.defaulted_count*100.0/t.total end,
    'par30', case when t.active = 0 then 0 else par.p30*100.0/t.active end,
    'par60', case when t.active = 0 then 0 else par.p60*100.0/t.active end,
    'par90', case when t.active = 0 then 0 else par.p90*100.0/t.active end
  ) into v_result from t, i, e, c, par;
  return v_result;
end $$;

-- 1.7: month-by-month series for the dashboard chart and trend arrows (minor units).
create or replace function public.portfolio_monthly(p_currency char(3) default 'MWK', p_months integer default 6)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare v jsonb; n integer := least(greatest(coalesce(p_months,6),1),24);
begin
  if public.current_role() not in ('Admin','Branch Manager','Loan Officer') then raise exception 'Not authorized'; end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  select jsonb_agg(jsonb_build_object(
      'month', to_char(m.ms,'YYYY-MM'),
      'requested', (select coalesce(sum(l.principal_minor),0) from public.loans l
                    where l.currency = p_currency and public.can_see_branch(l.branch_id) and l.created_at >= m.ms and l.created_at < m.ms + interval '1 month'),
      'disbursed', (select coalesce(sum(l.principal_minor),0) from public.loans l
                    where l.currency = p_currency and public.can_see_branch(l.branch_id) and l.disbursement_date >= m.ms::date
                      and l.disbursement_date < (m.ms + interval '1 month')::date),
      'repaid',    (select coalesce(sum(r.amount_minor),0) from public.repayments r
                    where r.currency = p_currency and exists(select 1 from public.loans lb where lb.id = r.loan_id and public.can_see_branch(lb.branch_id)) and r.payment_date >= m.ms::date
                      and r.payment_date < (m.ms + interval '1 month')::date),
      'interest',  (select coalesce(sum(r.interest_component_minor),0) from public.repayments r
                    where r.currency = p_currency and exists(select 1 from public.loans lb where lb.id = r.loan_id and public.can_see_branch(lb.branch_id)) and r.payment_date >= m.ms::date
                      and r.payment_date < (m.ms + interval '1 month')::date),
      'capital_net',(select coalesce(sum(case when t.transaction_type in ('FUNDING','REPAYMENT','ADJUSTMENT_IN')
                                              then t.amount_minor else -t.amount_minor end),0)
                     from public.capital_transactions t
                     where t.currency = p_currency and t.created_at >= m.ms and t.created_at < m.ms + interval '1 month')
    ) order by m.ms)
  into v
  from (select date_trunc('month', current_date) - make_interval(months => g) as ms
        from generate_series(n-1, 0, -1) g) m;
  return coalesce(v,'[]'::jsonb);
end $$;

-- 1.8.2: per-branch performance. Money is in minor units of ONE currency (never mixed).
-- Admin sees every branch; a Branch Manager (with Reports access) sees only their own.
-- collection rate = what has been paid against instalments that fell due in the period / what fell due.
-- PAR30 = outstanding principal of loans whose oldest unpaid instalment is 30+ days late / outstanding principal.
create or replace function public.branch_metrics(p_currency char(3) default 'MWK', p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare v jsonb; v_from date := coalesce(p_from, date '1900-01-01'); v_to date := coalesce(p_to, current_date);
begin
  if not (public.current_role() = 'Admin'
          or (public.current_role() = 'Branch Manager' and public.has_permission('reports','view'))) then
    raise exception 'Not authorized to view branch performance';
  end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  if v_from > v_to then raise exception 'The start date is after the end date'; end if;

  with b as (select * from public.branches where public.can_see_branch(id)),
  l as (select ls.* from public.loan_summary ls where ls.currency = p_currency and public.can_see_branch(ls.branch_id)),
  open_l as (select * from l where status in ('Active','Defaulted','Restructured')),
  unpaid as (
    select s.loan_id, min(s.due_date) as oldest_due
    from public.loan_schedules s join open_l on open_l.id = s.loan_id
    where s.principal_due_minor > s.principal_paid_minor or s.interest_due_minor > s.interest_paid_minor
       or s.fee_due_minor > s.fee_paid_minor or s.penalty_due_minor > s.penalty_paid_minor
    group by s.loan_id),
  par as (select open_l.branch_id, sum(open_l.outstanding_principal) filter(where u.oldest_due <= current_date - 30) par30
          from open_l join unpaid u on u.loan_id = open_l.id group by open_l.branch_id),
  disb as (select branch_id, count(*) n, coalesce(sum(principal_minor),0) amt from l
           where disbursement_date between v_from and v_to group by branch_id),
  outs as (select branch_id, count(*) n, coalesce(sum(outstanding_principal),0) amt from open_l group by branch_id),
  coll as (select l.branch_id, coalesce(sum(r.amount_minor),0) amt from public.repayments r join l on l.id = r.loan_id
           where r.payment_date between v_from and v_to group by l.branch_id),
  due as (select l.branch_id,
                 coalesce(sum(s.principal_due_minor + s.interest_due_minor + s.fee_due_minor + s.penalty_due_minor),0) due_amt,
                 coalesce(sum(s.principal_paid_minor + s.interest_paid_minor + s.fee_paid_minor + s.penalty_paid_minor),0) paid_amt
          from public.loan_schedules s join l on l.id = s.loan_id
          where l.status not in ('Pending Approval','Rejected') and s.due_date between v_from and least(v_to, current_date)
          group by l.branch_id),
  pen as (select open_l.branch_id, coalesce(sum(s.penalty_due_minor - s.penalty_paid_minor),0) amt
          from public.loan_schedules s join open_l on open_l.id = s.loan_id group by open_l.branch_id),
  bor as (select branch_id, count(*) n, count(*) filter(where kyc_status = 'Verified') verified
          from public.borrowers where branch_id in (select id from b) group by branch_id),
  off as (select branch_id, count(*) n from public.profiles
          where role in ('Loan Officer','Branch Manager') and branch_id in (select id from b) group by branch_id)
  select coalesce(jsonb_agg(jsonb_build_object(
      'branch_id', b.id, 'name', b.name, 'code', b.code, 'status', b.status,
      'borrowers', coalesce(bor.n,0), 'kyc_verified', coalesce(bor.verified,0),
      'officers', coalesce(off.n,0),
      'active_loans', coalesce(outs.n,0), 'outstanding_minor', coalesce(outs.amt,0),
      'disbursed_count', coalesce(disb.n,0), 'disbursed_minor', coalesce(disb.amt,0),
      'collected_minor', coalesce(coll.amt,0),
      'due_minor', coalesce(due.due_amt,0), 'paid_on_due_minor', coalesce(due.paid_amt,0),
      'par30_minor', coalesce(par.par30,0), 'penalties_minor', coalesce(pen.amt,0)
    ) order by b.name), '[]'::jsonb)
  into v
  from b
  left join bor on bor.branch_id = b.id left join off on off.branch_id = b.id
  left join outs on outs.branch_id = b.id left join disb on disb.branch_id = b.id
  left join coll on coll.branch_id = b.id left join due on due.branch_id = b.id
  left join par on par.branch_id = b.id left join pen on pen.branch_id = b.id;
  return v;
end $$;

-- 1.8.2: one branch's people. Loans are credited to whoever created them; loans created before 1.8.1 have no creator.
create or replace function public.officer_metrics(p_branch uuid, p_currency char(3) default 'MWK', p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare v jsonb; v_from date := coalesce(p_from, date '1900-01-01'); v_to date := coalesce(p_to, current_date);
begin
  if not (public.current_role() = 'Admin'
          or (public.current_role() = 'Branch Manager' and public.has_permission('reports','view'))) then
    raise exception 'Not authorized to view officer performance';
  end if;
  if not public.can_see_branch(p_branch) then raise exception 'Branch not found'; end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  if v_from > v_to then raise exception 'The start date is after the end date'; end if;

  with staff as (select id, full_name, email, role from public.profiles
                 where branch_id = p_branch and role in ('Loan Officer','Branch Manager')),
  l as (select ls.* from public.loan_summary ls where ls.branch_id = p_branch and ls.currency = p_currency),
  open_l as (select * from l where status in ('Active','Defaulted','Restructured')),
  unpaid as (
    select s.loan_id, min(s.due_date) as oldest_due
    from public.loan_schedules s join open_l on open_l.id = s.loan_id
    where s.principal_due_minor > s.principal_paid_minor or s.interest_due_minor > s.interest_paid_minor
       or s.fee_due_minor > s.fee_paid_minor or s.penalty_due_minor > s.penalty_paid_minor
    group by s.loan_id),
  per as (
    select l.created_by as uid,
           count(*) filter(where l.created_at::date between v_from and v_to) created_n,
           coalesce(sum(l.principal_minor) filter(where l.created_at::date between v_from and v_to),0) requested,
           count(*) filter(where l.disbursement_date between v_from and v_to) disbursed_n,
           coalesce(sum(l.principal_minor) filter(where l.disbursement_date between v_from and v_to),0) disbursed,
           count(*) filter(where l.status in ('Active','Defaulted','Restructured')) open_n,
           coalesce(sum(l.outstanding_principal) filter(where l.status in ('Active','Defaulted','Restructured')),0) outstanding,
           coalesce(sum(l.outstanding_principal) filter(where u.oldest_due <= current_date - 30),0) par30
    from l left join unpaid u on u.loan_id = l.id group by l.created_by),
  kyc as (select kyc_verified_by uid, count(*) n from public.borrowers
          where branch_id = p_branch and kyc_verified_at::date between v_from and v_to group by kyc_verified_by),
  ids as (select id as uid from staff union select uid from per where uid is not null union select uid from kyc where uid is not null)
  select coalesce(jsonb_agg(q.j order by (q.j->>'name')), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'user_id', ids.uid, 'name', coalesce(st.full_name, st.email, 'Former staff'), 'role', st.role,
      'loans_created', coalesce(per.created_n,0), 'requested_minor', coalesce(per.requested,0),
      'disbursed_count', coalesce(per.disbursed_n,0), 'disbursed_minor', coalesce(per.disbursed,0),
      'open_loans', coalesce(per.open_n,0), 'outstanding_minor', coalesce(per.outstanding,0),
      'par30_minor', coalesce(per.par30,0), 'kyc_verified', coalesce(kyc.n,0)) as j
    from ids left join staff st on st.id = ids.uid left join per on per.uid = ids.uid left join kyc on kyc.uid = ids.uid
    union all
    select jsonb_build_object('user_id', null, 'name', 'Not recorded (loans before 1.8.1)', 'role', null,
      'loans_created', per.created_n, 'requested_minor', per.requested, 'disbursed_count', per.disbursed_n,
      'disbursed_minor', per.disbursed, 'open_loans', per.open_n, 'outstanding_minor', per.outstanding,
      'par30_minor', per.par30, 'kyc_verified', 0) as j
    from per where per.uid is null and (per.created_n > 0 or per.disbursed_n > 0 or per.open_n > 0)
  ) q;
  return v;
end $$;

-- 1.9.0: grouped totals for the dashboard Analysis charts. Scoped by branch (Admin: everything).
-- Money is in minor units of ONE currency; counts span all currencies except currency_mix (which is the point).
-- Only the collections chart uses the period; the others are snapshots of today.
create or replace function public.analysis_breakdown(p_currency char(3) default 'MWK', p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare v jsonb; v_from date := coalesce(p_from, date '1900-01-01'); v_to date := coalesce(p_to, current_date);
begin
  if public.current_role() not in ('Admin','Branch Manager','Loan Officer') then raise exception 'Not authorized'; end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  if v_from > v_to then raise exception 'The start date is after the end date'; end if;

  with l as (select ls.* from public.loan_summary ls where public.can_see_branch(ls.branch_id)),
  open_l as (select * from l where status in ('Active','Defaulted','Restructured')),
  b as (select id, name, code from public.branches where public.can_see_branch(id)),
  by_branch as (
    select b.id, b.name, b.code,
      coalesce((select sum(o.outstanding_principal) from open_l o where o.branch_id = b.id and o.currency = p_currency),0) outstanding,
      coalesce((select sum(r.amount_minor) from public.repayments r join l on l.id = r.loan_id
                where l.branch_id = b.id and r.currency = p_currency and r.payment_date between v_from and v_to),0) collected
    from b),
  risk as (
    select br.risk_level::text rk, coalesce(sum(o.outstanding_principal),0) amt, count(*) n
    from open_l o join public.borrowers br on br.id = o.borrower_id where o.currency = p_currency group by br.risk_level)
  select jsonb_build_object(
    'currency', p_currency,
    'by_branch', coalesce((select jsonb_agg(jsonb_build_object('branch_id', id, 'name', name, 'code', code,
                           'outstanding_minor', outstanding, 'collected_minor', collected) order by name) from by_branch),'[]'::jsonb),
    'loan_status', coalesce((select jsonb_agg(jsonb_build_object('status', st, 'count', n) order by n desc)
                             from (select status::text st, count(*) n from l where status::text <> 'Voided' group by status) q),'[]'::jsonb),
    'kyc', coalesce((select jsonb_agg(jsonb_build_object('status', st, 'count', n) order by n desc)
                     from (select kyc_status::text st, count(*) n from public.borrowers
                           where public.can_see_branch(branch_id) or (branch_id is null and public.current_role() <> 'Borrower')
                           group by kyc_status) q),'[]'::jsonb),
    'risk', coalesce((select jsonb_agg(jsonb_build_object('risk', rk, 'outstanding_minor', amt, 'count', n) order by amt desc) from risk),'[]'::jsonb),
    'currency_mix', coalesce((select jsonb_agg(jsonb_build_object('currency', cur, 'count', n, 'outstanding_minor', amt) order by n desc)
                              from (select currency::text cur, count(*) n, coalesce(sum(outstanding_principal),0) amt from open_l group by currency) q),'[]'::jsonb)
  ) into v;
  return v;
end $$;

-- 1.7: loans with at least one unpaid instalment whose due date has passed.
drop function if exists public.overdue_loans(char(3));
create function public.overdue_loans(p_currency char(3) default null)
returns table(loan_id uuid, loan_number text, borrower_id uuid, borrower_name text, phone text,
              currency char(3), status public.loan_status, oldest_due date, days_late integer,
              overdue_minor bigint, penalty_minor bigint, outstanding_principal bigint)
language plpgsql stable security definer set search_path=public
as $$
begin
  if not public.has_permission('loans','view') then raise exception 'Not authorized'; end if;
  return query
  select l.id, l.loan_number, l.borrower_id, b.full_name, b.phone, l.currency, l.status,
         min(s.due_date), (current_date - min(s.due_date))::integer,
         sum((s.principal_due_minor - s.principal_paid_minor) + (s.interest_due_minor - s.interest_paid_minor)
           + (s.fee_due_minor - s.fee_paid_minor) + (s.penalty_due_minor - s.penalty_paid_minor))::bigint,
         sum(s.penalty_due_minor - s.penalty_paid_minor)::bigint,
         greatest(0, l.principal_minor - coalesce((select sum(r.principal_component_minor)
                                                   from public.repayments r where r.loan_id = l.id),0))::bigint
  from public.loans l
  join public.borrowers b on b.id = l.borrower_id
  join public.loan_schedules s on s.loan_id = l.id
  where l.status in ('Active','Defaulted','Restructured')
    and s.due_date < current_date
    and public.can_see_branch(l.branch_id)
    and (p_currency is null or l.currency = p_currency)
    and (s.principal_due_minor > s.principal_paid_minor or s.interest_due_minor > s.interest_paid_minor
         or s.fee_due_minor > s.fee_paid_minor or s.penalty_due_minor > s.penalty_paid_minor)
  group by l.id, b.full_name, b.phone;
end $$;

-- 1.7: dry-run of the repayment waterfall (same order as post_repayment).
create or replace function public.repayment_preview(p_loan_id uuid, p_amount_minor bigint)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare
  r record; v_rem bigint := greatest(coalesce(p_amount_minor,0),0);
  v_fee bigint := 0; v_pen bigint := 0; v_int bigint := 0; v_prin bigint := 0;
  v_apply bigint; v_sched bigint; v_total bigint := 0; v_now bigint := 0;
  v_next date; v_next_amt bigint; v_currency char(3); v_status public.loan_status;
begin
  if not public.has_permission('repayments','create') then raise exception 'Not authorized'; end if;
  select currency, status into v_currency, v_status from public.loans where id = p_loan_id and public.can_see_branch(branch_id);
  if not found then raise exception 'Loan not found'; end if;

  for r in select * from public.loan_schedules where loan_id = p_loan_id order by due_date, installment_no loop
    v_sched := (r.fee_due_minor - r.fee_paid_minor) + (r.penalty_due_minor - r.penalty_paid_minor)
             + (r.interest_due_minor - r.interest_paid_minor) + (r.principal_due_minor - r.principal_paid_minor);
    v_total := v_total + v_sched;
    if r.due_date <= current_date then v_now := v_now + v_sched; end if;
    if v_next is null and v_sched > 0 then v_next := r.due_date; v_next_amt := v_sched; end if;

    v_apply := least(v_rem, r.fee_due_minor - r.fee_paid_minor);
    if v_apply > 0 then v_fee := v_fee + v_apply; v_rem := v_rem - v_apply; end if;
    v_apply := least(v_rem, r.penalty_due_minor - r.penalty_paid_minor);
    if v_apply > 0 then v_pen := v_pen + v_apply; v_rem := v_rem - v_apply; end if;
    v_apply := least(v_rem, r.interest_due_minor - r.interest_paid_minor);
    if v_apply > 0 then v_int := v_int + v_apply; v_rem := v_rem - v_apply; end if;
    v_apply := least(v_rem, r.principal_due_minor - r.principal_paid_minor);
    if v_apply > 0 then v_prin := v_prin + v_apply; v_rem := v_rem - v_apply; end if;
  end loop;

  return jsonb_build_object('currency', v_currency, 'status', v_status, 'total_due', v_total, 'due_now', v_now,
    'fee', v_fee, 'penalty', v_pen, 'interest', v_int, 'principal', v_prin, 'overpay', v_rem,
    'next_due', v_next, 'next_amount', v_next_amt);
end $$;

-- 1.7: apply the active penalty rule to overdue instalments (idempotent; never lowers a penalty).
create or replace function public.accrue_penalties()
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_rule public.penalty_rules%rowtype; r record;
  v_base bigint; v_days integer; v_target bigint; v_n integer := 0; v_total bigint := 0;
begin
  if not (public.current_role() = 'Admin' or public.has_permission('loans','edit')) then
    raise exception 'Not authorized to apply penalties';
  end if;
  select * into v_rule from public.penalty_rules where active order by name limit 1;
  if not found then raise exception 'No active penalty rule is configured'; end if;

  for r in
    select s.id, s.due_date, s.principal_due_minor, s.principal_paid_minor,
           s.interest_due_minor, s.interest_paid_minor, s.penalty_due_minor
    from public.loan_schedules s join public.loans l on l.id = s.loan_id
    where l.status in ('Active','Defaulted','Restructured')
      and public.can_see_branch(l.branch_id)
      and s.due_date + v_rule.grace_days < current_date
      and (s.principal_due_minor > s.principal_paid_minor or s.interest_due_minor > s.interest_paid_minor)
    for update of s
  loop
    v_base := (r.principal_due_minor - r.principal_paid_minor) + (r.interest_due_minor - r.interest_paid_minor);
    v_days := current_date - (r.due_date + v_rule.grace_days);
    v_target := round(v_base::numeric * v_rule.flat_rate_bps / 10000)
              + round(v_base::numeric * v_rule.daily_rate_bps / 10000 * v_days);
    if v_rule.cap_principal_bps is not null then
      v_target := least(v_target, round(r.principal_due_minor::numeric * v_rule.cap_principal_bps / 10000));
    end if;
    if v_target > r.penalty_due_minor then
      update public.loan_schedules set penalty_due_minor = v_target where id = r.id;
      v_n := v_n + 1; v_total := v_total + (v_target - r.penalty_due_minor);
    end if;
  end loop;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'APPLY_PENALTIES', 'penalty_rule', v_rule.id,
         jsonb_build_object('rule', v_rule.name, 'schedules_updated', v_n, 'amount_minor', v_total));
  return jsonb_build_object('schedules_updated', v_n, 'amount_minor', v_total, 'rule', v_rule.name);
end $$;

-- 1.7: borrower portal: next instalment per own loan (borrowers cannot read loan_schedules directly).
create or replace function public.borrower_next_due()
returns table(loan_id uuid, loan_number text, currency char(3), due_date date, amount_due_minor bigint, is_overdue boolean)
language sql stable security definer set search_path=public
as $$
  select distinct on (l.id) l.id, l.loan_number, l.currency, s.due_date,
         ((s.principal_due_minor - s.principal_paid_minor) + (s.interest_due_minor - s.interest_paid_minor)
          + (s.fee_due_minor - s.fee_paid_minor) + (s.penalty_due_minor - s.penalty_paid_minor))::bigint,
         s.due_date < current_date
  from public.loans l
  join public.borrowers b on b.id = l.borrower_id
  join public.loan_schedules s on s.loan_id = l.id
  where b.user_id = auth.uid() and l.status in ('Active','Defaulted','Restructured')
    and (s.principal_due_minor > s.principal_paid_minor or s.interest_due_minor > s.interest_paid_minor
         or s.fee_due_minor > s.fee_paid_minor or s.penalty_due_minor > s.penalty_paid_minor)
  order by l.id, s.due_date, s.installment_no
$$;

-- 1.7: one loan's schedule for staff (loans view) or the owning borrower.
create or replace function public.loan_schedule(p_loan_id uuid)
returns setof public.loan_schedules
language plpgsql stable security definer set search_path=public
as $$
begin
  if not ((public.has_permission('loans','view')
           and exists(select 1 from public.loans lx where lx.id = p_loan_id and public.can_see_branch(lx.branch_id)))
          or exists(select 1 from public.loans l join public.borrowers b on b.id = l.borrower_id
                    where l.id = p_loan_id and b.user_id = auth.uid())) then
    raise exception 'Not authorized';
  end if;
  return query select * from public.loan_schedules where loan_id = p_loan_id order by installment_no;
end $$;

-- ---------------------------------------------------------------------
-- 10a. Branch management (1.8). Writes go through these functions only.
-- ---------------------------------------------------------------------
create or replace function public.create_branch(p_name text, p_code text, p_address text default null, p_phone text default null)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
  if public.current_role() <> 'Admin' then raise exception 'Only administrators can create branches'; end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Branch name is required'; end if;
  if coalesce(p_code,'') !~ '^[A-Za-z0-9]{2,10}$' then raise exception 'Branch code must be 2-10 letters or digits'; end if;
  if exists(select 1 from public.branches where lower(name) = lower(trim(p_name))) then raise exception 'A branch with this name already exists'; end if;
  if exists(select 1 from public.branches where upper(code) = upper(p_code)) then raise exception 'A branch with this code already exists'; end if;
  insert into public.branches(name, code, address, phone)
  values(trim(p_name), upper(p_code), nullif(trim(p_address),''), nullif(trim(p_phone),'')) returning id into v_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'CREATE', 'branch', v_id, jsonb_build_object('name', trim(p_name), 'code', upper(p_code)));
  return v_id;
end $$;

create or replace function public.update_branch(p_id uuid, p_name text, p_code text, p_address text, p_phone text, p_manager_id uuid)
returns boolean
language plpgsql security definer set search_path=public
as $$
begin
  if public.current_role() <> 'Admin' then raise exception 'Only administrators can edit branches'; end if;
  if not exists(select 1 from public.branches where id = p_id) then raise exception 'Branch not found'; end if;
  if length(trim(coalesce(p_name,''))) < 2 then raise exception 'Branch name is required'; end if;
  if coalesce(p_code,'') !~ '^[A-Za-z0-9]{2,10}$' then raise exception 'Branch code must be 2-10 letters or digits'; end if;
  if exists(select 1 from public.branches where lower(name) = lower(trim(p_name)) and id <> p_id) then raise exception 'A branch with this name already exists'; end if;
  if exists(select 1 from public.branches where upper(code) = upper(p_code) and id <> p_id) then raise exception 'A branch with this code already exists'; end if;
  if p_manager_id is not null and not exists(select 1 from public.profiles
       where id = p_manager_id and role = 'Branch Manager' and branch_id = p_id) then
    raise exception 'The manager must be a Branch Manager assigned to this branch';
  end if;
  update public.branches set name = trim(p_name), code = upper(p_code), address = nullif(trim(p_address),''),
         phone = nullif(trim(p_phone),''), manager_id = p_manager_id where id = p_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'UPDATE', 'branch', p_id, jsonb_build_object('name', trim(p_name), 'code', upper(p_code), 'manager_id', p_manager_id));
  return true;
end $$;

-- A branch with live loans cannot be closed. Closed branches accept no new borrowers or loans.
create or replace function public.set_branch_status(p_id uuid, p_status text)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare v_live integer;
begin
  if public.current_role() <> 'Admin' then raise exception 'Only administrators can close or reopen branches'; end if;
  if p_status not in ('Active','Closed') then raise exception 'Invalid status'; end if;
  if not exists(select 1 from public.branches where id = p_id) then raise exception 'Branch not found'; end if;
  if p_status = 'Closed' then
    select count(*) into v_live from public.loans
     where branch_id = p_id and status in ('Pending Approval','Active','Defaulted','Restructured');
    if v_live > 0 then raise exception 'This branch still has % open loan(s). Move or settle them first.', v_live; end if;
  end if;
  update public.branches set status = p_status, closed_at = case when p_status = 'Closed' then now() else null end where id = p_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), case when p_status = 'Closed' then 'CLOSE' else 'REOPEN' end, 'branch', p_id, '{}'::jsonb);
  return true;
end $$;

-- Move a staff member to a branch and/or change their role.
create or replace function public.assign_staff_branch(p_user_id uuid, p_branch_id uuid, p_role text)
returns boolean
language plpgsql security definer set search_path=public
as $$
begin
  if public.current_role() <> 'Admin' then raise exception 'Only administrators can assign staff to branches'; end if;
  if p_role not in ('Admin','Branch Manager','Loan Officer') then raise exception 'Invalid staff role'; end if;
  if not exists(select 1 from public.profiles where id = p_user_id and role in ('Admin','Branch Manager','Loan Officer')) then
    raise exception 'Staff user not found';
  end if;
  if p_role <> 'Admin' and p_branch_id is null then raise exception 'Choose a branch for this staff member'; end if;
  if p_branch_id is not null and not exists(select 1 from public.branches where id = p_branch_id and status = 'Active') then
    raise exception 'Branch not found or closed';
  end if;
  update public.branches set manager_id = null
   where manager_id = p_user_id and (id is distinct from p_branch_id or p_role <> 'Branch Manager');
  update public.profiles set role = p_role, branch_id = p_branch_id where id = p_user_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'ASSIGN_BRANCH', 'profile', p_user_id, jsonb_build_object('branch_id', p_branch_id, 'role', p_role));
  return true;
end $$;

-- Admin: assign or transfer any borrower (their loans follow; moving between branches needs a reason).
-- Branch Manager: claim an unassigned borrower for their own branch.
drop function if exists public.assign_borrower_branch(uuid, uuid);
create or replace function public.assign_borrower_branch(p_borrower_id uuid, p_branch_id uuid, p_reason text default null)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare v_cur uuid; v_role text := public.current_role(); v_loans int; v_open bigint; v_reason text := nullif(btrim(coalesce(p_reason,'')), '');
begin
  if v_role not in ('Admin','Branch Manager') then raise exception 'Not authorized'; end if;
  select branch_id into v_cur from public.borrowers where id = p_borrower_id;
  if not found then raise exception 'Borrower not found'; end if;
  if p_branch_id is null then raise exception 'Choose a branch'; end if;
  if not exists(select 1 from public.branches where id = p_branch_id and status = 'Active') then raise exception 'Branch not found or closed'; end if;
  if v_cur is not distinct from p_branch_id then raise exception 'The borrower is already in this branch'; end if;
  if v_role = 'Branch Manager' then
    if v_cur is not null then raise exception 'Only an administrator can move a borrower between branches'; end if;
    if p_branch_id is distinct from public.my_branch() then raise exception 'You can only claim borrowers for your own branch'; end if;
  elsif v_cur is not null and (v_reason is null or length(v_reason) < 3) then
    raise exception 'Give a reason for the transfer';
  end if;
  select count(*), coalesce(sum(outstanding_principal) filter(where status in ('Active','Defaulted','Restructured')),0)
    into v_loans, v_open from public.loan_summary where borrower_id = p_borrower_id;
  perform set_config('app.branch_rpc', '1', true);
  update public.borrowers set branch_id = p_branch_id where id = p_borrower_id;
  update public.loans set branch_id = p_branch_id where borrower_id = p_borrower_id;
  perform set_config('app.branch_rpc', '', true);
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'ASSIGN_BRANCH', 'borrower', p_borrower_id,
         jsonb_build_object('from', v_cur, 'to', p_branch_id,
           'from_name', (select name from public.branches where id = v_cur), 'to_name', (select name from public.branches where id = p_branch_id),
           'loans_moved', v_loans, 'open_principal_minor', v_open, 'reason', v_reason));
  return true;
end $$;

-- Audit rows remember which branch the record belonged to at the time (set by the server).
alter table public.audit_logs add column if not exists branch_id uuid;
create or replace function public.audit_set_branch()
returns trigger
language plpgsql security definer set search_path=public
as $$
begin
  if new.branch_id is null then
    new.branch_id := case new.entity_type
      when 'loan'     then (select branch_id from public.loans     where id = new.entity_id)
      when 'borrower' then (select branch_id from public.borrowers where id = new.entity_id)
      when 'profile'  then (select branch_id from public.profiles  where id = new.entity_id)
      when 'branch'   then new.entity_id
      when 'invoice'  then (select branch_id from public.manual_invoices where id = new.entity_id)
      else null end;
    if new.branch_id is null then new.branch_id := (select branch_id from public.profiles where id = new.actor_id); end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_branch on public.audit_logs;
create trigger trg_audit_branch before insert on public.audit_logs
  for each row execute function public.audit_set_branch();
create index if not exists idx_audit_branch on public.audit_logs(branch_id, created_at desc);
-- Older rows: best effort from today's ownership (new rows are exact). Safe to repeat.
update public.audit_logs a set branch_id = case a.entity_type
    when 'loan'     then (select branch_id from public.loans     where id = a.entity_id)
    when 'borrower' then (select branch_id from public.borrowers where id = a.entity_id)
    when 'profile'  then (select branch_id from public.profiles  where id = a.entity_id)
    when 'branch'   then a.entity_id else null end
  where a.branch_id is null and a.entity_type in ('loan','borrower','profile','branch');
update public.audit_logs a set branch_id = (select branch_id from public.profiles where id = a.actor_id)
  where a.branch_id is null and a.actor_id is not null;

-- Does the sum of the branches agree with the company ledger? Admin only (the ledger is company-wide).
-- Three independent checks per currency: money lent, money collected, principal still owed.
-- The ledger side comes from ledger_entries; the branch side from loans/repayments, split by branch (+ unassigned).
create or replace function public.branch_reconciliation(p_currency char(3) default 'MWK')
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare v_res jsonb;
begin
  if public.current_role() <> 'Admin' then raise exception 'Not authorized'; end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  with
  disb as (select coalesce(sum(case entry_type when 'DISBURSEMENT' then amount_minor else -amount_minor end),0)::bigint v from public.ledger_entries where entry_type in ('DISBURSEMENT','DISBURSEMENT_VOID') and currency = p_currency),
  coll as (select coalesce(sum(case entry_type when 'REPAYMENT' then amount_minor else -amount_minor end),0)::bigint v from public.ledger_entries where entry_type in ('REPAYMENT','REPAYMENT_VOID') and currency = p_currency),
  prin as (select coalesce(sum(case entry_type when 'REPAYMENT' then (metadata->>'principal')::bigint else -(metadata->>'principal')::bigint end),0)::bigint v from public.ledger_entries where entry_type in ('REPAYMENT','REPAYMENT_VOID') and currency = p_currency),
  l as (select * from public.loan_summary where currency = p_currency and status in ('Active','Defaulted','Restructured','Completed','Written-Off')),
  lb as (select coalesce(branch_id::text,'-') k, sum(principal_minor)::bigint disbursed, sum(outstanding_principal)::bigint outstanding from l group by 1),
  rb as (select coalesce(branch_id::text,'-') k, sum(amount_minor)::bigint collected
         from public.repayment_summary where currency = p_currency group by 1),
  parts as (
    select 'disbursed' key, 'Money lent' label, (select v from disb) ledger,
           coalesce((select sum(disbursed) from lb where k <> '-'),0)::bigint branches, coalesce((select disbursed from lb where k = '-'),0)::bigint unassigned
    union all
    select 'collected', 'Money collected', (select v from coll),
           coalesce((select sum(collected) from rb where k <> '-'),0)::bigint, coalesce((select collected from rb where k = '-'),0)::bigint
    union all
    select 'outstanding', 'Principal still owed', (select v from disb) - (select v from prin),
           coalesce((select sum(outstanding) from lb where k <> '-'),0)::bigint, coalesce((select outstanding from lb where k = '-'),0)::bigint)
  select jsonb_build_object('currency', p_currency,
    'rows', coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'ledger_minor', ledger, 'branches_minor', branches,
              'unassigned_minor', unassigned, 'difference_minor', ledger - branches - unassigned)), '[]'::jsonb),
    'unassigned_loans', (select count(*) from l where branch_id is null))
  into v_res from parts;
  return v_res;
end $$;

-- Branch ownership is set by the server, never by the client.
create or replace function public.borrower_branch_on_insert()
returns trigger
language plpgsql security definer set search_path=public
as $$
declare v_role text := public.current_role();
begin
  if v_role = 'Admin' then
    null;                                             -- Admin may choose the branch (or leave it unassigned)
  elsif v_role in ('Branch Manager','Loan Officer') then
    new.branch_id := public.my_branch();
    if new.branch_id is null then raise exception 'Your account is not assigned to a branch'; end if;
  else
    new.branch_id := null;                            -- public self-signup: unassigned until a branch claims them
  end if;
  if new.branch_id is not null and (select status from public.branches where id = new.branch_id) <> 'Active' then
    raise exception 'This branch is closed';
  end if;
  return new;
end $$;
drop trigger if exists trg_borrower_branch_insert on public.borrowers;
create trigger trg_borrower_branch_insert before insert on public.borrowers
for each row execute function public.borrower_branch_on_insert();

create or replace function public.loan_branch_on_insert()
returns trigger
language plpgsql security definer set search_path=public
as $$
begin
  new.branch_id := (select branch_id from public.borrowers where id = new.borrower_id);
  return new;
end $$;
drop trigger if exists trg_loan_branch_insert on public.loans;
create trigger trg_loan_branch_insert before insert on public.loans
for each row execute function public.loan_branch_on_insert();

create or replace function public.guard_branch_change()
returns trigger
language plpgsql security definer set search_path=public
as $$
begin
  if new.branch_id is distinct from old.branch_id and coalesce(current_setting('app.branch_rpc', true), '') <> '1' then
    raise exception 'Branch can only be changed through the assign functions';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_borrower_branch on public.borrowers;
create trigger trg_guard_borrower_branch before update on public.borrowers
for each row execute function public.guard_branch_change();
drop trigger if exists trg_guard_loan_branch on public.loans;
create trigger trg_guard_loan_branch before update on public.loans
for each row execute function public.guard_branch_change();

-- ---------------------------------------------------------------------
-- 10b. KYC workflow (1.8.1): a borrower can only be Verified with ID details and an address,
--      a rejection needs a reason, and every status change is audited with the branch.
-- ---------------------------------------------------------------------
create or replace function public.kyc_workflow()
returns trigger
language plpgsql security definer set search_path=public
as $$
declare v_changed boolean := (tg_op = 'INSERT' and new.kyc_status <> 'Pending')
                          or (tg_op = 'UPDATE' and new.kyc_status is distinct from old.kyc_status);
begin
  if public.current_role() = 'Borrower' or auth.uid() is null then
    return new;                                    -- self-signup and borrower self-edit never change KYC (guarded elsewhere)
  end if;
  if new.kyc_status = 'Verified' and (tg_op = 'INSERT' or old.kyc_status <> 'Verified') then
    if nullif(trim(new.id_number),'') is null or new.id_type is null or nullif(trim(new.address),'') is null then
      raise exception 'Record the ID type, ID number and address before verifying this borrower';
    end if;
  end if;
  if new.kyc_status = 'Rejected' and v_changed and nullif(trim(new.kyc_reason),'') is null then
    raise exception 'A reason is required when rejecting KYC';
  end if;
  if v_changed then
    if new.kyc_status = 'Verified' then
      new.kyc_verified_by := auth.uid(); new.kyc_verified_at := now(); new.kyc_reason := null;
    else
      new.kyc_verified_by := null; new.kyc_verified_at := null;
      if new.kyc_status = 'Pending' then new.kyc_reason := null; end if;
    end if;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values(auth.uid(), 'KYC_CHANGE', 'borrower', new.id,
           jsonb_build_object('from', case when tg_op = 'UPDATE' then old.kyc_status::text end,
                              'to', new.kyc_status::text, 'reason', nullif(trim(new.kyc_reason),''),
                              'branch_id', new.branch_id, 'borrower', new.full_name));
  end if;
  return new;
end $$;
drop trigger if exists trg_kyc_workflow on public.borrowers;
create trigger trg_kyc_workflow before insert or update on public.borrowers
for each row execute function public.kyc_workflow();

-- ---------------------------------------------------------------------
-- 11. Borrower self-signup and audit-event recording
-- ---------------------------------------------------------------------
create or replace function public.provision_borrower_on_signup()
returns trigger
language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id, full_name, email, role)
  values(new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email, 'Borrower')
  on conflict(id) do update set full_name = excluded.full_name, email = excluded.email;

  insert into public.borrowers(user_id, full_name, phone, email, borrower_type, business_name, kyc_status)
  values(new.id,
         coalesce(nullif(new.raw_user_meta_data->>'full_name',''), 'Borrower'),
         new.raw_user_meta_data->>'phone',
         new.email,
         case when new.raw_user_meta_data->>'borrower_type' = 'Business' then 'Business' else 'Individual' end,
         nullif(new.raw_user_meta_data->>'business_name',''),
         'Pending')
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created_marklend on auth.users;
create trigger on_auth_user_created_marklend
after insert on auth.users
for each row execute function public.provision_borrower_on_signup();

-- Borrowers may edit their own contact details, but never their own
-- KYC status, risk level or account link.
create or replace function public.protect_borrower_fields()
returns trigger
language plpgsql security definer set search_path=public
as $$
begin
  if not public.has_permission('borrowers','edit') then
    if new.kyc_status is distinct from old.kyc_status
       or new.risk_level is distinct from old.risk_level
       or new.user_id   is distinct from old.user_id
       or new.kyc_reason is distinct from old.kyc_reason
       or new.kyc_verified_by is distinct from old.kyc_verified_by
       or new.kyc_verified_at is distinct from old.kyc_verified_at then
      raise exception 'Only authorized staff can change KYC status or risk level';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_borrower_fields on public.borrowers;
create trigger trg_protect_borrower_fields
before update on public.borrowers
for each row execute function public.protect_borrower_fields();

create or replace function public.record_auth_event(p_action text, p_details jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path=public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_action not in ('SIGN_IN','SIGN_OUT','SIGNUP','SESSION_REFRESH','SESSION_LOCK','SESSION_UNLOCK','SESSION_EXPIRED') then
    raise exception 'Invalid authentication audit action';
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), p_action, 'session', null, coalesce(p_details,'{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

-- Profile avatar: users pick a preset key in the app (e.g. 'biz-store').
-- profiles has no UPDATE policy, so this RPC is the only write path and it
-- can only touch the caller's own row.
create or replace function public.set_my_avatar(p_avatar text)
returns text
language plpgsql security definer set search_path=public
as $$
declare v text := nullif(trim(p_avatar), '');
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v is not null and v !~ '^[a-z0-9_-]{1,32}$' then raise exception 'Invalid avatar'; end if;
  update public.profiles set avatar = v where id = auth.uid();
  if not found then raise exception 'Profile not found'; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'UPDATE_AVATAR', 'profile', auth.uid(), jsonb_build_object('avatar', v));
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 12. Views (dropped and recreated: adding columns to b.* / l.* and
--     inserting borrower_user_id makes CREATE OR REPLACE fail)
-- ---------------------------------------------------------------------
drop view if exists public.borrower_summary;
drop view if exists public.loan_summary;
drop view if exists public.repayment_summary;
drop view if exists public.audit_log_view;
drop view if exists public.staff_access_view;

create view public.borrower_summary with (security_invoker=true) as
select b.*,
       coalesce((select count(*) from public.loans l
                 where l.borrower_id = b.id and l.status in ('Active','Defaulted','Restructured')),0)::int as active_loans
from public.borrowers b;

create view public.loan_summary with (security_invoker=true) as
select l.*,
       b.full_name as borrower_name,
       b.user_id   as borrower_user_id,
       greatest(0, l.principal_minor
         - coalesce((select sum(r.principal_component_minor) from public.repayments r where r.loan_id = l.id),0)
       ) as outstanding_principal,
       br.name as branch_name, br.code as branch_code
from public.loans l
join public.borrowers b on b.id = l.borrower_id
left join public.branches br on br.id = l.branch_id;

create view public.repayment_summary with (security_invoker=true) as
select r.id, r.loan_id, r.payment_date, r.amount_minor,
       r.fee_component_minor, r.penalty_component_minor, r.interest_component_minor, r.principal_component_minor,
       r.currency, r.idempotency_key, r.created_by, r.created_at,
       l.loan_number, l.borrower_id, b.user_id as borrower_user_id, l.branch_id
from public.repayments r
join public.loans l on l.id = r.loan_id
join public.borrowers b on b.id = l.borrower_id;

create view public.audit_log_view with (security_invoker=true) as
select a.id, a.created_at, a.actor_id,
       coalesce(p.full_name, p.email, 'System user') as actor_name,
       p.email as actor_email, p.role as actor_role, p.avatar as actor_avatar,
       a.action, a.entity_type, a.entity_id, a.details,
       a.branch_id, br.name as branch_name
from public.audit_logs a
left join public.profiles p on p.id = a.actor_id
left join public.branches br on br.id = a.branch_id;

create view public.staff_access_view with (security_invoker=true) as
select p.id, p.full_name, p.email, p.role, p.avatar, p.branch_id, br.name as branch_name,
       coalesce(array_agg(sp.section order by sp.section) filter(where sp.section is not null),'{}') as sections,
       coalesce(jsonb_object_agg(sp.section, jsonb_build_object('can_view',sp.can_view,'can_create',sp.can_create,
                                                                 'can_edit',sp.can_edit,'can_approve',sp.can_approve))
                filter(where sp.section is not null),'{}'::jsonb) as permissions
from public.profiles p
left join public.branches br on br.id = p.branch_id
left join public.staff_permissions sp on sp.user_id = p.id
where p.role in ('Admin','Branch Manager','Loan Officer')
group by p.id, p.full_name, p.email, p.role, p.avatar, p.branch_id, br.name;

-- ---------------------------------------------------------------------
-- 13. Row level security
-- ---------------------------------------------------------------------
alter table public.branches             enable row level security;
alter table public.profiles             enable row level security;
alter table public.borrowers            enable row level security;
alter table public.loans                enable row level security;
alter table public.loan_schedules       enable row level security;
alter table public.penalty_rules        enable row level security;
alter table public.ledger_entries       enable row level security;
alter table public.repayments           enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.capital_transactions enable row level security;
alter table public.staff_permissions    enable row level security;

drop policy if exists profiles_self       on public.profiles;
drop policy if exists branches_select     on public.branches;
drop policy if exists borrower_self       on public.borrowers;
drop policy if exists borrower_loans      on public.loans;
drop policy if exists borrower_ledger     on public.ledger_entries;
drop policy if exists borrower_repayments on public.repayments;
drop policy if exists admin_penalty_rules on public.penalty_rules;

drop policy if exists staff_borrowers          on public.borrowers;
drop policy if exists borrower_update_self     on public.borrowers;
drop policy if exists staff_loans              on public.loans;
drop policy if exists staff_schedules          on public.loan_schedules;
drop policy if exists staff_ledger             on public.ledger_entries;
drop policy if exists staff_repayments         on public.repayments;
drop policy if exists staff_audit              on public.audit_logs;
drop policy if exists capital_staff            on public.capital_transactions;
drop policy if exists staff_permissions_admin  on public.staff_permissions;
drop policy if exists staff_permissions_self   on public.staff_permissions;

create policy profiles_self on public.profiles for select
  using(id = auth.uid() or public.current_role() = 'Admin'
        or (role <> 'Borrower' and branch_id is not null and branch_id = public.my_branch()));
create policy branches_select on public.branches for select
  using(public.current_role() = 'Admin' or id = public.my_branch());
create policy borrower_self on public.borrowers for select using(user_id = auth.uid());
create policy borrower_loans on public.loans for select
  using(borrower_id in (select id from public.borrowers where user_id = auth.uid()));
create policy borrower_ledger on public.ledger_entries for select
  using(borrower_id in (select id from public.borrowers where user_id = auth.uid()));
create policy borrower_repayments on public.repayments for select
  using(loan_id in (select l.id from public.loans l join public.borrowers b on b.id = l.borrower_id
                    where b.user_id = auth.uid()));
create policy admin_penalty_rules on public.penalty_rules for all
  using(public.current_role() = 'Admin') with check(public.current_role() = 'Admin');

create policy staff_borrowers on public.borrowers for all
  using(public.has_permission('borrowers','view') and (branch_id is null or public.can_see_branch(branch_id)))
  with check((public.has_permission('borrowers','create') or public.has_permission('borrowers','edit'))
             and (branch_id is null or public.can_see_branch(branch_id)));
create policy borrower_update_self on public.borrowers for update
  using(user_id = auth.uid()) with check(user_id = auth.uid());

create policy staff_loans      on public.loans          for select
  using(public.has_permission('loans','view') and public.can_see_branch(branch_id));
create policy staff_schedules  on public.loan_schedules for select
  using(public.has_permission('loans','view')
        and exists(select 1 from public.loans l where l.id = loan_id and public.can_see_branch(l.branch_id)));
-- Capital entries (no loan) are company-wide; loan entries follow the loan's branch.
create policy staff_ledger     on public.ledger_entries for select
  using(public.has_permission('ledger','view')
        and (loan_id is null or exists(select 1 from public.loans l where l.id = loan_id and public.can_see_branch(l.branch_id))));
create policy staff_repayments on public.repayments     for select
  using(public.has_permission('repayments','view')
        and exists(select 1 from public.loans l where l.id = loan_id and public.can_see_branch(l.branch_id)));
create policy staff_audit      on public.audit_logs     for select
  using(public.current_role() = 'Admin'
        or (public.has_permission('reports','view') and public.actor_in_my_branch(actor_id)));

create policy capital_staff           on public.capital_transactions for select using(public.has_permission('capital','view'));
create policy staff_permissions_admin on public.staff_permissions for all
  using(public.current_role() = 'Admin') with check(public.current_role() = 'Admin');
create policy staff_permissions_self  on public.staff_permissions for select using(user_id = auth.uid());

-- ---------------------------------------------------------------------
-- 14. Grants (dropped views lose theirs, so everything is re-granted)
-- ---------------------------------------------------------------------
-- Supabase grants new tables to anon/authenticated by default. Reset to least privilege;
-- RLS then narrows what is left.

-- ---------------------------------------------------------------------
-- 13. 1.10: voids, manual invoices, branch capital, branch targets
-- ---------------------------------------------------------------------
-- Void a payment: only the most recent payment of a loan (void newer ones first). The payment moves to
-- repayments_voided, its instalment allocation is reversed, the ledger and capital get reversing entries.
create or replace function public.void_repayment(p_repayment_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare
  r public.repayments%rowtype; v_status public.loan_status; v_branch uuid; v_role text := public.current_role();
  v_reason text := btrim(coalesce(p_reason,'')); v_last uuid; a record; s record; v_legacy boolean := false;
  v_left bigint; v_take bigint; k text;
begin
  if not (v_role = 'Admin' or (v_role = 'Branch Manager' and public.has_permission('repayments','approve'))) then
    raise exception 'Not authorized to void payments';
  end if;
  if length(v_reason) < 5 then raise exception 'Give a reason (at least 5 characters)'; end if;
  select * into r from public.repayments where id = p_repayment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  select status, branch_id into v_status, v_branch from public.loans where id = r.loan_id for update;
  if not public.can_see_branch(v_branch) then raise exception 'Payment not found'; end if;
  if v_status::text in ('Written-Off','Voided') then raise exception 'Payments on a % loan cannot be voided', lower(v_status::text); end if;
  if exists(select 1 from public.loan_extensions where loan_id = r.loan_id and created_at > r.created_at) then
    raise exception 'This loan was extended after this payment was made, so the payment can no longer be voided';
  end if;
  select id into v_last from public.repayments where loan_id = r.loan_id order by created_at desc, id desc limit 1;
  if v_last <> r.id then raise exception 'Only the latest payment on a loan can be voided. Void the more recent payment first.'; end if;

  if exists(select 1 from public.repayment_allocations where repayment_id = r.id) then
    for a in select * from public.repayment_allocations where repayment_id = r.id loop
      update public.loan_schedules
         set fee_paid_minor = fee_paid_minor - a.fee_minor, penalty_paid_minor = penalty_paid_minor - a.penalty_minor,
             interest_paid_minor = interest_paid_minor - a.interest_minor, principal_paid_minor = principal_paid_minor - a.principal_minor
       where id = a.schedule_id;
    end loop;
  else
    -- payment made before 1.10 (no allocation record): take it back from the latest instalments, category by category
    v_legacy := true;
    foreach k in array array['fee','penalty','interest','principal'] loop
      v_left := case k when 'fee' then r.fee_component_minor when 'penalty' then r.penalty_component_minor
                       when 'interest' then r.interest_component_minor else r.principal_component_minor end;
      for s in select id, fee_paid_minor, penalty_paid_minor, interest_paid_minor, principal_paid_minor
                 from public.loan_schedules where loan_id = r.loan_id order by due_date desc, installment_no desc loop
        exit when v_left = 0;
        v_take := least(v_left, case k when 'fee' then s.fee_paid_minor when 'penalty' then s.penalty_paid_minor
                                       when 'interest' then s.interest_paid_minor else s.principal_paid_minor end);
        if v_take > 0 then
          execute format('update public.loan_schedules set %I = %I - $1 where id = $2', k || '_paid_minor', k || '_paid_minor') using v_take, s.id;
          v_left := v_left - v_take;
        end if;
      end loop;
      if v_left > 0 then raise exception 'Cannot reverse this payment: the instalments no longer hold it'; end if;
    end loop;
  end if;

  insert into public.repayments_voided(id, loan_id, payment_date, amount_minor, fee_component_minor, penalty_component_minor,
         interest_component_minor, principal_component_minor, currency, idempotency_key, created_by, created_at, voided_at, voided_by, void_reason)
  values(r.id, r.loan_id, r.payment_date, r.amount_minor, r.fee_component_minor, r.penalty_component_minor,
         r.interest_component_minor, r.principal_component_minor, r.currency, r.idempotency_key, r.created_by, r.created_at, now(), auth.uid(), v_reason);
  delete from public.repayments where id = r.id;

  if r.principal_component_minor > 0 then
    insert into public.capital_transactions(transaction_type, amount_minor, currency, reference, source, loan_id, created_by)
    values('ADJUSTMENT_OUT', r.principal_component_minor, r.currency, 'VOID-' || r.id::text, 'Voided payment', r.loan_id, auth.uid());
  end if;
  insert into public.ledger_entries(entry_type, reference, loan_id, borrower_id, debit_account, credit_account, amount_minor, currency, idempotency_key, metadata)
  values('REPAYMENT_VOID', 'VOID-' || r.idempotency_key, r.loan_id, (select borrower_id from public.loans where id = r.loan_id),
         'LOAN_RECEIVABLE', 'CASH', r.amount_minor, r.currency, 'ledger-void-' || r.id::text,
         jsonb_build_object('fee', r.fee_component_minor, 'penalty', r.penalty_component_minor, 'interest', r.interest_component_minor,
                            'principal', r.principal_component_minor, 'reason', v_reason));
  if v_status = 'Completed' then
    update public.loans set status = 'Active', updated_at = now() where id = r.loan_id;
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'VOID_REPAYMENT', 'loan', r.loan_id,
         jsonb_build_object('repayment_id', r.id, 'amount_minor', r.amount_minor, 'payment_date', r.payment_date, 'reason', v_reason,
                            'reopened', v_status = 'Completed', 'approximate_reversal', v_legacy));
  return true;
end $$;

-- Void a loan that was disbursed by mistake and has no payments. Admin only. Reverses the disbursement and frees the capital.
create or replace function public.void_loan(p_loan_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare l public.loans%rowtype; v_reason text := btrim(coalesce(p_reason,''));
begin
  if public.current_role() <> 'Admin' then raise exception 'Only administrators can void a loan'; end if;
  if length(v_reason) < 5 then raise exception 'Give a reason (at least 5 characters)'; end if;
  select * into l from public.loans where id = p_loan_id for update;
  if not found then raise exception 'Loan not found'; end if;
  if l.status::text not in ('Active','Defaulted','Restructured') then
    raise exception 'Only a disbursed loan can be voided (status: %). Pending or rejected loans can be deleted instead.', l.status;
  end if;
  if exists(select 1 from public.repayments where loan_id = p_loan_id) then
    raise exception 'This loan has payments. Void its payments first, newest first.';
  end if;
  perform pg_advisory_xact_lock(hashtext('capital-' || l.currency));
  update public.loans set status = 'Voided', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason, updated_at = now() where id = p_loan_id;
  insert into public.capital_transactions(transaction_type, amount_minor, currency, reference, source, loan_id, created_by)
  values('ADJUSTMENT_IN', l.principal_minor, l.currency, 'VOIDLOAN-' || p_loan_id::text, 'Voided loan', p_loan_id, auth.uid());
  insert into public.ledger_entries(entry_type, reference, loan_id, borrower_id, debit_account, credit_account, amount_minor, currency, idempotency_key, metadata)
  values('DISBURSEMENT_VOID', 'VOIDLOAN-' || l.loan_number, p_loan_id, l.borrower_id, 'CASH', 'LOAN_RECEIVABLE', l.principal_minor, l.currency,
         'ledger-voidloan-' || p_loan_id::text, jsonb_build_object('loan_number', l.loan_number, 'reason', v_reason));
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'VOID_LOAN', 'loan', p_loan_id,
         jsonb_build_object('loan_number', l.loan_number, 'principal_minor', l.principal_minor, 'currency', l.currency, 'reason', v_reason));
  return true;
end $$;

-- Delete a loan that never moved money (pending or rejected). Admin, or a Branch Manager with approval rights in their branch.
create or replace function public.delete_loan(p_loan_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare l public.loans%rowtype; v_role text := public.current_role(); v_reason text := btrim(coalesce(p_reason,''));
begin
  if not (v_role = 'Admin' or (v_role = 'Branch Manager' and public.has_permission('loans','approve'))) then
    raise exception 'Not authorized to delete loans';
  end if;
  if length(v_reason) < 5 then raise exception 'Give a reason (at least 5 characters)'; end if;
  select * into l from public.loans where id = p_loan_id for update;
  if not found or not public.can_see_branch(l.branch_id) then raise exception 'Loan not found'; end if;
  if l.status::text not in ('Pending Approval','Rejected') then
    raise exception 'Only a pending or rejected loan can be deleted (status: %). A disbursed loan must be voided.', l.status;
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'DELETE_LOAN', 'loan', p_loan_id,
         jsonb_build_object('loan_number', l.loan_number, 'borrower_id', l.borrower_id, 'principal_minor', l.principal_minor,
                            'currency', l.currency, 'status', l.status, 'reason', v_reason));
  delete from public.loans where id = p_loan_id;
  return true;
end $$;

-- ----- manual invoices: not tied to a loan; saved with a number, or generated once without being recorded -----
create table if not exists public.invoice_counters(year integer primary key, last integer not null default 0);
create table if not exists public.manual_invoices(
  id uuid primary key default gen_random_uuid(),
  invoice_number text unique not null,
  branch_id uuid references public.branches(id),
  borrower_id uuid references public.borrowers(id),
  customer_name text not null,
  customer_email text, customer_phone text, customer_address text,
  currency char(3) not null check(currency in ('MWK','USD','ZAR')),
  issue_date date not null, due_date date,
  lines jsonb not null,
  total_minor bigint not null check(total_minor > 0),
  notes text,
  status text not null default 'Issued' check(status in ('Issued','Void')),
  voided_at timestamptz, voided_by uuid, void_reason text,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists idx_manual_invoices_created on public.manual_invoices(created_at desc);
create index if not exists idx_manual_invoices_branch on public.manual_invoices(branch_id, created_at desc);

create or replace function public.create_manual_invoice(
  p_borrower_id uuid, p_customer_name text, p_customer_email text, p_customer_phone text, p_customer_address text,
  p_currency char(3), p_issue_date date, p_due_date date, p_lines jsonb, p_notes text, p_branch_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  v_role text := public.current_role(); v_branch uuid; v_name text := btrim(coalesce(p_customer_name,'')); e jsonb; v_total bigint := 0;
  v_year int := extract(year from coalesce(p_issue_date, current_date))::int; v_n int; v_no text; v_id uuid; v_b record;
begin
  if v_role not in ('Admin','Branch Manager','Loan Officer') or not public.has_permission('loans','create') then raise exception 'Not authorized'; end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  if p_issue_date is null then raise exception 'Choose an issue date'; end if;
  if p_due_date is not null and p_due_date < p_issue_date then raise exception 'The due date is before the issue date'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then raise exception 'Add between 1 and 50 invoice lines'; end if;
  for e in select * from jsonb_array_elements(p_lines) loop
    if length(btrim(coalesce(e->>'description',''))) < 1 or length(e->>'description') > 200 then raise exception 'Every line needs a description (up to 200 characters)'; end if;
    if coalesce((e->>'qty')::numeric, 0) < 1 or (e->>'qty')::numeric > 100000 or (e->>'qty')::numeric <> trunc((e->>'qty')::numeric) then raise exception 'Quantity must be a whole number from 1 to 100000'; end if;
    if coalesce((e->>'unit_minor')::numeric, -1) < 0 or (e->>'unit_minor')::numeric > 9000000000000 or (e->>'unit_minor')::numeric <> trunc((e->>'unit_minor')::numeric) then raise exception 'Unit price must be zero or more'; end if;
    v_total := v_total + (e->>'qty')::bigint * (e->>'unit_minor')::bigint;
  end loop;
  if v_total <= 0 then raise exception 'The invoice total must be more than zero'; end if;

  if p_borrower_id is not null then
    select full_name, branch_id into v_b from public.borrowers where id = p_borrower_id;
    if not found or not (public.can_see_branch(v_b.branch_id) or (v_b.branch_id is null and v_role = 'Admin')) then raise exception 'Borrower not found'; end if;
    if v_name = '' then v_name := v_b.full_name; end if;
    v_branch := v_b.branch_id;
  end if;
  if v_branch is null then v_branch := case when v_role = 'Admin' then p_branch_id else public.my_branch() end; end if;
  if v_role <> 'Admin' and v_branch is null then raise exception 'Your account is not assigned to a branch'; end if;
  if v_name = '' or length(v_name) < 2 then raise exception 'Enter the customer name'; end if;

  insert into public.invoice_counters(year, last) values(v_year, 1) on conflict (year) do update set last = public.invoice_counters.last + 1 returning last into v_n;
  v_no := 'MI-' || v_year || '-' || lpad(v_n::text, 4, '0');
  insert into public.manual_invoices(invoice_number, branch_id, borrower_id, customer_name, customer_email, customer_phone, customer_address,
                                     currency, issue_date, due_date, lines, total_minor, notes, created_by)
  values(v_no, v_branch, p_borrower_id, v_name, nullif(btrim(coalesce(p_customer_email,'')),''), nullif(btrim(coalesce(p_customer_phone,'')),''),
         nullif(btrim(coalesce(p_customer_address,'')),''), p_currency, p_issue_date, p_due_date, p_lines, v_total, nullif(btrim(coalesce(p_notes,'')),''), auth.uid())
  returning id into v_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'CREATE_INVOICE', 'invoice', v_id, jsonb_build_object('invoice_number', v_no, 'customer', v_name, 'currency', p_currency, 'total_minor', v_total));
  return (select to_jsonb(m) || jsonb_build_object('branch_name', (select name from public.branches where id = m.branch_id)) from public.manual_invoices m where m.id = v_id);
end $$;

create or replace function public.void_manual_invoice(p_id uuid, p_reason text)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare m public.manual_invoices%rowtype; v_role text := public.current_role(); v_reason text := btrim(coalesce(p_reason,''));
begin
  if v_role not in ('Admin','Branch Manager') then raise exception 'Only administrators and branch managers can void an invoice'; end if;
  if length(v_reason) < 5 then raise exception 'Give a reason (at least 5 characters)'; end if;
  select * into m from public.manual_invoices where id = p_id for update;
  if not found or not (v_role = 'Admin' or public.can_see_branch(m.branch_id)) then raise exception 'Invoice not found'; end if;
  if m.status = 'Void' then raise exception 'This invoice is already void'; end if;
  update public.manual_invoices set status = 'Void', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason where id = p_id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'VOID_INVOICE', 'invoice', p_id, jsonb_build_object('invoice_number', m.invoice_number, 'reason', v_reason));
  return true;
end $$;

-- ----- per-branch capital allocation: the company pool stays one pool; a limit caps what a branch may have out on loan -----
create table if not exists public.branch_capital(
  branch_id uuid not null references public.branches(id) on delete cascade,
  currency char(3) not null check(currency in ('MWK','USD','ZAR')),
  allocated_minor bigint not null check(allocated_minor >= 0),
  note text, updated_by uuid, updated_at timestamptz not null default now(),
  primary key(branch_id, currency)
);

-- Company capital pool = lending capital available now + principal currently lent out (open loans).
create or replace function public.capital_pool(p_currency char(3))
returns bigint
language sql stable security definer set search_path=public
as $$
  select coalesce((select sum(case when transaction_type in ('FUNDING','REPAYMENT','ADJUSTMENT_IN') then amount_minor else -amount_minor end)
                   from public.capital_transactions where currency = p_currency), 0)
       + coalesce((select sum(outstanding_principal) from public.loan_summary where currency = p_currency and status in ('Active','Defaulted','Restructured')), 0)
$$;

-- Admin sets a branch's limit (null removes it: the branch is then limited only by the company pool).
create or replace function public.set_branch_capital(p_branch_id uuid, p_currency char(3), p_amount_minor bigint, p_note text default null)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare v_used bigint; v_others bigint; v_pool bigint; v_old bigint;
begin
  if public.current_role() <> 'Admin' then raise exception 'Only administrators can allocate capital'; end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  if not exists(select 1 from public.branches where id = p_branch_id and status = 'Active') then raise exception 'Branch not found or closed'; end if;
  perform pg_advisory_xact_lock(hashtext('capital-' || p_currency));
  select allocated_minor into v_old from public.branch_capital where branch_id = p_branch_id and currency = p_currency;
  if p_amount_minor is null then
    delete from public.branch_capital where branch_id = p_branch_id and currency = p_currency;
  else
    if p_amount_minor < 0 then raise exception 'The allocation cannot be negative'; end if;
    select coalesce(sum(outstanding_principal),0) into v_used from public.loan_summary
     where branch_id = p_branch_id and currency = p_currency and status in ('Active','Defaulted','Restructured');
    if p_amount_minor < v_used then raise exception 'This branch has % % lent out; the allocation cannot be lower', p_currency, (v_used/100.0)::numeric(18,2); end if;
    select coalesce(sum(allocated_minor),0) into v_others from public.branch_capital where currency = p_currency and branch_id <> p_branch_id;
    v_pool := public.capital_pool(p_currency);
    if v_others + p_amount_minor > v_pool then
      raise exception 'Allocations would exceed the company capital pool (% % total, % % already allocated to other branches)', p_currency, (v_pool/100.0)::numeric(18,2), p_currency, (v_others/100.0)::numeric(18,2);
    end if;
    insert into public.branch_capital(branch_id, currency, allocated_minor, note, updated_by, updated_at)
    values(p_branch_id, p_currency, p_amount_minor, nullif(btrim(coalesce(p_note,'')),''), auth.uid(), now())
    on conflict (branch_id, currency) do update set allocated_minor = excluded.allocated_minor, note = excluded.note, updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'SET_BRANCH_CAPITAL', 'branch', p_branch_id,
         jsonb_build_object('currency', p_currency, 'from_minor', v_old, 'to_minor', p_amount_minor, 'note', nullif(btrim(coalesce(p_note,'')),'')));
  return true;
end $$;

create or replace function public.branch_capital_overview(p_currency char(3) default 'MWK')
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare v_role text := public.current_role(); v_pool bigint; v_alloc bigint; v_rows jsonb;
begin
  if v_role not in ('Admin','Branch Manager') then raise exception 'Not authorized'; end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('branch_id', b.id, 'name', b.name, 'code', b.code, 'limited', c.branch_id is not null,
           'allocated_minor', c.allocated_minor, 'used_minor', u.used,
           'available_minor', case when c.branch_id is null then null else c.allocated_minor - u.used end, 'note', c.note) order by b.name), '[]'::jsonb)
    into v_rows
    from public.branches b
    left join public.branch_capital c on c.branch_id = b.id and c.currency = p_currency
    cross join lateral (select coalesce(sum(ls.outstanding_principal),0)::bigint used from public.loan_summary ls
                        where ls.branch_id = b.id and ls.currency = p_currency and ls.status in ('Active','Defaulted','Restructured')) u
   where b.status = 'Active' and public.can_see_branch(b.id);
  if v_role = 'Admin' then
    v_pool := public.capital_pool(p_currency);
    select coalesce(sum(allocated_minor),0) into v_alloc from public.branch_capital where currency = p_currency;
  end if;
  return jsonb_build_object('currency', p_currency, 'pool_minor', v_pool, 'allocated_minor', v_alloc,
                            'unallocated_minor', case when v_role = 'Admin' then v_pool - v_alloc end, 'rows', v_rows);
end $$;

-- ----- branch targets (per month, per currency) -----
create table if not exists public.branch_targets(
  branch_id uuid not null references public.branches(id) on delete cascade,
  month date not null check(month = date_trunc('month', month)::date),
  currency char(3) not null check(currency in ('MWK','USD','ZAR')),
  disbursed_minor bigint not null default 0 check(disbursed_minor >= 0),
  collected_minor bigint not null default 0 check(collected_minor >= 0),
  new_borrowers integer not null default 0 check(new_borrowers >= 0),
  updated_by uuid, updated_at timestamptz not null default now(),
  primary key(branch_id, month, currency)
);

create or replace function public.set_branch_target(p_branch_id uuid, p_month date, p_currency char(3), p_disbursed_minor bigint, p_collected_minor bigint, p_new_borrowers integer)
returns boolean
language plpgsql security definer set search_path=public
as $$
declare v_m date := date_trunc('month', p_month)::date;
begin
  if public.current_role() <> 'Admin' then raise exception 'Only administrators can set targets'; end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  if p_month is null then raise exception 'Choose a month'; end if;
  if not exists(select 1 from public.branches where id = p_branch_id) then raise exception 'Branch not found'; end if;
  if coalesce(p_disbursed_minor,0) < 0 or coalesce(p_collected_minor,0) < 0 or coalesce(p_new_borrowers,0) < 0 then raise exception 'Targets cannot be negative'; end if;
  if coalesce(p_disbursed_minor,0) = 0 and coalesce(p_collected_minor,0) = 0 and coalesce(p_new_borrowers,0) = 0 then
    delete from public.branch_targets where branch_id = p_branch_id and month = v_m and currency = p_currency;
  else
    insert into public.branch_targets(branch_id, month, currency, disbursed_minor, collected_minor, new_borrowers, updated_by, updated_at)
    values(p_branch_id, v_m, p_currency, coalesce(p_disbursed_minor,0), coalesce(p_collected_minor,0), coalesce(p_new_borrowers,0), auth.uid(), now())
    on conflict (branch_id, month, currency) do update set disbursed_minor = excluded.disbursed_minor, collected_minor = excluded.collected_minor,
      new_borrowers = excluded.new_borrowers, updated_by = excluded.updated_by, updated_at = now();
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values(auth.uid(), 'SET_BRANCH_TARGET', 'branch', p_branch_id,
         jsonb_build_object('month', v_m, 'currency', p_currency, 'disbursed_minor', coalesce(p_disbursed_minor,0), 'collected_minor', coalesce(p_collected_minor,0), 'new_borrowers', coalesce(p_new_borrowers,0)));
  return true;
end $$;

create or replace function public.branch_target_progress(p_currency char(3) default 'MWK', p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path=public
as $$
declare v_m date := date_trunc('month', coalesce(p_month, current_date))::date; v_end date; v_days int; v_el int; v_rows jsonb;
begin
  if not (public.current_role() = 'Admin' or (public.current_role() = 'Branch Manager' and public.has_permission('reports','view'))) then
    raise exception 'Not authorized to view branch targets';
  end if;
  if p_currency not in ('MWK','USD','ZAR') then raise exception 'Unsupported currency'; end if;
  v_end := (v_m + interval '1 month')::date; v_days := v_end - v_m;
  v_el := case when current_date >= v_end then v_days when current_date < v_m then 0 else current_date - v_m + 1 end;
  select coalesce(jsonb_agg(jsonb_build_object('branch_id', b.id, 'name', b.name, 'code', b.code,
           'has_target', t.branch_id is not null,
           'disbursed_target_minor', coalesce(t.disbursed_minor,0), 'collected_target_minor', coalesce(t.collected_minor,0), 'borrowers_target', coalesce(t.new_borrowers,0),
           'disbursed_actual_minor', a.disbursed, 'collected_actual_minor', a.collected, 'borrowers_actual', a.borrowers) order by b.name), '[]'::jsonb)
    into v_rows
    from public.branches b
    left join public.branch_targets t on t.branch_id = b.id and t.month = v_m and t.currency = p_currency
    cross join lateral (select
        (select coalesce(sum(l.principal_minor),0)::bigint from public.loans l where l.branch_id = b.id and l.currency = p_currency
            and l.status in ('Active','Defaulted','Restructured','Completed','Written-Off') and l.disbursement_date >= v_m and l.disbursement_date < v_end) disbursed,
        (select coalesce(sum(r.amount_minor),0)::bigint from public.repayments r join public.loans l on l.id = r.loan_id
            where l.branch_id = b.id and r.currency = p_currency and r.payment_date >= v_m and r.payment_date < v_end) collected,
        (select count(*)::int from public.borrowers x where x.branch_id = b.id and x.created_at >= v_m and x.created_at < v_end) borrowers) a
   where b.status = 'Active' and public.can_see_branch(b.id);
  return jsonb_build_object('currency', p_currency, 'month', v_m, 'days', v_days, 'elapsed', v_el, 'pace_pct', round(v_el * 100.0 / v_days, 1), 'rows', v_rows);
end $$;

-- ----- 1.11: extend a loan (reschedule what is still owed over a longer period) -----
create table if not exists public.loan_extensions(
  id uuid primary key default gen_random_uuid(),
  loan_id uuid not null references public.loans(id) on delete cascade,
  created_at timestamptz not null default now(), created_by uuid,
  reason text not null,
  old_maturity date, new_maturity date not null, old_status text not null,
  extra_interest_bps integer not null default 0, fee_minor bigint not null default 0, waived_penalty_minor bigint not null default 0,
  remaining_principal_minor bigint not null, remaining_interest_minor bigint not null,
  instalments integer not null,
  old_schedule jsonb not null
);
create index if not exists idx_loan_extensions_loan on public.loan_extensions(loan_id, created_at desc);

-- What is still owed (unpaid principal, interest, fees and penalties) is spread over new instalments that end on the new maturity date.
-- Instalments that were partly paid are closed at what was paid; instalments with nothing paid are replaced; fully paid ones are untouched.
-- The old schedule is kept in loan_extensions. No money moves, so the ledger and capital are not touched.
-- p_extra_interest_bps is the optional rate (basis points) for the new extension-period interest charge. Each extension starts a new full interest period on principal still owed; early interest payment does not reduce that period charge.
-- p_preview = true returns the plan without changing anything.
create or replace function public.extend_loan(
  p_loan_id uuid, p_new_maturity date, p_reason text,
  p_extra_interest_bps integer default 0, p_fee_minor bigint default 0, p_waive_penalties boolean default false, p_preview boolean default false
)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare
  l public.loans%rowtype; v_role text := public.current_role(); v_reason text := btrim(coalesce(p_reason,''));
  s record; v_rem_p bigint := 0; v_rem_i bigint := 0; v_rem_f bigint := 0; v_rem_pen bigint := 0; v_waived bigint := 0;
  v_from date := current_date; v_n int; v_i int; v_extra bigint; v_int_total bigint;
  v_due date; v_no int; v_old jsonb; v_rows jsonb := '[]'::jsonb; v_prin bigint; v_int bigint; v_fee bigint; v_pen bigint; v_ext uuid;
  v_bp bigint; v_bi bigint; v_fee_in bigint := coalesce(p_fee_minor, 0); v_bps int := coalesce(p_extra_interest_bps, 0);
begin
  if not (v_role = 'Admin' or (v_role = 'Branch Manager' and public.has_permission('loans','approve'))) then
    raise exception 'Not authorized to extend loans';
  end if;
  if length(v_reason) < 5 then raise exception 'Give a reason (at least 5 characters)'; end if;
  select * into l from public.loans where id = p_loan_id for update;
  if not found or not public.can_see_branch(l.branch_id) then raise exception 'Loan not found'; end if;
  if l.status::text not in ('Active','Defaulted','Restructured') then raise exception 'Only a running loan can be extended (status: %)', l.status; end if;
  if p_new_maturity is null or p_new_maturity <= greatest(current_date, coalesce(l.maturity_date, current_date)) then
    raise exception 'The new end date must be after today and after the current end date (%)', l.maturity_date;
  end if;
  if p_new_maturity > current_date + 3660 then raise exception 'The new end date is more than 10 years away'; end if;
  if v_bps < 0 or v_bps > 10000 then raise exception 'Extension interest rate must be between 0%% and 100%%'; end if;
  if v_fee_in < 0 then raise exception 'The extension fee cannot be negative'; end if;
  if p_waive_penalties and v_role <> 'Admin' then raise exception 'Only administrators can waive penalties'; end if;

  for s in select * from public.loan_schedules where loan_id = p_loan_id order by installment_no loop
    v_rem_p := v_rem_p + (s.principal_due_minor - s.principal_paid_minor);
    v_rem_i := v_rem_i + (s.interest_due_minor - s.interest_paid_minor);
    v_rem_f := v_rem_f + (s.fee_due_minor - s.fee_paid_minor);
    v_rem_pen := v_rem_pen + (s.penalty_due_minor - s.penalty_paid_minor);
  end loop;
  if p_waive_penalties then v_waived := v_rem_pen; v_rem_pen := 0; end if;
  if v_rem_p + v_rem_i + v_rem_f + v_rem_pen <= 0 then raise exception 'Nothing is owed on this loan, so there is nothing to extend'; end if;

  v_n := case l.frequency
    when 'Daily'   then greatest(1, p_new_maturity - v_from)
    when 'Weekly'  then greatest(1, ceil((p_new_maturity - v_from)::numeric / 7))::int
    when 'Monthly' then greatest(1, (extract(year from age(p_new_maturity, v_from)) * 12 + extract(month from age(p_new_maturity, v_from)))::int)
    else 1 end;
  if v_n > 1000 then raise exception 'That would create % instalments; choose a shorter extension or a less frequent plan', v_n; end if;

  v_extra := round(v_rem_p::numeric * v_bps / 10000);
  v_int_total := v_rem_i + v_extra;
  v_bp := floor(v_rem_p::numeric / v_n)::bigint; v_bi := floor(v_int_total::numeric / v_n)::bigint;
  for v_i in 1..v_n loop
    v_prin := case when v_i = v_n then v_rem_p - v_bp * (v_n - 1) else v_bp end;
    v_int  := case when v_i = v_n then v_int_total - v_bi * (v_n - 1) else v_bi end;
    v_fee  := case when v_i = 1 then v_rem_f + v_fee_in else 0 end;
    v_pen  := case when v_i = 1 then v_rem_pen else 0 end;
    v_due := case when v_i = v_n then p_new_maturity else least(p_new_maturity, case l.frequency
               when 'Daily' then v_from + v_i when 'Weekly' then v_from + 7 * v_i
               when 'Monthly' then (v_from + make_interval(months => v_i))::date else p_new_maturity end) end;
    v_rows := v_rows || jsonb_build_object('due_date', v_due, 'principal_minor', v_prin, 'interest_minor', v_int,
                                           'fee_minor', v_fee, 'penalty_minor', v_pen, 'total_minor', v_prin + v_int + v_fee + v_pen);
  end loop;

  if not p_preview then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.installment_no), '[]'::jsonb) into v_old from public.loan_schedules x where x.loan_id = p_loan_id;
    for s in select * from public.loan_schedules where loan_id = p_loan_id loop
      if s.principal_paid_minor + s.interest_paid_minor + s.fee_paid_minor + s.penalty_paid_minor > 0 then
        update public.loan_schedules set principal_due_minor = principal_paid_minor, interest_due_minor = interest_paid_minor,
               fee_due_minor = fee_paid_minor, penalty_due_minor = penalty_paid_minor where id = s.id;
      elsif s.principal_due_minor + s.interest_due_minor + s.fee_due_minor + s.penalty_due_minor > 0 then
        delete from public.loan_schedules where id = s.id;
      end if;
    end loop;
    select coalesce(max(installment_no), 0) into v_no from public.loan_schedules where loan_id = p_loan_id;
    for v_i in 0..v_n - 1 loop
      insert into public.loan_schedules(loan_id, installment_no, due_date, principal_due_minor, interest_due_minor, fee_due_minor, penalty_due_minor)
      select p_loan_id, v_no + v_i + 1, (e->>'due_date')::date, (e->>'principal_minor')::bigint, (e->>'interest_minor')::bigint,
             (e->>'fee_minor')::bigint, (e->>'penalty_minor')::bigint from jsonb_array_elements(v_rows) with ordinality t(e, ord) where ord = v_i + 1;
    end loop;
    update public.loans set maturity_date = p_new_maturity, status = 'Restructured', updated_at = now() where id = p_loan_id;
    insert into public.loan_extensions(loan_id, created_by, reason, old_maturity, new_maturity, old_status, extra_interest_bps, fee_minor,
                                       waived_penalty_minor, remaining_principal_minor, remaining_interest_minor, instalments, old_schedule)
    values(p_loan_id, auth.uid(), v_reason, l.maturity_date, p_new_maturity, l.status::text, v_bps, v_fee_in, v_waived, v_rem_p, v_rem_i, v_n, v_old)
    returning id into v_ext;
    insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values(auth.uid(), 'EXTEND_LOAN', 'loan', p_loan_id,
           jsonb_build_object('loan_number', l.loan_number, 'old_maturity', l.maturity_date, 'new_maturity', p_new_maturity, 'reason', v_reason,
             'remaining_principal_minor', v_rem_p, 'remaining_interest_minor', v_rem_i, 'extra_interest_minor', v_extra, 'fee_minor', v_fee_in,
             'waived_penalty_minor', v_waived, 'instalments', v_n, 'previous_status', l.status::text));
  end if;

  return jsonb_build_object('preview', p_preview, 'extension_id', v_ext, 'old_maturity', l.maturity_date, 'new_maturity', p_new_maturity,
    'remaining_principal_minor', v_rem_p, 'remaining_interest_minor', v_rem_i, 'remaining_fee_minor', v_rem_f, 'remaining_penalty_minor', v_rem_pen,
    'extra_interest_minor', v_extra, 'fee_minor', v_fee_in, 'waived_penalty_minor', v_waived,
    'total_to_pay_minor', v_rem_p + v_int_total + v_rem_f + v_fee_in + v_rem_pen, 'instalments', v_n, 'rows', v_rows);
end $$;

-- RLS for the new tables (writes only through the functions above)
alter table public.repayment_allocations enable row level security;
alter table public.repayments_voided     enable row level security;
alter table public.manual_invoices       enable row level security;
alter table public.invoice_counters      enable row level security;
alter table public.branch_capital        enable row level security;
alter table public.branch_targets        enable row level security;
alter table public.loan_extensions       enable row level security;
drop policy if exists staff_repayments_voided on public.repayments_voided;
create policy staff_repayments_voided on public.repayments_voided for select
  using(public.has_permission('repayments','view')
        and exists(select 1 from public.loans l where l.id = loan_id and public.can_see_branch(l.branch_id)));
drop policy if exists staff_loan_extensions on public.loan_extensions;
create policy staff_loan_extensions on public.loan_extensions for select
  using(public.has_permission('loans','view')
        and exists(select 1 from public.loans l where l.id = loan_id and public.can_see_branch(l.branch_id)));
drop policy if exists staff_manual_invoices on public.manual_invoices;
create policy staff_manual_invoices on public.manual_invoices for select
  using(public.has_permission('loans','view') and public.can_see_branch(branch_id));
drop policy if exists staff_branch_capital on public.branch_capital;
create policy staff_branch_capital on public.branch_capital for select
  using(public.current_role() = 'Admin' or (public.current_role() = 'Branch Manager' and branch_id = public.my_branch()));
drop policy if exists staff_branch_targets on public.branch_targets;
create policy staff_branch_targets on public.branch_targets for select
  using(public.current_role() = 'Admin' or (public.current_role() = 'Branch Manager' and branch_id = public.my_branch()));

revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;

grant usage on schema public to authenticated;
grant select on public.branches, public.profiles, public.borrowers, public.loans, public.loan_schedules, public.ledger_entries,
                public.repayments, public.audit_logs, public.capital_transactions, public.staff_permissions,
                public.repayments_voided, public.manual_invoices, public.branch_capital, public.branch_targets, public.loan_extensions
  to authenticated;
grant select on public.borrower_summary, public.loan_summary, public.repayment_summary,
                public.audit_log_view, public.staff_access_view
  to authenticated;
grant insert, update on public.borrowers to authenticated;   -- RLS decides who may do what; no DELETE for the app
grant select, insert, update, delete on public.penalty_rules to authenticated;

revoke execute on function
  public.create_loan(uuid,bigint,text,integer,text,char(3),date,date,text,text,bigint,text),
  public.approve_loan(uuid),
  public.reject_loan(uuid,text),
  public.add_capital(bigint,char(3),text,text),
  public.withdraw_capital(bigint,char(3),text,text),
  public.post_repayment(uuid,bigint,date,text),
  public.provision_staff_profile(uuid,text,text,text,text[],uuid),
  public.create_branch(text,text,text,text),
  public.update_branch(uuid,text,text,text,text,uuid),
  public.set_branch_status(uuid,text),
  public.assign_staff_branch(uuid,uuid,text),
  public.assign_borrower_branch(uuid,uuid,text),
  public.update_staff_permissions(uuid,text[]),
  public.update_staff_permissions_json(uuid,jsonb),
  public.portfolio_metrics(char(3)),
  public.portfolio_monthly(char(3),integer),
  public.branch_metrics(char(3),date,date),
  public.branch_reconciliation(char(3)),
  public.void_repayment(uuid,text), public.void_loan(uuid,text), public.delete_loan(uuid,text),
  public.extend_loan(uuid,date,text,integer,bigint,boolean,boolean),
  public.create_manual_invoice(uuid,text,text,text,text,char(3),date,date,jsonb,text,uuid), public.void_manual_invoice(uuid,text),
  public.capital_pool(char(3)), public.set_branch_capital(uuid,char(3),bigint,text), public.branch_capital_overview(char(3)),
  public.set_branch_target(uuid,date,char(3),bigint,bigint,integer), public.branch_target_progress(char(3),date),
  public.analysis_breakdown(char(3),date,date),
  public.officer_metrics(uuid,char(3),date,date),
  public.overdue_loans(char(3)),
  public.repayment_preview(uuid,bigint),
  public.accrue_penalties(),
  public.borrower_next_due(),
  public.loan_schedule(uuid),
  public.available_capital(char(3)),
  public.record_auth_event(text,jsonb),
  public.set_my_avatar(text),
  public.my_branch(), public.can_see_branch(uuid), public.actor_in_my_branch(uuid)
from public, anon;

grant execute on function
  public.create_loan(uuid,bigint,text,integer,text,char(3),date,date,text,text,bigint,text),
  public.approve_loan(uuid),
  public.reject_loan(uuid,text),
  public.add_capital(bigint,char(3),text,text),
  public.withdraw_capital(bigint,char(3),text,text),
  public.post_repayment(uuid,bigint,date,text),
  public.provision_staff_profile(uuid,text,text,text,text[],uuid),
  public.create_branch(text,text,text,text),
  public.update_branch(uuid,text,text,text,text,uuid),
  public.set_branch_status(uuid,text),
  public.assign_staff_branch(uuid,uuid,text),
  public.assign_borrower_branch(uuid,uuid,text),
  public.update_staff_permissions(uuid,text[]),
  public.update_staff_permissions_json(uuid,jsonb),
  public.portfolio_metrics(char(3)),
  public.portfolio_monthly(char(3),integer),
  public.branch_metrics(char(3),date,date),
  public.branch_reconciliation(char(3)),
  public.void_repayment(uuid,text), public.void_loan(uuid,text), public.delete_loan(uuid,text),
  public.extend_loan(uuid,date,text,integer,bigint,boolean,boolean),
  public.create_manual_invoice(uuid,text,text,text,text,char(3),date,date,jsonb,text,uuid), public.void_manual_invoice(uuid,text),
  public.capital_pool(char(3)), public.set_branch_capital(uuid,char(3),bigint,text), public.branch_capital_overview(char(3)),
  public.set_branch_target(uuid,date,char(3),bigint,bigint,integer), public.branch_target_progress(char(3),date),
  public.analysis_breakdown(char(3),date,date),
  public.officer_metrics(uuid,char(3),date,date),
  public.overdue_loans(char(3)),
  public.repayment_preview(uuid,bigint),
  public.accrue_penalties(),
  public.borrower_next_due(),
  public.loan_schedule(uuid),
  public.available_capital(char(3)),
  public.record_auth_event(text,jsonb),
  public.set_my_avatar(text),
  public.has_permission(text,text), public.my_branch(), public.can_see_branch(uuid), public.actor_in_my_branch(uuid)
to authenticated;

-- Make PostgREST pick up the new functions and views immediately.
notify pgrst, 'reload schema';
