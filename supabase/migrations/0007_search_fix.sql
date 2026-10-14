-- Fix: a search like "R0007" (part of a registration number) was also matched against mobile numbers
-- because its digits were extracted. Digits only count as a phone search when the whole search is
-- a number (spaces, dashes, brackets and + allowed).
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
      or p_reg_no ilike reg_pattern escape '\'
      or (numeric_only and length(digits) >= 3 and p_phone like '%' || digits || '%')
  from p
$$;
