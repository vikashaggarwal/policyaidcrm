-- Dial Desk: core schema.
-- One lead = one vehicle (decision: a person with two vehicles appears as two leads).
-- Run order: 0001 (this), 0002 (functions), 0003 (RLS).

-- ---------------------------------------------------------------- enums
create type public.user_role as enum ('admin', 'manager', 'caller');

create type public.lead_status as enum (
  'new', 'no_answer', 'callback', 'interested', 'sold', 'not_interested', 'do_not_call'
);

-- ---------------------------------------------------------------- profiles
-- login_id is what people type; the auth email is derived from it (see README).
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  login_id    text not null unique check (login_id ~ '^[a-z0-9._-]{3,32}$'),
  full_name   text not null check (length(trim(full_name)) between 2 and 80),
  role        public.user_role not null default 'caller',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- upload_batches
create table public.upload_batches (
  id           uuid primary key default gen_random_uuid(),
  uploaded_by  uuid not null references public.profiles (id),
  filename     text not null,
  total_rows   integer not null default 0 check (total_rows >= 0),
  added        integer not null default 0 check (added >= 0),
  duplicates   integer not null default 0 check (duplicates >= 0),
  invalid      integer not null default 0 check (invalid >= 0),
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------- leads
create table public.leads (
  id              uuid primary key default gen_random_uuid(),

  -- the 16 columns of the source sheet
  state           text,
  reg_no          text not null,
  rto_code        text,
  reg_date        date,
  name            text not null,                 -- OWNER NAME
  guardian_name   text,                          -- OWNER(S/W/D)
  address         text,
  engine_no       text,
  chassis_no      text,
  vehicle_make    text,
  vehicle_model   text,                          -- MODEL / VARIANT
  vehicle_class   text,
  fuel            text,
  sale_amount     numeric(14, 2) check (sale_amount is null or sale_amount >= 0),
  seat_capacity   integer check (seat_capacity is null or seat_capacity between 0 and 200),
  phone           text not null check (phone ~ '^[0-9]{10}$'),   -- MOBILE, normalised

  -- derived / working fields
  city            text,
  product         text not null default 'Motor renewal',
  source          text,
  -- Business rule from the owner: expiry = registration date + 5 days.
  policy_expiry   date generated always as (reg_date + 5) stored,

  assigned_to     uuid references public.profiles (id) on delete set null,
  status          public.lead_status not null default 'new',
  callback_at     timestamptz,
  attempts        integer not null default 0 check (attempts >= 0),
  last_called_at  timestamptz,
  dnd             boolean not null default false,
  batch_id        uuid references public.upload_batches (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- one lead per vehicle; the registration number is the identity
  constraint leads_reg_no_key unique (reg_no),
  constraint leads_reg_no_clean check (reg_no = upper(reg_no) and reg_no ~ '^[A-Z0-9]{4,15}$'),
  constraint leads_dnd_consistent check (status <> 'do_not_call' or dnd)
);

create index leads_assigned_to_idx    on public.leads (assigned_to);
create index leads_status_idx         on public.leads (status);
create index leads_callback_at_idx    on public.leads (callback_at) where callback_at is not null;
create index leads_phone_idx          on public.leads (phone);
create index leads_batch_idx          on public.leads (batch_id);
create index leads_policy_expiry_idx  on public.leads (policy_expiry);
-- the caller queue: "my workable leads"
create index leads_queue_idx on public.leads (assigned_to, status, callback_at)
  where dnd = false and status <> 'do_not_call';

-- ---------------------------------------------------------------- call_logs (append-only)
create table public.call_logs (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads (id) on delete cascade,
  caller_id    uuid not null references public.profiles (id),
  outcome      public.lead_status not null check (outcome <> 'new'),
  note         text check (note is null or length(note) <= 1000),
  callback_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index call_logs_lead_idx    on public.call_logs (lead_id, created_at desc);
create index call_logs_caller_idx  on public.call_logs (caller_id, created_at desc);
create index call_logs_created_idx on public.call_logs (created_at);

-- ---------------------------------------------------------------- audit_log (append-only)
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,                     -- null only for system / service-role actions
  action      text not null,            -- upload | reassign | reassign_unworked | delete_lead | user_* | export | unblock_dnd
  entity      text not null,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_actor_idx   on public.audit_log (actor_id);
