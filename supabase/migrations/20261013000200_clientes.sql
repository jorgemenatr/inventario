-- =====================================================================
-- Inventario Hachiko · Clientes
-- Clientes de la tienda: nombre obligatorio, correo y teléfono opcionales y
-- los juegos que juegan (lista de tags). Las ventas (mostrador) se ligan a
-- esta tabla en una migración posterior.
-- =====================================================================

create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) > 0),
  email       text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone       text,
  -- Tags libres: "Pokémon", "Magic: The Gathering", …
  games       text[] not null default '{}',
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create index customers_name_idx on public.customers (lower(name));
create index customers_games_idx on public.customers using gin (games);

-- ---------- permisos ----------
alter table public.customers enable row level security;

revoke all on public.customers from anon, authenticated;
-- Sin DELETE: los clientes solo se borran desde el dashboard (luego tendrán ventas ligadas).
grant select, insert, update on public.customers to authenticated;

create policy "customers: authenticated puede leer"
  on public.customers for select to authenticated
  using (true);

create policy "customers: authenticated puede crear"
  on public.customers for insert to authenticated
  with check (created_by is null or created_by = auth.uid());

create policy "customers: authenticated puede actualizar"
  on public.customers for update to authenticated
  using (true) with check (true);
