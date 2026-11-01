revoke execute on all functions in schema private from public,anon;
grant execute on function private.is_admin(),private.can_manage(uuid,uuid),private.owns_report(uuid),private.can_read_report(uuid) to authenticated;
