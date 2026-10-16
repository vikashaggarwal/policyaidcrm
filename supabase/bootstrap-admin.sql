-- PolicyAid CRM: make your first admin.
--
-- 1. In Supabase: Authentication > Users > Add user > Create new user.
--      Email:    admin@YOUR-LOGIN-DOMAIN     (the same domain you set in NEXT_PUBLIC_LOGIN_DOMAIN)
--      Password: a strong one
--      Tick "Auto Confirm User".
-- 2. Edit the two values below, then run this file in the SQL Editor.
--
-- The admin then signs in to PolicyAid CRM with the login ID "admin" (the part before the @),
-- and creates every other user from the Users page. This file is only ever needed once.

insert into public.profiles (id, login_id, full_name, role, active)
select id, 'admin', 'Admin', 'admin', true
from auth.users
where email = 'admin@YOUR-LOGIN-DOMAIN'      -- <- change this
on conflict (id) do update set role = 'admin', active = true;

-- Should return one row. If it returns nothing, the email above doesn't match the user you created.
select login_id, role, active from public.profiles where role = 'admin';
