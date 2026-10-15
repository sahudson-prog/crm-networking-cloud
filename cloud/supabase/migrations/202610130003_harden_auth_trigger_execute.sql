-- Keep the auth-user trigger function private to its postgres owner.

begin;

revoke execute on function public.handle_new_auth_user_profile()
  from public, anon, authenticated, service_role, supabase_auth_admin;

commit;
