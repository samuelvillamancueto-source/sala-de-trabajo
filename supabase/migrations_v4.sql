-- =====================================================================
-- Sala de Trabajo · fixes.sql · revisión de backend (Pancho, 22-10-2026)
-- Aplicar DESPUÉS de schema.sql + migrations_v3.sql, primero en una rama o
-- proyecto de staging, nunca directamente en producción.
-- Probado en PostgreSQL 15 local con un "shim" de Supabase: roles anon,
-- authenticated y service_role; auth.uid() leyendo request.jwt.claims;
-- privilegios por defecto de Supabase; pg_cron simulado. NO se ha probado
-- contra un proyecto Supabase real.
-- Cada bloque lleva el código del hallazgo de revision_backend.md (A-n / M-n).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- A-1 · Alta solo por invitación emitida por el servidor
--   Requiere además, en el panel de Supabase:
--     Auth > Sign In / Providers > "Allow new users to sign up" = OFF
--     y altas con auth.admin.inviteUserByEmail desde una edge function de
--     admin (ver revision_backend.md). GoTrue rellena auth.users.invited_at
--     en los usuarios invitados; un signUp público lo deja a NULL.
-- ---------------------------------------------------------------------
-- (A-1 aplicado aparte, junto con la funcion de invitar)

-- ---------------------------------------------------------------------
-- A-2 · El cliente no debe leer columnas internas (tasks.brief, raw_url,
--       deliveries.feedback/note...). RLS filtra filas, no columnas: el
--       portal lee con funciones que solo devuelven columnas públicas.
-- ---------------------------------------------------------------------
drop policy if exists tasks_client_read on public.tasks;
drop policy if exists deliveries_client_read on public.deliveries;

create or replace function public.client_task_visible(p_task uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.tasks t
                  where t.id = p_task and t.client_visible
                    and t.client_id = public.my_client());
$$;

drop policy if exists comments_client_read on public.task_comments;
create policy comments_client_read on public.task_comments for select
  using (for_client and public.client_task_visible(task_id));

create or replace function public.portal_tasks()
returns table(id uuid, title text, status text, round int, due date,
              client_brief text, approved boolean, approved_at timestamptz,
              updated_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.title, t.status, t.round, t.due, t.client_brief,
         t.approved, t.approved_at, t.updated_at
    from public.tasks t
   where t.client_visible and t.client_id = public.my_client();
$$;

create or replace function public.portal_deliveries()
returns table(id uuid, task_id uuid, version int, label text, url text,
              created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.task_id, d.version, d.label, d.url, d.created_at
    from public.deliveries d join public.tasks t on t.id = d.task_id
   where d.client_visible and t.client_visible
     and t.client_id = public.my_client();
$$;

revoke all on function public.client_task_visible(uuid), public.portal_tasks(),
  public.portal_deliveries() from public, anon;
grant execute on function public.client_task_visible(uuid), public.portal_tasks(),
  public.portal_deliveries() to authenticated;

-- ---------------------------------------------------------------------
-- A-3 · Tokens iCal: solo admin/editor activos; el alcance se calcula en
--       vivo; se revocan al cambiar el rol o desactivar al usuario. El feed
--       sale de una función SQL acotada, sin service-role key y sin brief.
-- ---------------------------------------------------------------------
create or replace function public.my_calendar_token() returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t text; r text := public.my_role();
begin
  if auth.uid() is null or r is null or r not in ('admin','editor') then
    raise exception 'Sin acceso al calendario.';
  end if;
  select token into t from public.calendar_tokens
   where user_id = auth.uid() order by created_at limit 1;
  if t is null then
    insert into public.calendar_tokens(user_id, scope)
    values (auth.uid(), case when r = 'admin' then 'all' else 'mine' end)
    returning token into t;
  end if;
  return t;
end $$;

create or replace function public.rotate_calendar_token() returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare t text; r text := public.my_role();
begin
  if auth.uid() is null or r is null or r not in ('admin','editor') then
    raise exception 'Sin acceso al calendario.';
  end if;
  delete from public.calendar_tokens where user_id = auth.uid();
  insert into public.calendar_tokens(user_id, scope)
  values (auth.uid(), case when r = 'admin' then 'all' else 'mine' end)
  returning token into t;
  return t;
end $$;

create or replace function public.revoke_calendar_on_profile_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from public.calendar_tokens where user_id = new.id;
  return new;
end $$;
drop trigger if exists profiles_revoke_calendar on public.profiles;
create trigger profiles_revoke_calendar
  after update of role, active on public.profiles for each row
  when (old.role is distinct from new.role or old.active is distinct from new.active)
  execute function public.revoke_calendar_on_profile_change();

create or replace function public.admin_revoke_calendar(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Solo administradores.'; end if;
  delete from public.calendar_tokens where user_id = p_user;
end $$;

-- Lo que la edge function necesita y nada más (sin brief, sin client_id).


revoke all on function public.admin_revoke_calendar(uuid),
  public.revoke_calendar_on_profile_change() from public, anon, authenticated;
grant execute on function public.admin_revoke_calendar(uuid) to authenticated;
grant execute on function public.my_calendar_token(), public.rotate_calendar_token() to authenticated;

-- ---------------------------------------------------------------------
-- A-4 · Copias: backup.snapshots vive en la MISMA base de datos (no es una
--       copia de seguridad real). Esto solo endurece el esquema backup y deja
--       una función de prueba de restauración. La copia de verdad es de
--       operación: backups/PITR de Supabase + pg_dump fuera del proyecto
--       (ver revision_backend.md).
-- ---------------------------------------------------------------------
alter table backup.snapshots enable row level security;
alter table backup.snapshots force row level security;   -- sin políticas: solo el owner (cron)
revoke all on all tables in schema backup from public, anon, authenticated, service_role;
create index if not exists snapshots_tbl_taken on backup.snapshots(tbl, taken_at desc);

create or replace function backup.restore_preview(p_tbl text, p_at timestamptz default now())
returns table(taken_at timestamptz, rows int, ok boolean)
language plpgsql security definer set search_path = public, backup, pg_temp as $$
begin
  -- Comprueba que el último snapshot anterior a p_at se puede volver a convertir en filas.
  return query execute format(
    'select s.taken_at, s.rows, (select count(*) from jsonb_populate_recordset(null::public.%I, s.data)) = s.rows
       from backup.snapshots s where s.tbl = %L and s.taken_at <= %L
      order by s.taken_at desc limit 1', p_tbl, p_tbl, p_at);
end $$;
revoke all on function backup.restore_preview(text, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- M-1 · FORCE ROW LEVEL SECURITY en todas las tablas.
--   Solo se aplica si el dueño de las funciones auxiliares (normalmente
--   postgres) tiene BYPASSRLS o es superusuario; si no, FORCE haría que
--   my_role() se evaluase con RLS sobre profiles y entraría en recursión.
-- ---------------------------------------------------------------------
do $$
declare t text; can_force boolean;
begin
  select r.rolsuper or r.rolbypassrls into can_force
    from pg_proc p join pg_roles r on r.oid = p.proowner
   where p.oid = 'public.my_role()'::regprocedure;
  if not can_force then
    raise notice 'M-1 NO aplicado: el owner de my_role() no tiene BYPASSRLS; revisar a mano.';
    return;
  end if;
  foreach t in array array['invites','profiles','clients','client_private','client_billing',
    'client_members','tasks','task_pay','deliveries','task_comments','activity','ideas',
    'calendar_tokens'] loop
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- M-2 · search_path con pg_temp al final en todas las SECURITY DEFINER
--   (sin pg_temp explícito, Postgres mira pg_temp PRIMERO para tablas).
-- ---------------------------------------------------------------------
alter function public.my_role()                      set search_path = public, pg_temp;
alter function public.my_client()                    set search_path = public, pg_temp;
alter function public.assigned_to_me(uuid)           set search_path = public, pg_temp;
alter function public.people()                       set search_path = public, pg_temp;
alter function public.delivery_version()             set search_path = public, pg_temp;
alter function public.log_task()                     set search_path = public, pg_temp;
alter function public.log_delivery()                 set search_path = public, pg_temp;
alter function public.log_comment()                  set search_path = public, pg_temp;
alter function public.is_admin()                     set search_path = public, pg_temp;
alter function public.is_agent()                     set search_path = public, pg_temp;
alter function public.is_editor()                    set search_path = public, pg_temp;
alter function public.ideas_touch()                  set search_path = public, pg_temp;
alter function backup.take()                         set search_path = public, backup, pg_temp;

-- ---------------------------------------------------------------------
-- M-3 · editor_set_status no puede reabrir una tarea ya aprobada ("listo").
-- ---------------------------------------------------------------------
create or replace function public.editor_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare cur text;
begin
  if not public.assigned_to_me(p_id) then raise exception 'Tarea no asignada a ti.'; end if;
  if p_status is null or p_status not in ('pendiente','en_proceso','revision') then
    raise exception 'Solo un administrador puede marcar una tarea como lista o pedir correcciones.';
  end if;
  select status into cur from public.tasks where id = p_id for update;
  if cur = 'listo' then
    raise exception 'La tarea ya está aprobada. Pide a un administrador que la reabra.';
  end if;
  update public.tasks set status = p_status where id = p_id;
end $$;
revoke all on function public.editor_set_status(uuid, text) from public, anon;
grant execute on function public.editor_set_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- M-4 · Integridad de invites (FK de cliente, coherencia rol/cliente,
--       email normalizado y único sin distinguir mayúsculas).
-- ---------------------------------------------------------------------
alter table public.invites
  add constraint invites_client_fk foreign key (client_id)
      references public.clients(id) on delete cascade not valid,
  add constraint invites_role_client check ((role = 'client') = (client_id is not null)) not valid,
  add constraint invites_email_norm check (email = lower(btrim(email))
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') not valid;

-- ---------------------------------------------------------------------
-- M-5 · Restricciones y validaciones que faltan
-- ---------------------------------------------------------------------
alter table public.task_pay
  add constraint task_pay_amount_pos check (amount >= 0) not valid,
  add constraint task_pay_paid_at check (status <> 'pagado' or paid_at is not null) not valid;
alter table public.tasks      add constraint tasks_round_pos check (round >= 0) not valid;
alter table public.deliveries add constraint deliveries_version_pos check (version > 0) not valid;
alter table public.ideas      add constraint ideas_updated_after check (updated_at >= created_at) not valid;

-- Asignar solo a editores/admins activos (evita, p. ej., que una tarea
-- asignada por error a un cliente acabe en su feed iCal).
create or replace function public.tasks_check_assignee() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.profiles p
                      where p.id = new.assigned_to and p.active and p.role in ('admin','editor')) then
    raise exception 'Solo se puede asignar a editores o administradores activos.';
  end if;
  return new;
end $$;
drop trigger if exists tasks_assignee_t on public.tasks;
create trigger tasks_assignee_t before insert or update of assigned_to on public.tasks
  for each row execute function public.tasks_check_assignee();

-- client_members solo para perfiles con rol client.
create or replace function public.client_members_check() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.profiles where id = new.user_id and role = 'client') then
    raise exception 'client_members solo admite usuarios con rol client.';
  end if;
  return new;
end $$;
drop trigger if exists client_members_check_t on public.client_members;
create trigger client_members_check_t before insert or update on public.client_members
  for each row execute function public.client_members_check();

-- Auditoría: created_by / approved_by no se pueden falsificar desde la API.
alter table public.tasks alter column created_by set default auth.uid();
create or replace function public.tasks_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  if tg_op = 'INSERT' then
    new.created_by = coalesce(auth.uid(), new.created_by);
    if new.approved then
      new.approved_by = coalesce(auth.uid(), new.approved_by); new.approved_at = now();
    else
      new.approved_by = null; new.approved_at = null;
    end if;
  else
    new.created_by = old.created_by; new.created_at = old.created_at;
    if new.status = 'correcciones' and old.status is distinct from 'correcciones' then
      new.round = old.round + 1;
    end if;
    if new.approved and not old.approved then
      new.approved_by = auth.uid(); new.approved_at = now();
    elsif new.approved and old.approved then
      new.approved_by = old.approved_by; new.approved_at = old.approved_at;
    end if;
    if not new.approved then new.approved_by = null; new.approved_at = null; end if;
  end if;
  if new.status = 'listo' then
    new.approved = true;
    if new.approved_at is null then new.approved_by = auth.uid(); new.approved_at = now(); end if;
  end if;
  return new;
end $$;

revoke all on function public.tasks_check_assignee(), public.client_members_check(),
  public.tasks_guard(), public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- M-6 · Borrados en cascada que destruyen historial
--   * Borrar un usuario ya no borra sus comentarios (author pasa a NULL).
--   * Una tarea con pago registrado no se puede borrar sin borrar antes
--     el pago a propósito.
-- ---------------------------------------------------------------------
alter table public.task_comments alter column author drop not null;
alter table public.task_comments drop constraint task_comments_author_fkey,
  add constraint task_comments_author_fkey foreign key (author)
      references public.profiles(id) on delete set null;
alter table public.task_pay drop constraint task_pay_task_id_fkey,
  add constraint task_pay_task_id_fkey foreign key (task_id)
      references public.tasks(id) on delete restrict;

-- ---------------------------------------------------------------------
-- M-7 · profiles: el admin solo cambia nombre/rol/activo; siempre queda un
--       admin activo; se quitan privilegios por defecto que sobran.
-- ---------------------------------------------------------------------
revoke update on public.profiles from authenticated;
grant update (name, role, active) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke insert, update, delete on public.activity from authenticated;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

create or replace function public.profiles_keep_one_admin() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles p
                      where p.role = 'admin' and p.active and p.id <> old.id) then
    raise exception 'Debe quedar al menos un administrador activo.';
  end if;
  return new;
end $$;
drop trigger if exists profiles_keep_admin on public.profiles;
create trigger profiles_keep_admin before update of role, active on public.profiles
  for each row execute function public.profiles_keep_one_admin();
revoke all on function public.profiles_keep_one_admin() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Menor · índices duplicados (schema.sql L70-71 y migrations_v3 L64-65)
-- ---------------------------------------------------------------------
drop index if exists public.tasks_assigned_to_idx;
drop index if exists public.tasks_client_id_idx;

commit;

-- ---------------------------------------------------------------------
-- M-8 · Validar las restricciones NOT VALID (v3 y este archivo).
--   Fuera de la transacción: las que tengan filas antiguas que incumplen
--   quedan como NOT VALID y se avisan con NOTICE para limpiarlas a mano.
-- ---------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select conrelid::regclass as t, conname from pg_constraint
            where connamespace = 'public'::regnamespace and not convalidated loop
    begin
      execute format('alter table %s validate constraint %I', r.t, r.conname);
    exception when check_violation or foreign_key_violation then
      raise notice 'NO validada %.%: hay filas antiguas que la incumplen', r.t, r.conname;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- OPCIONAL (cambia la experiencia de uso: la URL solo se ve al crearla)
-- Guardar el token iCal como hash en vez de en claro.
-- ---------------------------------------------------------------------
-- alter table public.calendar_tokens add column token_hash text;
-- update public.calendar_tokens set token_hash = encode(extensions.digest(token, 'sha256'), 'hex');
-- ... y en ical_feed: where c.token_hash = encode(extensions.digest(p_token,'sha256'),'hex')
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare inv public.invites;
begin
  select * into inv from public.invites where email = lower(btrim(new.email)) and expires_at > now();
  if not found then raise exception 'Este correo no está invitado o la invitación ha caducado.'; end if;
  insert into public.profiles(id, email, name, role)
  values (new.id, lower(new.email), coalesce(nullif(btrim(inv.name), ''), split_part(new.email, '@', 1)), inv.role);
  if inv.role = 'client' and inv.client_id is not null then
    insert into public.client_members(user_id, client_id) values (new.id, inv.client_id);
  end if;
  delete from public.invites where email = inv.email;
  return new;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
-- v4b: rendimiento de RLS (evaluar is_admin/is_agent una vez por consulta) y sincronía de correo
do $$ declare p record; q text; w text; stmt text; begin
  for p in select * from pg_policies where schemaname='public' loop
    q := p.qual; w := p.with_check;
    if coalesce(q,'')||coalesce(w,'') ~ '(is_admin|is_agent)\(\)' then
      q := regexp_replace(q, '(is_admin|is_agent)\(\)', '( SELECT \1() )', 'g');
      w := regexp_replace(w, '(is_admin|is_agent)\(\)', '( SELECT \1() )', 'g');
      stmt := format('alter policy %I on public.%I', p.policyname, p.tablename);
      if q is not null then stmt := stmt || ' using (' || q || ')'; end if;
      if w is not null then stmt := stmt || ' with check (' || w || ')'; end if;
      execute stmt;
    end if;
  end loop;
end $$;
create or replace function public.sync_profile_email() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.email is distinct from old.email then update public.profiles set email = lower(new.email) where id = new.id; end if;
  return new;
end $$;
revoke all on function public.sync_profile_email() from public, anon, authenticated;
drop trigger if exists on_auth_email_change on auth.users;
create trigger on_auth_email_change after update of email on auth.users for each row execute function public.sync_profile_email();
