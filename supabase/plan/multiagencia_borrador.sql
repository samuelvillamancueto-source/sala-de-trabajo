-- =====================================================================
-- Sala de Trabajo · BORRADOR multi-agencia (no aplicar tal cual)
-- Muestra el patrón en agencies, agency_members, clients y tasks. El resto de
-- tablas sigue el mismo molde (ver revision_backend.md, sección Multi-agencia).
-- Compilado en PostgreSQL 15 local, sobre schema + v3 + fixes, dentro de una
-- transacción revertida. Las cláusulas "on delete set null (col)" son de PG15+.
-- =====================================================================
begin;

create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

-- El rol pasa a ser POR AGENCIA (una persona puede ser editor en A y cliente en B).
create table public.agency_members (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin','editor','agent','client')),
  client_id uuid,                                  -- solo role = client
  active boolean not null default true,
  primary key (agency_id, user_id),
  check ((role = 'client') = (client_id is not null))
);
create index agency_members_user on public.agency_members(user_id);

-- Agencia inicial con todo lo existente (backfill).
insert into public.agencies(id, name) values ('00000000-0000-0000-0000-00000000a6e1', 'Agencia inicial');
insert into public.agency_members(agency_id, user_id, role, client_id)
  select '00000000-0000-0000-0000-00000000a6e1', p.id, p.role, m.client_id
    from public.profiles p left join public.client_members m on m.user_id = p.id;

-- agency_id en cada tabla (aquí clients y tasks; repetir en todas).
alter table public.clients add column agency_id uuid references public.agencies(id) on delete cascade;
alter table public.tasks   add column agency_id uuid references public.agencies(id) on delete cascade;
update public.clients set agency_id = '00000000-0000-0000-0000-00000000a6e1';
update public.tasks   set agency_id = '00000000-0000-0000-0000-00000000a6e1';
alter table public.clients alter column agency_id set not null;
alter table public.tasks   alter column agency_id set not null;

-- FKs compuestas: imposible enlazar una tarea con un cliente de otra agencia.
alter table public.clients add constraint clients_agency_uk unique (agency_id, id);
alter table public.agency_members add constraint agency_members_client_fk
  foreign key (agency_id, client_id) references public.clients(agency_id, id) on delete cascade;
alter table public.tasks drop constraint tasks_client_id_fkey;
alter table public.tasks add constraint tasks_client_same_agency
  foreign key (agency_id, client_id) references public.clients(agency_id, id) on delete set null (client_id);
alter table public.tasks add constraint tasks_agency_uk unique (agency_id, id);
-- assigned_to debe ser miembro de la misma agencia:
alter table public.tasks add constraint tasks_assignee_same_agency
  foreign key (agency_id, assigned_to) references public.agency_members(agency_id, user_id) on delete set null (assigned_to);

-- Índices con agency_id delante.
create index tasks_agency_assigned on public.tasks(agency_id, assigned_to);
create index tasks_agency_client   on public.tasks(agency_id, client_id);
create index tasks_agency_due      on public.tasks(agency_id, status, due);

-- Helpers (SECURITY DEFINER, search_path fijo, auth.uid() nulo => false).
create or replace function public.agency_role(p_agency uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role from public.agency_members m join public.profiles p on p.id = m.user_id
   where m.agency_id = p_agency and m.user_id = auth.uid() and m.active and p.active;
$$;
create or replace function public.has_agency_role(p_agency uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.agency_role(p_agency) = any(p_roles), false);
$$;
create or replace function public.agency_client(p_agency uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select m.client_id from public.agency_members m
   where m.agency_id = p_agency and m.user_id = auth.uid() and m.active and m.role = 'client';
$$;
revoke all on function public.agency_role(uuid), public.has_agency_role(uuid, text[]),
  public.agency_client(uuid) from public, anon;
grant execute on function public.agency_role(uuid), public.has_agency_role(uuid, text[]),
  public.agency_client(uuid) to authenticated;

-- RLS por agencia (sustituye las políticas globales).
alter table public.agency_members enable row level security;
alter table public.agency_members force row level security;
create policy am_read on public.agency_members for select
  using (user_id = (select auth.uid()) or public.has_agency_role(agency_id, '{admin}'));
create policy am_admin on public.agency_members for all
  using (public.has_agency_role(agency_id, '{admin}')) with check (public.has_agency_role(agency_id, '{admin}'));

drop policy if exists clients_admin on public.clients;
drop policy if exists clients_editor_read on public.clients;
drop policy if exists clients_client_read on public.clients;
create policy clients_admin on public.clients for all
  using (public.has_agency_role(agency_id, '{admin}')) with check (public.has_agency_role(agency_id, '{admin}'));
create policy clients_editor_read on public.clients for select
  using (public.has_agency_role(agency_id, '{editor}') and exists (
    select 1 from public.tasks t where t.agency_id = clients.agency_id
       and t.client_id = clients.id and t.assigned_to = (select auth.uid())));
create policy clients_client_read on public.clients for select
  using (id = public.agency_client(agency_id));

drop policy if exists tasks_admin on public.tasks;
drop policy if exists tasks_editor_read on public.tasks;
drop policy if exists tasks_agent_read on public.tasks;
create policy tasks_admin on public.tasks for all
  using (public.has_agency_role(agency_id, '{admin}')) with check (public.has_agency_role(agency_id, '{admin}'));
create policy tasks_editor_read on public.tasks for select
  using (public.has_agency_role(agency_id, '{editor}') and assigned_to = (select auth.uid()));
create policy tasks_agent_read on public.tasks for select
  using (public.has_agency_role(agency_id, '{agent}'));

rollback;   -- borrador: revertir
