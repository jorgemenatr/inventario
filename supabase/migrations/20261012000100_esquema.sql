-- =====================================================================
-- Inventario Hachiko · Fase 1 · Esquema base
-- Tipos, tablas, secuencia de códigos internos y triggers.
-- =====================================================================

-- ---------- Tipos ----------
create type public.user_role as enum ('admin', 'staff');

-- 'sale' se deja creado desde ahora para el futuro punto de venta.
create type public.movement_type as enum (
  'initial_count',  -- alta de producto con su conteo inicial
  'scan_add',       -- escaneo en modo "Sumar"
  'set_total',      -- escaneo en modo "Fijar total"
  'adjustment',     -- ajustes manuales y "Deshacer"
  'sale'            -- ventas (POS, fase futura)
);

-- ---------- updated_at genérico ----------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------- profiles ----------
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text not null,
  full_name  text,
  role       public.user_role not null default 'staff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Crea el perfil automáticamente al crear un usuario en auth.users.
-- SECURITY DEFINER es necesario porque lo dispara GoTrue (no un usuario de la app).
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''), new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Perfiles para usuarios que ya existieran antes de esta migración.
insert into public.profiles (id, email, full_name)
select u.id, coalesce(u.email, ''), u.raw_user_meta_data ->> 'full_name'
from auth.users u
on conflict (id) do nothing;

-- ---------- Códigos internos HCH-000001 ----------
create sequence public.internal_code_seq as integer start 1 minvalue 1;

-- ---------- products ----------
create table public.products (
  id               uuid primary key default gen_random_uuid(),
  barcode          text not null unique check (length(btrim(barcode)) > 0),
  name             text not null check (length(btrim(name)) > 0),
  category         text,
  supplier         text,
  cost             numeric(12, 2) check (cost is null or cost >= 0),
  price            numeric(12, 2) not null check (price >= 0),
  quantity         integer not null default 0,
  -- Ruta del archivo dentro del bucket privado `product-images`
  -- (no una URL: las URLs firmadas caducan y se generan al mostrar).
  image_url        text,
  is_internal_code boolean not null default false,
  created_by       uuid default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------- inventory_movements ----------
create table public.inventory_movements (
  id                  uuid primary key default gen_random_uuid(),
  product_id          uuid not null references public.products (id) on delete restrict,
  type                public.movement_type not null,
  delta               integer not null,
  quantity_after      integer not null,
  note                text,
  -- Id generado en el cliente para que reintentos de la cola offline
  -- no dupliquen movimientos (idempotencia).
  client_op_id        uuid unique,
  -- Para "Deshacer": movimiento que este ajuste revierte (solo una vez).
  reverts_movement_id uuid unique references public.inventory_movements (id) on delete restrict,
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now()
);

create index inventory_movements_product_idx on public.inventory_movements (product_id, created_at desc);
create index inventory_movements_created_idx on public.inventory_movements (created_at desc);
