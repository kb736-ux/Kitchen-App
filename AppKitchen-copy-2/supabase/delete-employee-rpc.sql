-- =============================================================================
-- SQL equivalent of the delete-employee Edge Function (public data + auth user)
-- =============================================================================
-- The Edge Function is TypeScript (Deno), not SQL. This file gives you a
-- Postgres RPC you can:
--   • Run once in Supabase → SQL Editor to CREATE the function
--   • Call manually: SELECT public.kk_delete_employee_from_org(
--       '<org_uuid>'::uuid,
--       'Employee Name',
--       NULL -- or '<auth.users.id>'::uuid if you already know it
--     );
--   • Optionally invoke from server/service role: supabase.rpc('kk_delete_employee_from_org', {...})
--
-- Deletes (when tables/columns exist): employee_positions, shifts, task_ingredients→tasks,
-- tasks, shift_requests, notifications, push_tokens, messages (sender), org_members (this org),
-- admin_users, admin_profiles, profiles (this org + name). Then deletes auth.users ONLY if
-- no other profiles row still references that user_id.
--
-- SECURITY: Revoked from PUBLIC; grant EXECUTE only to roles you trust (e.g. service_role).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.kk_delete_employee_from_org(
  p_org_id uuid,
  p_employee_name text,
  p_auth_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text := trim(both from coalesce(p_employee_name, ''));
  v_uid uuid := p_auth_user_id;
  v_remaining int; -- profiles still linked to auth user
  v_rc int; -- row count for last statement
  v_deleted text[] := ARRAY[]::text[];
  v_auth_deleted boolean := false;
  v_skip text;
BEGIN
  IF p_org_id IS NULL OR v_name = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'org_id and employee_name required'
    );
  END IF;

  IF v_uid IS NULL THEN
    SELECT p.user_id INTO v_uid
    FROM public.profiles p
    WHERE p.org_id = p_org_id
      AND lower(trim(both from coalesce(p.employee_name, ''))) = lower(v_name)
    LIMIT 1;
  END IF;

  -- 1. employee_positions
  DELETE FROM public.employee_positions ep
  WHERE ep.org_id = p_org_id
    AND lower(trim(both from coalesce(ep.employee_name, ''))) = lower(v_name);
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc > 0 THEN v_deleted := array_append(v_deleted, 'employee_positions'); END IF;

  -- 2. shifts
  DELETE FROM public.shifts s
  WHERE s.org_id = p_org_id
    AND lower(trim(both from coalesce(s.employee_name, ''))) = lower(v_name);
  GET DIAGNOSTICS v_rc = ROW_COUNT;
  IF v_rc > 0 THEN v_deleted := array_append(v_deleted, 'shifts'); END IF;

  -- 3. task_ingredients (rows tied to this employee’s tasks), then tasks
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'task_ingredients'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tasks'
  ) THEN
    DELETE FROM public.task_ingredients ti
    USING public.tasks t
    WHERE ti.task_id = t.id
      AND t.org_id = p_org_id
      AND lower(trim(both from coalesce(t.employee_name, ''))) = lower(v_name);
    DELETE FROM public.tasks t
    WHERE t.org_id = p_org_id
      AND lower(trim(both from coalesce(t.employee_name, ''))) = lower(v_name);
    v_deleted := array_append(v_deleted, 'tasks');
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tasks'
  ) THEN
    DELETE FROM public.tasks t
    WHERE t.org_id = p_org_id
      AND lower(trim(both from coalesce(t.employee_name, ''))) = lower(v_name);
    v_deleted := array_append(v_deleted, 'tasks');
  END IF;

  -- 4. shift_requests
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'shift_requests'
  ) THEN
    DELETE FROM public.shift_requests sr
    WHERE sr.org_id = p_org_id
      AND lower(trim(both from coalesce(sr.employee_name, ''))) = lower(v_name);
    v_deleted := array_append(v_deleted, 'shift_requests');
  END IF;

  -- 5. notifications
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'employee_name'
  ) THEN
    DELETE FROM public.notifications n
    WHERE n.org_id = p_org_id
      AND lower(trim(both from coalesce(n.employee_name, ''))) = lower(v_name);
    v_deleted := array_append(v_deleted, 'notifications');
  END IF;

  -- 6. push_tokens
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'push_tokens'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'push_tokens' AND column_name = 'employee_name'
  ) THEN
    DELETE FROM public.push_tokens pt
    WHERE pt.org_id = p_org_id
      AND lower(trim(both from coalesce(pt.employee_name, ''))) = lower(v_name);
    v_deleted := array_append(v_deleted, 'push_tokens');
  END IF;

  -- 7. messages (sender display name)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'messages'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'sender'
  ) THEN
    DELETE FROM public.messages m
    WHERE m.org_id = p_org_id
      AND lower(trim(both from coalesce(m.sender, ''))) = lower(v_name);
    v_deleted := array_append(v_deleted, 'messages');
  END IF;

  -- 8–10. Membership / admin flags (auth user id, NOT profiles.id)
  IF v_uid IS NOT NULL THEN
    DELETE FROM public.org_members om
    WHERE om.org_id = p_org_id AND om.user_id = v_uid;
    v_deleted := array_append(v_deleted, 'org_members');

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_users') THEN
      DELETE FROM public.admin_users au WHERE au.user_id = v_uid;
      v_deleted := array_append(v_deleted, 'admin_users');
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'admin_profiles') THEN
      DELETE FROM public.admin_profiles ap WHERE ap.user_id = v_uid;
      v_deleted := array_append(v_deleted, 'admin_profiles');
    END IF;
  END IF;

  -- 11. profiles (this org + name)
  DELETE FROM public.profiles p
  WHERE p.org_id = p_org_id
    AND lower(trim(both from coalesce(p.employee_name, ''))) = lower(v_name);
  v_deleted := array_append(v_deleted, 'profiles');

  -- 12. auth.users — only if no remaining profile uses this login
  IF v_uid IS NULL THEN
    v_skip := 'No auth user was linked to this employee (name-only / ghost row).';
  ELSE
    SELECT count(*)::int INTO v_remaining FROM public.profiles pr WHERE pr.user_id = v_uid;
    IF v_remaining = 0 THEN
      DELETE FROM auth.users u WHERE u.id = v_uid;
      IF FOUND THEN
        v_auth_deleted := true;
        v_deleted := array_append(v_deleted, 'auth.users');
      ELSE
        v_skip := 'auth.users row not found (already removed).';
      END IF;
    ELSE
      v_skip := format(
        'Auth user %s kept: %s other profile(s) still reference this login.',
        v_uid,
        v_remaining
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'deleted', to_jsonb(v_deleted),
    'employee_name', v_name,
    'user_id', v_uid,
    'auth_deleted', v_auth_deleted,
    'auth_skip_reason', v_skip
  );
END;
$$;

REVOKE ALL ON FUNCTION public.kk_delete_employee_from_org(uuid, text, uuid) FROM PUBLIC;
-- For Edge / backend only (optional):
GRANT EXECUTE ON FUNCTION public.kk_delete_employee_from_org(uuid, text, uuid) TO service_role;

COMMENT ON FUNCTION public.kk_delete_employee_from_org(uuid, text, uuid) IS
  'Removes an employee from one org and deletes auth.users if no other profiles remain. Mirrors delete-employee Edge Function.';
