-- Sala de Trabajo v2: esquema, roles y permisos (Supabase / Postgres)
-- Roles: admin (todo) | editor (solo lo asignado) | agent (Instinct: tareas y actividad, sin clientes) | client (portal, solo lectura, un cliente)

-- ---------- Tablas ----------
create table public.invites (
  email text primary key,
  name text,
  role text not null default 'editor' check (role in ('admin','editor','agent','client')),
  client_id uuid,                                   -- solo role = client
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text,
  role text not null check (role in ('admin','editor','agent','client')),
  active boolean not null default true,
  created_at timestamptz default now()
);

create table public.clients (               -- visible para admin y para editores con tareas asignadas: solo nombre
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'recurrente' check (kind in ('recurrente','puntual')),
  created_at timestamptz default now()
);
create table public.client_private (        -- SOLO admins
  client_id uuid primary key references public.clients(id) on delete cascade,
  status text not null default 'activo' check (status in ('prospecto','activo','pausado','cerrado')),
  contact_name text default '', contact_email text default '', contact_phone text default '',
  rate text default '', rounds int default 2, deadline_days int default 5, payment_terms text default '',
  contract_url text default '', drive_url text default '',
  socials text default '',                  -- enlaces a perfiles; nunca contrasenas
  origin text default '', since date,
  notes text default ''
);
create table public.client_billing (        -- SOLO admins
  client_id uuid primary key references public.clients(id) on delete cascade,
  legal_name text default '', tax_id text default '', address text default '', billing_email text default ''
);
create table public.client_members (        -- portal futuro: que usuario cliente ve que cliente
  user_id uuid primary key references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client_id uuid references public.clients(id) on delete set null,
  status text not null default 'pendiente' check (status in ('pendiente','en_proceso','revision','correcciones','listo')),
  round int not null default 0,                     -- rondas de correcciones usadas
  priority text not null default 'media' check (priority in ('baja','media','alta')),
  due date,
  tags text[] default '{}',
  brief text default '',                            -- interno
  client_brief text default '',                     -- lo que vera el cliente
  reference_url text default '',
  raw_url text default '',
  approved boolean not null default false,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  client_visible boolean not null default false,
  assigned_to uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on public.tasks(assigned_to);
create index on public.tasks(client_id);

create table public.task_pay (              -- pago a editores: admin escribe; el editor ve lo suyo
  task_id uuid primary key references public.tasks(id) on delete cascade,
  amount numeric(10,2) not null default 0,
  status text not null default 'pendiente' check (status in ('pendiente','pagado')),
  paid_at date
);

create table public.deliveries (            -- entregas versionadas con feedback
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  version int not null,
  label text not null default '',           -- v1, v2... o final
  url text not null,
  note text default '',
  feedback text default '',                 -- lo escribe un admin
  client_visible boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz default now(),
  unique (task_id, version)
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  for_client boolean not null default false,
  created_at timestamptz default now()
);

create table public.activity (              -- nunca visible para clientes ni editores
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  task_id uuid,
  actor uuid,
  summary text not null
);

-- ---------- Funciones auxiliares (security definer, sin recursion de RLS) ----------
create or replace function public.my_role() returns text
language sql security definer set search_path = public stable as $$
  select role from public.profiles where id = auth.uid() and active;
$$;
create or replace function public.is_admin() returns boolean language sql stable as $$ select coalesce(public.my_role() = 'admin', false) $$;
create or replace function public.is_agent() returns boolean language sql stable as $$ select coalesce(public.my_role() = 'agent', false) $$;
create or replace function public.is_editor() returns boolean language sql stable as $$ select coalesce(public.my_role() = 'editor', false) $$;
create or replace function public.my_client() returns uuid
language sql security definer set search_path = public stable as $$
  select m.client_id from public.client_members m join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid() and p.role = 'client' and p.active;
$$;
create or replace function public.assigned_to_me(p_task uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select public.is_editor() and exists (select 1 from public.tasks t where t.id = p_task and t.assigned_to = auth.uid());
$$;

-- ---------- Alta: solo con invitacion vigente ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv public.invites;
begin
  select * into inv from public.invites where lower(email) = lower(new.email) and expires_at > now();
  if inv.email is null then
    raise exception 'Este correo no esta invitado o la invitacion ha caducado. Pide a un administrador que te invite.';
  end if;
  insert into public.profiles(id, email, name, role) values (new.id, lower(new.email), coalesce(inv.name, split_part(new.email,'@',1)), inv.role);
  if inv.role = 'client' and inv.client_id is not null then
    insert into public.client_members(user_id, client_id) values (new.id, inv.client_id);
  end if;
  delete from public.invites where email = inv.email;   -- invitacion de un solo uso
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- ---------- Triggers de integridad ----------
create or replace function public.tasks_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at = now();
  if tg_op = 'UPDATE' then
    if new.status = 'correcciones' and old.status is distinct from 'correcciones' then new.round = old.round + 1; end if;
    if new.approved and not old.approved then new.approved_by = auth.uid(); new.approved_at = now(); end if;
    if not new.approved then new.approved_by = null; new.approved_at = null; end if;
  end if;
  if new.status = 'listo' then new.approved = true; if new.approved_at is null then new.approved_by = auth.uid(); new.approved_at = now(); end if; end if;
  return new;
end $$;
create trigger tasks_guard_t before insert or update on public.tasks for each row execute function public.tasks_guard();

create or replace function public.delivery_version() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.version is null or new.version = 0 then
    select coalesce(max(version),0)+1 into new.version from public.deliveries where task_id = new.task_id;
  end if;
  if new.label is null or new.label = '' then new.label = 'v' || new.version; end if;
  return new;
end $$;
create trigger deliveries_version before insert on public.deliveries for each row execute function public.delivery_version();

-- ---------- RLS en TODAS las tablas ----------
alter table public.invites enable row level security;
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_private enable row level security;
alter table public.client_billing enable row level security;
alter table public.client_members enable row level security;
alter table public.tasks enable row level security;
alter table public.task_pay enable row level security;
alter table public.deliveries enable row level security;
alter table public.task_comments enable row level security;
alter table public.activity enable row level security;

create policy invites_admin on public.invites for all using (public.is_admin()) with check (public.is_admin());

create policy profiles_read on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy profiles_admin_update on public.profiles for update using (public.is_admin()) with check (public.is_admin());

create policy clients_admin on public.clients for all using (public.is_admin()) with check (public.is_admin());
create policy clients_editor_read on public.clients for select using (
  public.is_editor() and exists (select 1 from public.tasks t where t.client_id = clients.id and t.assigned_to = auth.uid()));
create policy clients_client_read on public.clients for select using (id = public.my_client());
create policy client_private_admin on public.client_private for all using (public.is_admin()) with check (public.is_admin());
create policy client_billing_admin on public.client_billing for all using (public.is_admin()) with check (public.is_admin());
create policy client_members_admin on public.client_members for all using (public.is_admin()) with check (public.is_admin());

create policy tasks_admin on public.tasks for all using (public.is_admin()) with check (public.is_admin());
create policy tasks_editor_read on public.tasks for select using (public.is_editor() and assigned_to = auth.uid());
create policy tasks_agent_read on public.tasks for select using (public.is_agent());
create policy tasks_client_read on public.tasks for select using (client_visible and client_id = public.my_client());

create policy task_pay_admin on public.task_pay for all using (public.is_admin()) with check (public.is_admin());
create policy task_pay_editor_read on public.task_pay for select using (public.assigned_to_me(task_id));

create policy deliveries_admin on public.deliveries for all using (public.is_admin()) with check (public.is_admin());
create policy deliveries_editor_read on public.deliveries for select using (public.assigned_to_me(task_id));
create policy deliveries_editor_insert on public.deliveries for insert with check (public.assigned_to_me(task_id) and created_by = auth.uid() and feedback = '' and client_visible = false);
create policy deliveries_agent_read on public.deliveries for select using (public.is_agent());
create policy deliveries_client_read on public.deliveries for select using (
  client_visible and exists (select 1 from public.tasks t where t.id = task_id and t.client_visible and t.client_id = public.my_client()));

create policy comments_admin on public.task_comments for all using (public.is_admin()) with check (public.is_admin());
create policy comments_editor_read on public.task_comments for select using (public.assigned_to_me(task_id));
create policy comments_editor_insert on public.task_comments for insert with check (public.assigned_to_me(task_id) and author = auth.uid() and for_client = false);
create policy comments_agent_read on public.task_comments for select using (public.is_agent());
create policy comments_agent_insert on public.task_comments for insert with check (public.is_agent() and author = auth.uid() and for_client = false);
create policy comments_client_read on public.task_comments for select using (
  for_client and exists (select 1 from public.tasks t where t.id = task_id and t.client_visible and t.client_id = public.my_client()));

create policy activity_read on public.activity for select using (public.is_admin() or public.is_agent());

-- ---------- Acciones del editor (RPC acotadas; el editor no tiene UPDATE directo) ----------
create or replace function public.editor_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.assigned_to_me(p_id) then raise exception 'Tarea no asignada a ti.'; end if;
  if p_status not in ('pendiente','en_proceso','revision') then raise exception 'Solo un administrador puede marcar una tarea como lista o pedir correcciones.'; end if;
  update public.tasks set status = p_status where id = p_id;
end $$;

create or replace function public.people() returns table(id uuid, name text, role text)
language sql security definer set search_path = public stable as $$
  select id, name, role from public.profiles where active and role in ('admin','editor','agent')
    and public.my_role() in ('admin','editor','agent');
$$;

-- ---------- Actividad (para avisos a los Instinct) ----------
create or replace function public.log_task() returns trigger language plpgsql security definer set search_path = public as $$
declare who text; a uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.activity(kind,task_id,actor,summary) values ('tarea_nueva', new.id, a, 'Nueva tarea: ' || new.title);
    if new.assigned_to is not null then
      select name into who from public.profiles where id = new.assigned_to;
      insert into public.activity(kind,task_id,actor,summary) values ('asignada', new.id, a, new.title || ' asignada a ' || coalesce(who,'?'));
    end if;
  else
    if new.assigned_to is distinct from old.assigned_to then
      select name into who from public.profiles where id = new.assigned_to;
      insert into public.activity(kind,task_id,actor,summary) values ('asignada', new.id, a, new.title || ' asignada a ' || coalesce(who,'nadie'));
    end if;
    if new.status is distinct from old.status then
      insert into public.activity(kind,task_id,actor,summary) values ('estado', new.id, a, new.title || ': ' || old.status || ' -> ' || new.status);
    end if;
    if new.approved and not old.approved then
      insert into public.activity(kind,task_id,actor,summary) values ('aprobada', new.id, a, 'Aprobada: ' || new.title);
    end if;
  end if;
  return new;
end $$;
create trigger tasks_log after insert or update on public.tasks for each row execute function public.log_task();

create or replace function public.log_delivery() returns trigger language plpgsql security definer set search_path = public as $$
declare t text;
begin
  select title into t from public.tasks where id = new.task_id;
  insert into public.activity(kind,task_id,actor,summary) values ('entrega', new.task_id, new.created_by, 'Entrega ' || new.label || ' en ' || coalesce(t,'?'));
  return new;
end $$;
create trigger deliveries_log after insert on public.deliveries for each row execute function public.log_delivery();

create or replace function public.log_comment() returns trigger language plpgsql security definer set search_path = public as $$
declare t text; n text;
begin
  select title into t from public.tasks where id = new.task_id;
  select name into n from public.profiles where id = new.author;
  insert into public.activity(kind,task_id,actor,summary) values ('comentario', new.task_id, new.author, coalesce(n,'?') || ' comento en ' || coalesce(t,'?') || ': ' || left(new.body, 140));
  return new;
end $$;
create trigger comments_log after insert on public.task_comments for each row execute function public.log_comment();

-- ---------- Permisos de tabla (RLS decide las filas) ----------
grant usage on schema public to authenticated;
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon, public;
grant select, insert, update, delete on public.invites, public.clients, public.client_private, public.client_billing, public.client_members, public.tasks, public.task_pay, public.deliveries, public.task_comments to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.activity to authenticated;
grant execute on function public.people(), public.editor_set_status(uuid,text), public.is_admin(), public.is_agent(), public.is_editor(), public.my_role(), public.my_client(), public.assigned_to_me(uuid) to authenticated;

-- Semilla (cambiar correos): insert into public.invites(email,name,role) values ('CORREO_SAMUEL','Samuel','admin');
create table if not exists public.calendar_tokens (
  token text primary key default encode(gen_random_bytes(24),'hex'),
  user_id uuid references public.profiles(id) on delete cascade,
  scope text not null default 'mine' check (scope in ('mine','all')),
  label text default '',
  created_at timestamptz default now()
);
alter table public.calendar_tokens enable row level security;
create or replace function public.my_calendar_token() returns text language plpgsql security definer set search_path=public,extensions as $$
declare t text; r text;
begin
  if auth.uid() is null then raise exception 'no auth'; end if;
  select token into t from calendar_tokens where user_id=auth.uid() order by created_at limit 1;
  if t is null then
    select role into r from profiles where id=auth.uid();
    insert into calendar_tokens(user_id,scope) values (auth.uid(), case when r='admin' then 'all' else 'mine' end) returning token into t;
  end if;
  return t;
end $$;
revoke all on function public.my_calendar_token() from public, anon;
grant execute on function public.my_calendar_token() to authenticated;
create table if not exists public.ideas (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  client_id uuid references public.clients(id) on delete set null,
  kind text not null default 'viral' check (kind in ('viral','tendencia','copy','campana','otro')),
  format text not null default 'reel' check (format in ('reel','tiktok','story','carrusel','post','meme','email','anuncio','otro')),
  status text not null default 'nueva' check (status in ('nueva','aprobada','en_produccion','publicada','descartada')),
  owner_id uuid references public.profiles(id) on delete set null,
  proposed_by uuid references public.profiles(id) on delete set null default auth.uid(),
  reference_url text default '',
  notes text default '',
  task_id uuid references public.tasks(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists ideas_client on public.ideas(client_id);
alter table public.ideas enable row level security;
drop policy if exists ideas_admin on public.ideas;
create policy ideas_admin on public.ideas for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists ideas_agent_read on public.ideas;
create policy ideas_agent_read on public.ideas for select using (public.is_agent());
create or replace function public.ideas_touch() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists ideas_touch on public.ideas;
create trigger ideas_touch before update on public.ideas for each row execute function public.ideas_touch();
