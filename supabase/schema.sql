create table if not exists public.ledger_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.ledger_snapshots enable row level security;

drop policy if exists "Users can read own ledger snapshot" on public.ledger_snapshots;
create policy "Users can read own ledger snapshot"
on public.ledger_snapshots
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can insert own ledger snapshot" on public.ledger_snapshots;
create policy "Users can insert own ledger snapshot"
on public.ledger_snapshots
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Users can update own ledger snapshot" on public.ledger_snapshots;
create policy "Users can update own ledger snapshot"
on public.ledger_snapshots
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own ledger snapshot" on public.ledger_snapshots;
create policy "Users can delete own ledger snapshot"
on public.ledger_snapshots
for delete
to authenticated
using (auth.uid() = user_id);
