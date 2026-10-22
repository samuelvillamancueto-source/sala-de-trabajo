-- v5: Finanzas compartidas (Samuel + Tellez). Solo importes: nunca tarjetas, cuentas ni claves.
create table if not exists public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('ingreso','gasto')),
  amount_cents bigint not null check (amount_cents > 0 and amount_cents < 100000000000),
  occurred_on date not null default current_date,
  category text not null check (char_length(category) between 1 and 40),
  note text check (note is null or char_length(note) <= 500),
  receipt_path text check (receipt_path is null or (char_length(receipt_path) <= 200 and receipt_path !~ '\.\.')),
  recurring boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists finance_entries_date_idx on public.finance_entries (occurred_on desc);
create table if not exists public.finance_budgets (
  month date not null check (month = date_trunc('month', month)::date),
  category text not null check (char_length(category) between 1 and 40),   -- 'ahorro' = objetivo de ahorro del mes
  kind text not null default 'gasto' check (kind in ('ingreso','gasto','ahorro')),
  planned_cents bigint not null check (planned_cents >= 0 and planned_cents < 100000000000),
  primary key (month, category, kind)
);
alter table public.finance_entries enable row level security; alter table public.finance_entries force row level security;
alter table public.finance_budgets enable row level security; alter table public.finance_budgets force row level security;
drop policy if exists fin_e_admin on public.finance_entries; drop policy if exists fin_e_agent_read on public.finance_entries; drop policy if exists fin_e_agent_ins on public.finance_entries;
create policy fin_e_admin on public.finance_entries for all using ((select public.is_admin())) with check ((select public.is_admin()));
create policy fin_e_agent_read on public.finance_entries for select using ((select public.is_agent()));
create policy fin_e_agent_ins on public.finance_entries for insert with check ((select public.is_agent()) and created_by = (select auth.uid()));
drop policy if exists fin_b_admin on public.finance_budgets; drop policy if exists fin_b_agent_read on public.finance_budgets;
create policy fin_b_admin on public.finance_budgets for all using ((select public.is_admin())) with check ((select public.is_admin()));
create policy fin_b_agent_read on public.finance_budgets for select using ((select public.is_agent()));
create or replace function public.finance_guard() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then new.created_by := auth.uid(); new.created_at := now(); end if;
  if tg_op = 'UPDATE' then new.created_by := old.created_by; new.created_at := old.created_at; end if;
  new.updated_at := now(); new.category := btrim(new.category);
  return new;
end $$;
revoke all on function public.finance_guard() from public, anon, authenticated;
drop trigger if exists finance_guard_t on public.finance_entries;
create trigger finance_guard_t before insert or update on public.finance_entries for each row execute function public.finance_guard();
revoke all on public.finance_entries, public.finance_budgets from anon;
revoke truncate, references, trigger on public.finance_entries, public.finance_budgets from authenticated;
-- tickets: almacén privado, 5 MB, solo imágenes
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];
drop policy if exists receipts_admin on storage.objects; drop policy if exists receipts_agent_read on storage.objects;
create policy receipts_admin on storage.objects for all to authenticated using (bucket_id = 'receipts' and (select public.is_admin())) with check (bucket_id = 'receipts' and (select public.is_admin()));
create policy receipts_agent_read on storage.objects for select to authenticated using (bucket_id = 'receipts' and (select public.is_agent()));
-- copia nocturna incluye finanzas
create or replace function backup.take() returns void language plpgsql security definer set search_path = public, backup as $$
declare t text; n int; d jsonb;
begin
  foreach t in array array['profiles','clients','client_private','client_billing','client_members','tasks','task_pay','deliveries','task_comments','activity','ideas','invites','finance_entries','finance_budgets'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb), count(*) from public.%I x', t) into d, n;
    insert into backup.snapshots(tbl, rows, data) values (t, n, d);
  end loop;
  delete from backup.snapshots where taken_at < now() - interval '14 days';
end $$;
revoke all on function backup.take() from public, anon, authenticated;
