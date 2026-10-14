-- Dial Desk: helper functions, guard triggers, and the transactional RPCs.
-- Callers never write to leads or call_logs directly; they go through log_call().

-- ---------------------------------------------------------------- role helpers
-- SECURITY DEFINER so they can read profiles without recursing through RLS.
create or replace function public.auth_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid() and active $$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.auth_role() in ('admin', 'manager'), false) $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$ select coalesce(public.auth_role() = 'admin', false) $$;

-- ---------------------------------------------------------------- audit helper
create or replace function public.write_audit(
  p_action text, p_entity text, p_entity_id text, p_details jsonb
) returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------- triggers
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger leads_touch before update on public.leads
  for each row execute function public.touch_updated_at();

-- Do-not-call is permanent: only an admin may lift it, and that is audited.
create or replace function public.guard_dnd()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (old.dnd and not new.dnd) or (old.status = 'do_not_call' and new.status <> 'do_not_call') then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'dnd_locked' using errcode = 'P0001';
    end if;
    perform public.write_audit('unblock_dnd', 'lead', old.id::text, jsonb_build_object('reg_no', old.reg_no));
  end if;
  return new;
end $$;

create trigger leads_guard_dnd before update on public.leads
  for each row execute function public.guard_dnd();

-- Every deletion is recorded (single or bulk, whoever runs it).
create or replace function public.audit_lead_delete()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), 'delete_lead', 'lead', old.id::text,
          jsonb_build_object('reg_no', old.reg_no, 'assigned_to', old.assigned_to, 'status', old.status));
  return old;
end $$;

create trigger leads_audit_delete before delete on public.leads
  for each row execute function public.audit_lead_delete();

create or replace function public.audit_upload()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (new.uploaded_by, 'upload', 'upload_batch', new.id::text,
          jsonb_build_object('filename', new.filename, 'total_rows', new.total_rows,
                             'added', new.added, 'duplicates', new.duplicates, 'invalid', new.invalid));
  return new;
end $$;

create trigger upload_batches_audit after insert on public.upload_batches
  for each row execute function public.audit_upload();

-- Append-only guards. call_logs may only disappear when its lead is deleted by an admin
-- (the cascade runs one trigger level deeper than a direct DELETE).
create or replace function public.block_log_changes()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and tg_table_name = 'call_logs' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'append_only' using errcode = 'P0001';
end $$;

create trigger call_logs_no_update before update on public.call_logs
  for each row execute function public.block_log_changes();
create trigger call_logs_no_delete before delete on public.call_logs
  for each row execute function public.block_log_changes();
create trigger audit_log_no_update before update on public.audit_log
  for each row execute function public.block_log_changes();
create trigger audit_log_no_delete before delete on public.audit_log
  for each row execute function public.block_log_changes();

-- ---------------------------------------------------------------- log_call
-- One transaction: write the history row, then update the lead. Never edits history.
-- Error messages are short codes; the app turns them into plain-language text.
create or replace function public.log_call(
  p_lead_id     uuid,
  p_outcome     public.lead_status,
  p_note        text default null,
  p_callback_at timestamptz default null
) returns public.leads
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_role  public.user_role := public.auth_role();
  v_lead  public.leads;
  v_note  text := nullif(trim(coalesce(p_note, '')), '');
  v_cb    timestamptz := p_callback_at;
begin
  if v_uid is null or v_role is null then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'lead_not_found' using errcode = 'P0001';
  end if;
  if v_role = 'caller' and v_lead.assigned_to is distinct from v_uid then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v_lead.dnd or v_lead.status = 'do_not_call' then
    raise exception 'lead_blocked' using errcode = 'P0001';
  end if;
  if p_outcome = 'new' then
    raise exception 'invalid_outcome' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  -- sold / not interested / do not call never carry a callback
  if p_outcome in ('sold', 'not_interested', 'do_not_call') then
    v_cb := null;
  elsif p_outcome = 'callback' and v_cb is null then
    raise exception 'callback_required' using errcode = 'P0001';
  end if;
  if v_cb is not null and v_cb < now() - interval '5 minutes' then
    raise exception 'callback_in_past' using errcode = 'P0001';
  end if;

  insert into public.call_logs (lead_id, caller_id, outcome, note, callback_at)
  values (v_lead.id, v_uid, p_outcome, v_note, v_cb);

  update public.leads
     set status         = p_outcome,
         attempts       = attempts + 1,
         last_called_at = now(),
         callback_at    = v_cb,
         dnd            = dnd or p_outcome = 'do_not_call'
   where id = v_lead.id
   returning * into v_lead;

  -- Do-not-call belongs to the person, not the vehicle: block every lead on that number.
  if p_outcome = 'do_not_call' then
    update public.leads
       set dnd = true, status = 'do_not_call', callback_at = null
     where phone = v_lead.phone and status <> 'do_not_call';
    perform public.write_audit('do_not_call', 'lead', v_lead.id::text,
                               jsonb_build_object('reg_no', v_lead.reg_no));
  end if;

  return v_lead;
end $$;

-- ---------------------------------------------------------------- reassignment
create or replace function public.reassign_leads(p_lead_ids uuid[], p_to uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if p_lead_ids is null or cardinality(p_lead_ids) = 0 or cardinality(p_lead_ids) > 5000 then
    raise exception 'invalid_selection' using errcode = 'P0001';
  end if;
  if p_to is not null and not exists (
    select 1 from public.profiles where id = p_to and role = 'caller' and active
  ) then
    raise exception 'invalid_target' using errcode = 'P0001';
  end if;

  update public.leads set assigned_to = p_to where id = any (p_lead_ids);
  get diagnostics v_count = row_count;

  perform public.write_audit('reassign', 'lead', null,
    jsonb_build_object('to', p_to, 'count', v_count, 'sample_ids', to_jsonb(p_lead_ids[1:20])));
  return v_count;
end $$;

-- "Unworked" = never called: status new and zero attempts.
create or replace function public.reassign_unworked(p_from uuid, p_to uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if p_from is null or p_from is not distinct from p_to then
    raise exception 'invalid_selection' using errcode = 'P0001';
  end if;
  if p_to is not null and not exists (
    select 1 from public.profiles where id = p_to and role = 'caller' and active
  ) then
    raise exception 'invalid_target' using errcode = 'P0001';
  end if;

  update public.leads
     set assigned_to = p_to
   where assigned_to = p_from and status = 'new' and attempts = 0 and dnd = false;
  get diagnostics v_count = row_count;

  perform public.write_audit('reassign_unworked', 'profile', p_from::text,
    jsonb_build_object('from', p_from, 'to', p_to, 'count', v_count));
  return v_count;
end $$;

-- ---------------------------------------------------------------- execute grants
-- Internal helpers (write_audit, trigger functions) must not be callable by users.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.auth_role(), public.is_staff(), public.is_admin() to authenticated;
grant execute on function public.log_call(uuid, public.lead_status, text, timestamptz) to authenticated;
grant execute on function public.reassign_leads(uuid[], uuid) to authenticated;
grant execute on function public.reassign_unworked(uuid, uuid) to authenticated;
