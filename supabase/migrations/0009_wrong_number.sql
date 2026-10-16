-- PolicyAid CRM: "Wrong number" outcome.
-- Like do-not-call, it removes the lead from the caller's queue for good, but it is NOT a legal
-- do-not-call flag (the person never asked to be left alone, the number just doesn't reach them).
-- Differences from do-not-call:
--   * it never sets the dnd flag, so the number can still be loaded or added later (e.g. once corrected)
--   * managers and admins can reopen it
--   * other not-yet-worked leads on the same number are marked too, so nobody rings it twice
-- New logic compares the status as text so this file can run in one go (Postgres will not let a
-- freshly added enum value be used by literal inside the same transaction).

alter type public.lead_status add value if not exists 'wrong_number';

-- Callers never see wrong-number leads, exactly like do-not-call leads.
drop policy if exists leads_select_caller on public.leads;
create policy leads_select_caller on public.leads for select to authenticated
  using (
    public.auth_role() = 'caller'
    and assigned_to = auth.uid()
    and dnd = false
    and status::text not in ('do_not_call', 'wrong_number')
  );

-- Closed statuses (never part of the to-do list).
create or replace function public.queue_bucket(
  p_status public.lead_status, p_callback_at timestamptz, p_now timestamptz default now()
) returns smallint
language sql immutable
as $$
  select (case
    when p_status::text in ('sold', 'not_interested', 'do_not_call', 'wrong_number') then 6
    when p_callback_at is not null and p_callback_at <= p_now then 1
    when p_status = 'new' then 2
    when p_status = 'no_answer' then 3
    when p_callback_at is not null then 4
    else 5
  end)::smallint
$$;

-- Same function as before, plus the wrong-number outcome.
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
  if v_lead.status::text = 'wrong_number' then
    raise exception 'lead_wrong_number' using errcode = 'P0001';
  end if;
  if p_outcome = 'new' then
    raise exception 'invalid_outcome' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'note_too_long' using errcode = 'P0001';
  end if;

  -- closed outcomes never carry a callback
  if p_outcome::text in ('sold', 'not_interested', 'do_not_call', 'wrong_number') then
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

  -- A wrong number is wrong for every vehicle on it: close the ones nobody has finished with.
  if p_outcome::text = 'wrong_number' then
    update public.leads
       set status = p_outcome, callback_at = null
     where phone = v_lead.phone and id <> v_lead.id
       and status::text in ('new', 'no_answer', 'callback');
    perform public.write_audit('wrong_number', 'lead', v_lead.id::text,
                               jsonb_build_object('reg_no', v_lead.reg_no));
  end if;

  return v_lead;
end $$;

-- A manager can put wrong-number leads back to "new" (mis-tap, or the number was corrected).
create or replace function public.reopen_leads(p_lead_ids uuid[])
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

  update public.leads
     set status = 'new', callback_at = null
   where id = any (p_lead_ids) and status::text = 'wrong_number';
  get diagnostics v_count = row_count;

  perform public.write_audit('reopen_leads', 'lead', null,
    jsonb_build_object('count', v_count, 'sample_ids', to_jsonb(p_lead_ids[1:20])));
  return v_count;
end $$;

revoke execute on function public.reopen_leads(uuid[]) from public, anon;
grant execute on function public.reopen_leads(uuid[]) to authenticated;
