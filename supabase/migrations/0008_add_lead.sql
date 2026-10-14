-- Dial Desk: callers can add a lead they have found themselves.
-- Only name and mobile number are compulsory, so the registration number becomes optional
-- (still unique when present; leads without one are matched by mobile number instead).

alter table public.leads alter column reg_no drop not null;
alter table public.leads drop constraint leads_reg_no_clean;
alter table public.leads add constraint leads_reg_no_clean
  check (reg_no is null or (reg_no = upper(reg_no) and reg_no ~ '^[A-Z0-9]{4,15}$'));

-- Search must cope with leads that have no registration number.
create or replace function public.lead_matches_search(
  p_search text, p_name text, p_city text, p_reg_no text, p_phone text
) returns boolean
language sql immutable
as $$
  with s as (
    select left(trim(coalesce(p_search, '')), 60) as raw
  ), p as (
    select
      raw,
      '%' || replace(replace(replace(raw, '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern,
      '%' || replace(replace(replace(upper(regexp_replace(raw, '[\s\-]', '', 'g')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as reg_pattern,
      regexp_replace(raw, '\D', '', 'g') as digits,
      raw ~ '^[0-9 +().-]+$' as numeric_only
    from s
  )
  select raw = ''
      or p_name ilike pattern escape '\'
      or coalesce(p_city, '') ilike pattern escape '\'
      or coalesce(p_reg_no, '') ilike reg_pattern escape '\'
      or (numeric_only and length(digits) >= 3 and p_phone like '%' || digits || '%')
  from p
$$;

create or replace function public.add_lead(p_lead jsonb)
returns public.leads
language plpgsql security definer set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_name  text := nullif(regexp_replace(trim(coalesce(p_lead ->> 'name', '')), '\s+', ' ', 'g'), '');
  v_phone text := regexp_replace(coalesce(p_lead ->> 'phone', ''), '\D', '', 'g');
  v_reg   text := nullif(upper(regexp_replace(coalesce(p_lead ->> 'reg_no', ''), '[\s\-._]', '', 'g')), '');
  v_date  date;
  v_sale  numeric;
  v_seats integer;
  v_lead  public.leads;
  t       text;
begin
  if v_uid is null or public.auth_role() is distinct from 'caller' then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  if v_name is null or length(v_name) > 120 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  -- same clean-up as the app: +91 / 91 / 0091 / leading 0
  if length(v_phone) = 14 and left(v_phone, 4) = '0091' then v_phone := substr(v_phone, 5);
  elsif length(v_phone) = 12 and left(v_phone, 2) = '91' then v_phone := substr(v_phone, 3);
  elsif length(v_phone) = 11 and left(v_phone, 1) = '0' then v_phone := substr(v_phone, 2);
  end if;
  if v_phone !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid_phone' using errcode = 'P0001';
  end if;
  if v_reg is not null and v_reg !~ '^[A-Z0-9]{4,15}$' then
    raise exception 'invalid_reg_no' using errcode = 'P0001';
  end if;

  t := nullif(trim(coalesce(p_lead ->> 'reg_date', '')), '');
  if t is not null then
    begin
      v_date := t::date;
    exception when others then
      raise exception 'invalid_date' using errcode = 'P0001';
    end;
    if v_date < date '1980-01-01' or v_date > date '2100-12-31' then
      raise exception 'invalid_date' using errcode = 'P0001';
    end if;
  end if;

  t := nullif(trim(coalesce(p_lead ->> 'sale_amount', '')), '');
  if t is not null and t ~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then v_sale := t::numeric; end if;
  t := nullif(trim(coalesce(p_lead ->> 'seat_capacity', '')), '');
  if t is not null and t ~ '^[0-9]{1,3}$' and t::integer <= 200 then v_seats := t::integer; end if;

  -- Never add a number that has asked not to be called, whichever vehicle it was on.
  if exists (select 1 from public.leads where phone = v_phone and (dnd or status = 'do_not_call')) then
    raise exception 'lead_blocked' using errcode = 'P0001';
  end if;
  if v_reg is not null then
    if exists (select 1 from public.leads where reg_no = v_reg) then
      raise exception 'duplicate_vehicle' using errcode = 'P0001';
    end if;
  elsif exists (select 1 from public.leads where phone = v_phone) then
    raise exception 'duplicate_phone' using errcode = 'P0001';
  end if;

  insert into public.leads (
    name, phone, reg_no, reg_date, guardian_name, state, rto_code, address, city,
    engine_no, chassis_no, vehicle_make, vehicle_model, vehicle_class, fuel, sale_amount, seat_capacity,
    source, assigned_to
  ) values (
    v_name, v_phone, v_reg, v_date,
    left(nullif(trim(p_lead ->> 'guardian_name'), ''), 120),
    left(nullif(trim(p_lead ->> 'state'), ''), 60),
    upper(left(nullif(trim(p_lead ->> 'rto_code'), ''), 20)),
    left(nullif(trim(p_lead ->> 'address'), ''), 500),
    left(nullif(trim(p_lead ->> 'city'), ''), 80),
    upper(left(nullif(trim(p_lead ->> 'engine_no'), ''), 40)),
    upper(left(nullif(trim(p_lead ->> 'chassis_no'), ''), 40)),
    left(nullif(trim(p_lead ->> 'vehicle_make'), ''), 80),
    left(nullif(trim(p_lead ->> 'vehicle_model'), ''), 120),
    left(nullif(trim(p_lead ->> 'vehicle_class'), ''), 60),
    left(nullif(trim(p_lead ->> 'fuel'), ''), 30),
    v_sale, v_seats,
    'Added by caller', v_uid
  ) returning * into v_lead;

  perform public.write_audit('add_lead', 'lead', v_lead.id::text, jsonb_build_object('reg_no', v_lead.reg_no));
  return v_lead;
end $$;

revoke execute on function public.add_lead(jsonb) from public, anon;
grant execute on function public.add_lead(jsonb) to authenticated;
