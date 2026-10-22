-- v7: tareas generales + "vídeo para editar" (tareas de edición). Una sola tabla: el estado es el mismo, no hay nada que sincronizar.
alter table public.tasks add column if not exists is_video boolean not null default false;
update public.tasks set is_video = true where title in ('Vídeo de Bravo: edición en horizontal','Vídeo de Black Boys','Llados: color y unir vídeos del evento') and is_video = false;
create index if not exists tasks_video_idx on public.tasks (is_video) where is_video;
-- los editores solo ven tareas de edición asignadas a ellos
drop policy if exists tasks_editor_read on public.tasks;
create policy tasks_editor_read on public.tasks for select using ((select public.is_editor()) and is_video and (assigned_to = (select auth.uid()) or (select auth.uid()) = any(also_assigned)));
create or replace function public.assigned_to_me(p_task uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_editor() and exists (select 1 from public.tasks t where t.id = p_task and t.is_video and (t.assigned_to = auth.uid() or auth.uid() = any(t.also_assigned)));
$$;
-- un editor solo puede ser responsable/participante de tareas de edición
create or replace function public.tasks_check_assignee() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and not exists (select 1 from public.profiles p where p.id = new.assigned_to and p.active and p.role in ('admin','editor')) then
    raise exception 'Solo se puede asignar a editores o administradores activos.';
  end if;
  new.also_assigned := coalesce((select array_agg(distinct u) from unnest(new.also_assigned) u where u is distinct from new.assigned_to), '{}');
  if (tg_op = 'INSERT' or new.also_assigned is distinct from old.also_assigned)
     and exists (select 1 from unnest(new.also_assigned) u where not exists (select 1 from public.profiles p where p.id = u and p.active and p.role in ('admin','editor'))) then
    raise exception 'Los participantes deben ser editores o administradores activos.';
  end if;
  if not new.is_video and exists (select 1 from public.profiles p where p.role = 'editor' and p.id = any(array_append(new.also_assigned, new.assigned_to))) then
    raise exception 'Los editores solo pueden tener tareas de vídeo para editar.';
  end if;
  return new;
end $$;
-- el pago al editor solo existe en tareas de vídeo
create or replace function public.task_pay_video_only() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.tasks t where t.id = new.task_id and t.is_video) then raise exception 'El pago al editor solo se registra en tareas de vídeo para editar.'; end if;
  return new;
end $$;
revoke all on function public.task_pay_video_only() from public, anon, authenticated;
drop trigger if exists task_pay_video_only_t on public.task_pay;
create trigger task_pay_video_only_t before insert or update on public.task_pay for each row execute function public.task_pay_video_only();
