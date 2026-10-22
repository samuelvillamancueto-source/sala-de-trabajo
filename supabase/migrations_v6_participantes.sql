-- v6: varios participantes por tarea (assigned_to = responsable principal; also_assigned = participantes)
alter table public.tasks add column if not exists also_assigned uuid[] not null default '{}';
alter table public.tasks drop constraint if exists tasks_also_assigned_max;
alter table public.tasks add constraint tasks_also_assigned_max check (cardinality(also_assigned) <= 10);
create or replace function public.assigned_to_me(p_task uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_editor() and exists (select 1 from public.tasks t where t.id = p_task and (t.assigned_to = auth.uid() or auth.uid() = any(t.also_assigned)));
$$;
drop policy if exists tasks_editor_read on public.tasks;
create policy tasks_editor_read on public.tasks for select using ((select public.is_editor()) and (assigned_to = (select auth.uid()) or (select auth.uid()) = any(also_assigned)));
create or replace function public.tasks_check_assignee() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.profiles p where p.id = new.assigned_to and p.active and p.role in ('admin','editor')) then
    raise exception 'Solo se puede asignar a editores o administradores activos.';
  end if;
  -- sin duplicados, sin el responsable repetido y solo personas activas del equipo
  new.also_assigned := coalesce((select array_agg(distinct u) from unnest(new.also_assigned) u where u is distinct from new.assigned_to), '{}');
  if (tg_op = 'INSERT' or new.also_assigned is distinct from old.also_assigned)
     and exists (select 1 from unnest(new.also_assigned) u where not exists (select 1 from public.profiles p where p.id = u and p.active and p.role in ('admin','editor'))) then
    raise exception 'Los participantes deben ser editores o administradores activos.';
  end if;
  return new;
end $$;
