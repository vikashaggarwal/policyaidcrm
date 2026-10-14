-- Dial Desk: upload batches are opened and closed through functions, so the audit entry is written
-- once, at the end, with the real number of leads added (counted here, not trusted from the browser).

alter table public.upload_batches add column finished_at timestamptz;

drop trigger if exists upload_batches_audit on public.upload_batches;
drop function if exists public.audit_upload();
drop policy if exists batches_insert_staff on public.upload_batches;

create or replace function public.begin_upload(p_filename text, p_total_rows integer)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := left(trim(coalesce(p_filename, '')), 255);
  v_id   uuid;
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v_name = '' or p_total_rows is null or p_total_rows < 0 or p_total_rows > 100000 then
    raise exception 'invalid_upload' using errcode = 'P0001';
  end if;
  insert into public.upload_batches (uploaded_by, filename, total_rows)
  values (auth.uid(), v_name, p_total_rows)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.finish_upload(p_batch uuid, p_duplicates integer, p_invalid integer)
returns public.upload_batches
language plpgsql security definer set search_path = public
as $$
declare v_batch public.upload_batches;
begin
  if not public.is_staff() then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  select * into v_batch from public.upload_batches where id = p_batch for update;
  if not found or (v_batch.uploaded_by <> auth.uid() and not public.is_admin()) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;
  if v_batch.finished_at is not null then
    raise exception 'already_finished' using errcode = 'P0001';
  end if;

  update public.upload_batches
     set added       = (select count(*) from public.leads where batch_id = p_batch),
         duplicates  = greatest(coalesce(p_duplicates, 0), 0),
         invalid     = greatest(coalesce(p_invalid, 0), 0),
         finished_at = now()
   where id = p_batch
   returning * into v_batch;

  perform public.write_audit('upload', 'upload_batch', v_batch.id::text,
    jsonb_build_object('filename', v_batch.filename, 'total_rows', v_batch.total_rows,
                       'added', v_batch.added, 'duplicates', v_batch.duplicates, 'invalid', v_batch.invalid));
  return v_batch;
end $$;

revoke execute on function public.begin_upload(text, integer), public.finish_upload(uuid, integer, integer)
  from public, anon;
grant execute on function public.begin_upload(text, integer) to authenticated;
grant execute on function public.finish_upload(uuid, integer, integer) to authenticated;

-- Which of these registration numbers are already in the system? Runs as the caller (RLS applies).
create or replace function public.existing_reg_nos(p_reg_nos text[])
returns setof text
language sql stable security invoker set search_path = public
as $$ select reg_no from public.leads where reg_no = any (p_reg_nos) $$;

revoke execute on function public.existing_reg_nos(text[]) from public, anon;
grant execute on function public.existing_reg_nos(text[]) to authenticated;
