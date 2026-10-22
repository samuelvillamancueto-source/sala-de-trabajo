-- ===== v3: endurecimiento (ronda 1) =====
-- 1) Copias de seguridad lógicas diarias dentro del propio proyecto (14 días)
create extension if not exists pg_cron;
create schema if not exists backup;
revoke all on schema backup from public, anon, authenticated;
create table if not exists backup.snapshots (id bigserial primary key, taken_at timestamptz not null default now(), tbl text not null, rows int not null, data jsonb not null);
create or replace function backup.take() returns void language plpgsql security definer set search_path = public, backup as $$
declare t text; n int; d jsonb;
begin
  foreach t in array array['profiles','clients','client_private','client_billing','client_members','tasks','task_pay','deliveries','task_comments','activity','ideas','invites'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb), count(*) from public.%I x', t) into d, n;
    insert into backup.snapshots(tbl, rows, data) values (t, n, d);
  end loop;
  delete from backup.snapshots where taken_at < now() - interval '14 days';
end $$;
revoke all on function backup.take() from public, anon, authenticated;
select cron.unschedule('sala-backup') where exists (select 1 from cron.job where jobname='sala-backup');
select cron.schedule('sala-backup', '0 3 * * *', 'select backup.take()');

-- 2) Permisos: nada para anon; funciones internas no invocables por API
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke execute on functions from anon, public;
revoke execute on function public.delivery_version(), public.handle_new_user(), public.tasks_guard(), public.log_task(), public.log_delivery(), public.log_comment(), public.ideas_touch() from authenticated;
grant execute on function public.my_role(), public.my_client(), public.assigned_to_me(uuid), public.is_admin(), public.is_agent(), public.is_editor(), public.people(), public.editor_set_status(uuid,text), public.my_calendar_token() to authenticated;

-- 3) search_path fijo
alter function public.is_admin() set search_path = public;
alter function public.is_agent() set search_path = public;
alter function public.is_editor() set search_path = public;
alter function public.ideas_touch() set search_path = public;

-- 4) Politicas: auth.uid() evaluado una vez por consulta
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (id = (select auth.uid()) or public.is_admin());
drop policy clients_editor_read on public.clients;
create policy clients_editor_read on public.clients for select using (public.is_editor() and exists (select 1 from public.tasks t where t.client_id = clients.id and t.assigned_to = (select auth.uid())));
drop policy tasks_editor_read on public.tasks;
create policy tasks_editor_read on public.tasks for select using (public.is_editor() and assigned_to = (select auth.uid()));
drop policy deliveries_editor_insert on public.deliveries;
create policy deliveries_editor_insert on public.deliveries for insert with check (public.assigned_to_me(task_id) and created_by = (select auth.uid()) and feedback = '' and client_visible = false);
drop policy comments_editor_insert on public.task_comments;
create policy comments_editor_insert on public.task_comments for insert with check (public.assigned_to_me(task_id) and author = (select auth.uid()) and for_client = false);
drop policy comments_agent_insert on public.task_comments;
create policy comments_agent_insert on public.task_comments for insert with check (public.is_agent() and author = (select auth.uid()) and for_client = false);
-- tabla de tokens: sin acceso directo (solo via my_calendar_token y la funcion de calendario)
drop policy if exists calendar_tokens_none on public.calendar_tokens;
create policy calendar_tokens_none on public.calendar_tokens for select using (false);
revoke all on public.calendar_tokens from authenticated;

-- 5) Indices en claves foraneas
create index if not exists calendar_tokens_user on public.calendar_tokens(user_id);
create index if not exists client_members_client on public.client_members(client_id);
create index if not exists deliveries_task on public.deliveries(task_id);
create index if not exists deliveries_created_by on public.deliveries(created_by);
create index if not exists ideas_owner on public.ideas(owner_id);
create index if not exists ideas_proposed_by on public.ideas(proposed_by);
create index if not exists ideas_task on public.ideas(task_id);
create index if not exists ideas_status on public.ideas(status);
create index if not exists comments_task on public.task_comments(task_id);
create index if not exists comments_author on public.task_comments(author);
create index if not exists tasks_client on public.tasks(client_id);
create index if not exists tasks_assigned on public.tasks(assigned_to);
create index if not exists tasks_status_due on public.tasks(status, due);
create index if not exists tasks_approved_by on public.tasks(approved_by);
create index if not exists tasks_created_by on public.tasks(created_by);
create index if not exists activity_at on public.activity(at desc);
drop index if exists public.ideas_client;
create index if not exists ideas_client on public.ideas(client_id);

-- 6) Validacion en base de datos (no solo en la interfaz)
alter table public.tasks add constraint tasks_title_len check (char_length(btrim(title)) between 1 and 200) not valid;
alter table public.tasks add constraint tasks_brief_len check (char_length(coalesce(brief,'')) <= 8000 and char_length(coalesce(client_brief,'')) <= 4000) not valid;
alter table public.tasks add constraint tasks_urls check ((coalesce(reference_url,'') = '' or reference_url ~* '^https?://[^\s]+$') and (coalesce(raw_url,'') = '' or raw_url ~* '^https?://[^\s]+$') and char_length(coalesce(reference_url,'')) <= 2000 and char_length(coalesce(raw_url,'')) <= 2000) not valid;
alter table public.tasks add constraint tasks_tags_len check (coalesce(array_length(tags,1),0) <= 20) not valid;
alter table public.ideas add constraint ideas_title_len check (char_length(btrim(title)) between 1 and 200) not valid;
alter table public.ideas add constraint ideas_notes_len check (char_length(coalesce(notes,'')) <= 8000) not valid;
alter table public.ideas add constraint ideas_url check ((coalesce(reference_url,'') = '' or reference_url ~* '^https?://[^\s]+$') and char_length(coalesce(reference_url,'')) <= 2000) not valid;
alter table public.deliveries add constraint deliveries_url check (url ~* '^https?://[^\s]+$' and char_length(url) <= 2000) not valid;
alter table public.deliveries add constraint deliveries_text_len check (char_length(coalesce(note,'')) <= 2000 and char_length(coalesce(feedback,'')) <= 4000 and char_length(coalesce(label,'')) <= 100) not valid;
alter table public.task_comments add constraint comments_len check (char_length(btrim(body)) between 1 and 4000) not valid;
alter table public.clients add constraint clients_name_len check (char_length(btrim(name)) between 1 and 120) not valid;
alter table public.profiles add constraint profiles_name_len check (char_length(btrim(name)) between 1 and 120) not valid;
create or replace function public.rotate_calendar_token() returns text language plpgsql security definer set search_path = public, extensions as $$
declare t text; r text;
begin
  if auth.uid() is null then raise exception 'no auth'; end if;
  delete from calendar_tokens where user_id = auth.uid();
  select role into r from profiles where id = auth.uid();
  insert into calendar_tokens(user_id, scope) values (auth.uid(), case when r='admin' then 'all' else 'mine' end) returning token into t;
  return t;
end $$;
revoke all on function public.rotate_calendar_token() from public, anon;
grant execute on function public.rotate_calendar_token() to authenticated;
