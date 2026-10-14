-- Dial Desk: Row Level Security. This is the real access control; the UI only mirrors it.
--   admin   : everything
--   manager : all leads and reports, uploads, reassignment; cannot delete leads or manage users
--   caller  : only leads assigned to them (and never DND leads); writes only through log_call()

alter table public.profiles       enable row level security;
alter table public.leads          enable row level security;
alter table public.call_logs      enable row level security;
alter table public.upload_batches enable row level security;
alter table public.audit_log      enable row level security;

-- Nothing is reachable without signing in.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ---------------------------------------------------------------- profiles
-- Rows are created only by the server (service role) when an admin adds a user.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_staff());

create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- leads
create policy leads_select_staff on public.leads for select to authenticated
  using (public.is_staff());

create policy leads_select_caller on public.leads for select to authenticated
  using (
    public.auth_role() = 'caller'
    and assigned_to = auth.uid()
    and dnd = false
    and status <> 'do_not_call'
  );

create policy leads_insert_staff on public.leads for insert to authenticated
  with check (public.is_staff());

create policy leads_update_staff on public.leads for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

create policy leads_delete_admin on public.leads for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------- call_logs
-- Read-only for everyone; rows are written by log_call() and can never be edited.
create policy call_logs_select_staff on public.call_logs for select to authenticated
  using (public.is_staff());

create policy call_logs_select_caller on public.call_logs for select to authenticated
  using (
    public.auth_role() = 'caller'
    and exists (
      select 1 from public.leads l
      where l.id = call_logs.lead_id and l.assigned_to = auth.uid()
    )
  );

-- ---------------------------------------------------------------- upload_batches
create policy batches_select_staff on public.upload_batches for select to authenticated
  using (public.is_staff());

create policy batches_insert_staff on public.upload_batches for insert to authenticated
  with check (public.is_staff() and uploaded_by = auth.uid());

-- ---------------------------------------------------------------- audit_log
create policy audit_select_staff on public.audit_log for select to authenticated
  using (public.is_staff());
