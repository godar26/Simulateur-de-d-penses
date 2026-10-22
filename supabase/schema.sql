create table if not exists public.budget_state (
    user_id uuid primary key references auth.users (id) on delete cascade,
    payload jsonb not null default '{}'::jsonb,
    updated_at timestamptz not null default now()
);

alter table public.budget_state enable row level security;

drop policy if exists "Users can read their own budget" on public.budget_state;
drop policy if exists "Users can insert their own budget" on public.budget_state;
drop policy if exists "Users can update their own budget" on public.budget_state;
drop policy if exists "Les utilisateurs peuvent lire leur propre budget" on public.budget_state;
drop policy if exists "Les utilisateurs peuvent insérer leur propre budget" on public.budget_state;
drop policy if exists "Les utilisateurs peuvent modifier leur propre budget" on public.budget_state;

create policy "Users can read their own budget"
on public.budget_state
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can insert their own budget"
on public.budget_state
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own budget"
on public.budget_state
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
