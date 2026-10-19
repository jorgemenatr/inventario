-- =====================================================================
-- Inventario Hachiko · Lotes (proveedor + costo) y dos ubicaciones
--
--   Ubicaciones: 'store' (Tienda, donde se vende) y 'warehouse' (Bodega).
--   Lote: una entrada de mercancía de un producto, con su proveedor, su
--   costo unitario y su fecha. Sus piezas pueden estar en ambas ubicaciones
--   (lot_stock).
--
--   products.quantity           = piezas en TIENDA (suma de sus lotes)
--   products.warehouse_quantity = piezas en BODEGA
--   Las dos se calculan solas desde lot_stock (trigger); nadie las escribe
--   directo.
--
--   Cada cambio de piezas de un lote queda en movement_lots, ligado al
--   movimiento de inventory_movements que lo causó (venta, escaneo, compra,
--   traspaso, ajuste…). Con eso se deshace exacto y se sabe el costo de cada
--   venta.
--
--   Ventas: solo salen de la tienda, del lote más viejo (FIFO). Si la tienda
--   no alcanza, la venta se rechaza (ya no hay cobro sin conexión).
--   Traspasos (solo admin): bodega → tienda mueve lo más viejo primero;
--   tienda → bodega, lo más nuevo. Todo o nada.
--   Bajar stock a mano (ajuste, fijar total, merma): se elige el lote.
--
--   Lotes, costos, proveedores, compras y traspasos solo los lee un admin.
--   Todo se escribe por funciones (SECURITY DEFINER con search_path fijo,
--   que revisan el rol); las tablas nuevas no tienen permisos de escritura.
-- =====================================================================

-- Se usan solo dentro de funciones (en tiempo de ejecución), así que se
-- pueden agregar en la misma transacción.
alter type public.movement_type add value if not exists 'purchase';
alter type public.movement_type add value if not exists 'transfer';

create type public.stock_location as enum ('store', 'warehouse');
create type public.lot_origin as enum ('initial', 'purchase', 'scan', 'product_create', 'adjustment');

-- ---------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------
create table public.suppliers (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(btrim(name)) > 0),
  contact    text,
  note       text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index suppliers_name_key on public.suppliers (lower(btrim(name)));

-- products.supplier (texto) se conserva como copia del nombre para mostrar y
-- exportar; la referencia real es supplier_id (último proveedor del producto).
alter table public.products
  add column warehouse_quantity integer not null default 0,
  add column supplier_id        uuid references public.suppliers (id) on delete set null;

create index products_supplier_idx on public.products (supplier_id) where supplier_id is not null;

-- ---------------------------------------------------------------------
-- Compras
-- ---------------------------------------------------------------------
create table public.purchases (
  -- Lo genera la app: si se reintenta, no se duplica.
  id            uuid primary key,
  supplier_id   uuid not null references public.suppliers (id) on delete restrict,
  location      public.stock_location not null default 'store',
  folio         text,
  note          text,
  total         numeric(12, 2) not null default 0,
  status        text not null default 'active' check (status in ('active', 'cancelled')),
  cancel_reason text,
  cancelled_at  timestamptz,
  cancelled_by  uuid references auth.users (id) on delete set null,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index purchases_created_idx on public.purchases (created_at desc);

create table public.purchase_items (
  id          uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases (id) on delete restrict,
  product_id  uuid not null references public.products (id) on delete restrict,
  quantity    integer not null check (quantity > 0),
  unit_cost   numeric(12, 2) not null check (unit_cost >= 0),
  position    integer not null default 0,
  -- Movimiento 'purchase' que metió estas piezas (para cancelar la compra).
  movement_id uuid
);

create index purchase_items_purchase_idx on public.purchase_items (purchase_id, position);
create index purchase_items_product_idx on public.purchase_items (product_id);

-- ---------------------------------------------------------------------
-- Traspasos (movimiento de bodega)
-- ---------------------------------------------------------------------
create table public.transfers (
  -- Lo genera la app: si se reintenta, no se duplica.
  id            uuid primary key,
  from_location public.stock_location not null,
  to_location   public.stock_location not null,
  note          text,
  created_by    uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  check (from_location <> to_location)
);

create index transfers_created_idx on public.transfers (created_at desc);

create table public.transfer_items (
  id          uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers (id) on delete restrict,
  product_id  uuid not null references public.products (id) on delete restrict,
  quantity    integer not null check (quantity > 0)
);

create index transfer_items_transfer_idx on public.transfer_items (transfer_id);

-- ---------------------------------------------------------------------
-- Lotes y sus piezas por ubicación
-- ---------------------------------------------------------------------
create table public.lots (
  id                uuid primary key default gen_random_uuid(),
  -- Número corto para mostrar ("Lote 12").
  number            bigint generated always as identity unique,
  product_id        uuid not null references public.products (id) on delete restrict,
  supplier_id       uuid references public.suppliers (id) on delete restrict,
  unit_cost         numeric(12, 2) not null default 0 check (unit_cost >= 0),
  -- Piezas que entraron con este lote (en una sesión de escaneo va creciendo).
  received_quantity integer not null check (received_quantity > 0),
  received_at       timestamptz not null default now(),
  origin            public.lot_origin not null,
  entry_location    public.stock_location not null,
  purchase_item_id  uuid unique references public.purchase_items (id) on delete restrict,
  -- Sesión de escaneo que abrió el lote: los escaneos siguientes de la misma
  -- sesión suman a este lote en vez de crear uno por escaneo.
  scan_session_id   uuid,
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now()
);

create index lots_product_idx on public.lots (product_id, received_at, number);
create unique index lots_scan_session_key on public.lots (scan_session_id, product_id, entry_location)
  where scan_session_id is not null;

create table public.lot_stock (
  lot_id   uuid not null references public.lots (id) on delete restrict,
  location public.stock_location not null,
  quantity integer not null check (quantity >= 0),
  primary key (lot_id, location)
);

create index lot_stock_location_idx on public.lot_stock (location, lot_id) where quantity > 0;

-- ---------- movimientos ----------
alter table public.inventory_movements
  add column location    public.stock_location not null default 'store',
  add column purchase_id uuid references public.purchases (id) on delete restrict,
  add column transfer_id uuid references public.transfers (id) on delete restrict;

create index inventory_movements_purchase_idx on public.inventory_movements (purchase_id) where purchase_id is not null;
create index inventory_movements_transfer_idx on public.inventory_movements (transfer_id) where transfer_id is not null;

alter table public.purchase_items
  add constraint purchase_items_movement_fkey
  foreign key (movement_id) references public.inventory_movements (id) on delete restrict;

-- De qué lote (y ubicación) entró o salió cada pieza de cada movimiento.
-- La suma de delta por (lote, ubicación) es exactamente lot_stock.quantity.
create table public.movement_lots (
  id          uuid primary key default gen_random_uuid(),
  -- null solo para el saldo inicial que creó esta migración.
  movement_id uuid references public.inventory_movements (id) on delete restrict,
  lot_id      uuid not null references public.lots (id) on delete restrict,
  location    public.stock_location not null,
  delta       integer not null check (delta <> 0),
  -- Copia del costo del lote (utilidad por venta).
  unit_cost   numeric(12, 2) not null,
  created_at  timestamptz not null default now()
);

create index movement_lots_movement_idx on public.movement_lots (movement_id);
create index movement_lots_lot_idx on public.movement_lots (lot_id, location);

-- =====================================================================
-- Triggers
-- =====================================================================

-- products.quantity / warehouse_quantity = suma de sus lotes por ubicación.
create function public._sync_product_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product uuid;
begin
  select product_id into v_product from public.lots where id = coalesce(new.lot_id, old.lot_id);
  if v_product is null then
    return null;
  end if;

  update public.products p
  set quantity = coalesce((
        select sum(ls.quantity) from public.lot_stock ls join public.lots l on l.id = ls.lot_id
        where l.product_id = v_product and ls.location = 'store'), 0),
      warehouse_quantity = coalesce((
        select sum(ls.quantity) from public.lot_stock ls join public.lots l on l.id = ls.lot_id
        where l.product_id = v_product and ls.location = 'warehouse'), 0)
  where p.id = v_product;
  return null;
end;
$$;

create trigger lot_stock_sync_product
  after insert or update or delete on public.lot_stock
  for each row execute function public._sync_product_stock();

-- Las cantidades del producto solo cambian desde el trigger de arriba
-- (pg_trigger_depth() >= 2). Un UPDATE directo (app, REST, SQL Editor) no
-- puede tocarlas: el stock se mueve con las funciones, que dejan lote y
-- movimiento.
create function public.guard_product_stock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if pg_trigger_depth() >= 2 then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.quantity <> 0 or new.warehouse_quantity <> 0 then
      raise exception 'Un producto nuevo empieza sin piezas: el stock entra con un lote' using errcode = '42501';
    end if;
  elsif (new.quantity, new.warehouse_quantity) is distinct from (old.quantity, old.warehouse_quantity) then
    raise exception 'Las existencias solo cambian con movimientos de inventario' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Busca un proveedor por nombre (sin importar mayúsculas) o lo crea.
create function public._resolve_supplier(p_supplier_id uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id   uuid;
begin
  if p_supplier_id is not null then
    select id into v_id from public.suppliers where id = p_supplier_id;
    if not found then
      raise exception 'No existe el proveedor' using errcode = 'P0002';
    end if;
    return v_id;
  end if;
  if v_name is null then
    return null;
  end if;
  insert into public.suppliers (name, created_by) values (v_name, auth.uid())
  on conflict ((lower(btrim(name)))) do nothing;
  select id into v_id from public.suppliers where lower(btrim(name)) = lower(v_name);
  return v_id;
end;
$$;

-- products.supplier (texto) y supplier_id siempre apuntan al mismo proveedor.
-- Si la app manda solo el texto (formularios y cola anteriores), se busca o
-- se crea el proveedor con ese nombre.
create function public.sync_product_supplier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.supplier_id is distinct from old.supplier_id then
    if new.supplier_id is null and tg_op = 'INSERT' then
      new.supplier_id := public._resolve_supplier(null, new.supplier);
    end if;
  elsif new.supplier is distinct from old.supplier then
    new.supplier_id := public._resolve_supplier(null, new.supplier);
  end if;
  new.supplier := (select name from public.suppliers where id = new.supplier_id);
  return new;
end;
$$;

-- Si se renombra un proveedor, se actualiza la copia en los productos.
create function public.sync_supplier_name()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.products set supplier = new.name where supplier_id = new.id and supplier is distinct from new.name;
  return null;
end;
$$;

create trigger suppliers_sync_name
  after update of name on public.suppliers
  for each row execute function public.sync_supplier_name();

-- El mostrador tampoco puede cambiar el proveedor del producto.
create or replace function public.guard_products()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Solo un administrador puede dar de alta productos' using errcode = '42501';
  end if;
  -- Mostrador: solo puede cambiar la cantidad (ventas con pay_ticket).
  if (new.barcode, new.name, new.category, new.supplier, new.supplier_id, new.cost, new.price, new.image_url,
      new.is_internal_code, new.description, new.catalog_product_id)
     is distinct from
     (old.barcode, old.name, old.category, old.supplier, old.supplier_id, old.cost, old.price, old.image_url,
      old.is_internal_code, old.description, old.catalog_product_id) then
    raise exception 'Solo un administrador puede editar productos' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- =====================================================================
-- Datos existentes
--   * Proveedores: los nombres que ya estaban en products.supplier.
--   * Cada producto con piezas recibe UN lote 'initial' en tienda con su
--     costo actual ($0 si no tenía) y su proveedor. El stock no cambia.
--   * Los movimientos anteriores quedan en tienda (default de la columna).
-- =====================================================================
do $$
declare
  r     record;
  v_lot uuid;
begin
  if exists (select 1 from public.products where quantity < 0) then
    raise exception 'Hay productos con cantidad negativa; corrígelos antes de migrar';
  end if;

  insert into public.suppliers (name)
  select distinct on (lower(btrim(supplier))) btrim(supplier)
  from public.products
  where nullif(btrim(coalesce(supplier, '')), '') is not null
  order by lower(btrim(supplier)), btrim(supplier);

  update public.products p
  set supplier_id = s.id, supplier = s.name
  from public.suppliers s
  where lower(btrim(p.supplier)) = lower(btrim(s.name));

  for r in select id, supplier_id, cost, quantity from public.products where quantity > 0 order by created_at, id loop
    insert into public.lots (product_id, supplier_id, unit_cost, received_quantity, origin, entry_location)
    values (r.id, r.supplier_id, coalesce(r.cost, 0), r.quantity, 'initial', 'store')
    returning id into v_lot;

    insert into public.movement_lots (movement_id, lot_id, location, delta, unit_cost)
    values (null, v_lot, 'store', r.quantity, coalesce(r.cost, 0));

    insert into public.lot_stock (lot_id, location, quantity) values (v_lot, 'store', r.quantity);
  end loop;
end;
$$;

-- Los triggers de productos se activan después de cargar los datos.
create trigger products_stock_guard
  before insert or update on public.products
  for each row execute function public.guard_product_stock();

create trigger products_supplier_sync
  before insert or update of supplier, supplier_id on public.products
  for each row execute function public.sync_product_supplier();

-- =====================================================================
-- Primitivas de stock (internas: no las puede llamar la app)
-- =====================================================================

-- Solo admin. auth.uid() nulo = SQL Editor / service_role (como en guard_products).
create function public._require_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Solo un administrador puede hacer esto' using errcode = '42501';
  end if;
end;
$$;

create function public._location_qty(p_product_id uuid, p_location public.stock_location)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_location = 'store' then quantity else warehouse_quantity end
  from public.products where id = p_product_id;
$$;

create function public._location_name(p_location public.stock_location)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_location when 'store' then 'tienda' else 'bodega' end;
$$;

-- Suma piezas a un lote en una ubicación y lo anota en movement_lots.
create function public._lot_add(p_lot_id uuid, p_location public.stock_location, p_quantity integer, p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Cantidad inválida: %', p_quantity using errcode = '22023';
  end if;
  insert into public.lot_stock (lot_id, location, quantity) values (p_lot_id, p_location, p_quantity)
  on conflict (lot_id, location) do update set quantity = public.lot_stock.quantity + excluded.quantity;

  insert into public.movement_lots (movement_id, lot_id, location, delta, unit_cost)
  select p_movement_id, l.id, p_location, p_quantity, l.unit_cost from public.lots l where l.id = p_lot_id;
end;
$$;

-- Quita piezas de un lote en una ubicación (falla si no alcanzan).
create function public._lot_take(p_lot_id uuid, p_location public.stock_location, p_quantity integer, p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_have   integer;
  v_number bigint;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Cantidad inválida: %', p_quantity using errcode = '22023';
  end if;
  select ls.quantity into v_have from public.lot_stock ls
  where ls.lot_id = p_lot_id and ls.location = p_location
  for update;

  if coalesce(v_have, 0) < p_quantity then
    select number into v_number from public.lots where id = p_lot_id;
    raise exception 'El lote % tiene % pzas en %; no se pueden sacar %',
      v_number, coalesce(v_have, 0), public._location_name(p_location), p_quantity using errcode = 'P0001';
  end if;

  update public.lot_stock set quantity = quantity - p_quantity
  where lot_id = p_lot_id and location = p_location;

  insert into public.movement_lots (movement_id, lot_id, location, delta, unit_cost)
  select p_movement_id, l.id, p_location, -p_quantity, l.unit_cost from public.lots l where l.id = p_lot_id;
end;
$$;

-- Saca piezas en automático: del lote más viejo (o del más nuevo si
-- p_newest_first). Devuelve de qué lotes salieron.
create function public._take_auto(
  p_product_id   uuid,
  p_location     public.stock_location,
  p_quantity     integer,
  p_movement_id  uuid,
  p_newest_first boolean default false
)
returns table (o_lot_id uuid, o_quantity integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r      record;
  v_left integer := p_quantity;
  v_take integer;
begin
  for r in
    select ls.lot_id as lid, ls.quantity as qty
    from public.lot_stock ls
    join public.lots l on l.id = ls.lot_id
    where l.product_id = p_product_id and ls.location = p_location and ls.quantity > 0
    order by
      case when p_newest_first then l.received_at end desc,
      case when p_newest_first then l.number end desc,
      l.received_at, l.number
    for update of ls
  loop
    exit when v_left = 0;
    v_take := least(r.qty, v_left);
    perform public._lot_take(r.lid, p_location, v_take, p_movement_id);
    o_lot_id := r.lid;
    o_quantity := v_take;
    return next;
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then
    raise exception 'Stock insuficiente en %: faltan % pzas', public._location_name(p_location), v_left
      using errcode = 'P0001';
  end if;
end;
$$;

-- Saca piezas de los lotes que eligió el admin.
--   p_lots: [{ "lot_id": "...", "quantity": 2 }, ...] y debe sumar p_quantity.
--   null: solo se permite si hay un único lote con piezas en esa ubicación
--   (si no, error con hint 'choose_lot' para que la app pida elegir).
create function public._take_chosen(
  p_product_id  uuid,
  p_location    public.stock_location,
  p_lots        jsonb,
  p_quantity    integer,
  p_movement_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_count integer;
  v_lot   uuid;
  v_sum   integer;
begin
  if p_lots is null or jsonb_typeof(p_lots) = 'null' then
    select count(*), min(ls.lot_id::text)::uuid into v_count, v_lot
    from public.lot_stock ls join public.lots l on l.id = ls.lot_id
    where l.product_id = p_product_id and ls.location = p_location and ls.quantity > 0;
    if v_count <> 1 then
      raise exception 'Elige de qué lote salen las % pzas', p_quantity
        using errcode = 'P0001', hint = 'choose_lot';
    end if;
    perform public._lot_take(v_lot, p_location, p_quantity, p_movement_id);
    return;
  end if;

  if jsonb_typeof(p_lots) <> 'array' then
    raise exception 'Lotes inválidos' using errcode = '22023';
  end if;

  select coalesce(sum((e ->> 'quantity')::integer), 0) into v_sum from jsonb_array_elements(p_lots) e;
  if v_sum <> p_quantity then
    raise exception 'Los lotes elegidos suman % pzas y se necesitan %', v_sum, p_quantity
      using errcode = '22023', hint = 'choose_lot';
  end if;

  for r in
    select (e ->> 'lot_id')::uuid as lot_id, sum((e ->> 'quantity')::integer)::integer as qty
    from jsonb_array_elements(p_lots) e
    group by 1
    order by 1
  loop
    if r.qty is null or r.qty < 0 then
      raise exception 'Cantidad inválida en los lotes' using errcode = '22023';
    end if;
    continue when r.qty = 0;
    if not exists (select 1 from public.lots where id = r.lot_id and product_id = p_product_id) then
      raise exception 'El lote no es de este producto' using errcode = '22023';
    end if;
    perform public._lot_take(r.lot_id, p_location, r.qty, p_movement_id);
  end loop;
end;
$$;

-- Entrada de piezas: crea un lote (o suma al de la sesión de escaneo).
-- Proveedor y costo nulos = los últimos del producto (costo $0 si no hay).
create function public._add_entry(
  p_product_id       uuid,
  p_location         public.stock_location,
  p_quantity         integer,
  p_supplier_id      uuid,
  p_unit_cost        numeric,
  p_origin           public.lot_origin,
  p_movement_id      uuid,
  p_session_id       uuid default null,
  p_purchase_item_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot      uuid;
  v_supplier uuid;
  v_cost     numeric(12, 2);
begin
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'El costo no puede ser negativo' using errcode = '22023';
  end if;

  if p_session_id is not null then
    select id into v_lot from public.lots
    where scan_session_id = p_session_id and product_id = p_product_id and entry_location = p_location
    for update;
    if found then
      update public.lots set received_quantity = received_quantity + p_quantity where id = v_lot;
      perform public._lot_add(v_lot, p_location, p_quantity, p_movement_id);
      return v_lot;
    end if;
  end if;

  select coalesce(p_supplier_id, supplier_id), coalesce(p_unit_cost, cost, 0)
  into v_supplier, v_cost
  from public.products where id = p_product_id;

  insert into public.lots (
    product_id, supplier_id, unit_cost, received_quantity, origin, entry_location,
    purchase_item_id, scan_session_id, created_by
  ) values (
    p_product_id, v_supplier, v_cost, p_quantity, p_origin, p_location,
    p_purchase_item_id, p_session_id, auth.uid()
  )
  returning id into v_lot;

  perform public._lot_add(v_lot, p_location, p_quantity, p_movement_id);

  -- Último proveedor y costo del producto (precargan la siguiente entrada).
  if p_supplier_id is not null or p_unit_cost is not null then
    update public.products
    set supplier_id = coalesce(p_supplier_id, supplier_id), cost = coalesce(p_unit_cost, cost)
    where id = p_product_id
      and (supplier_id, cost) is distinct from (coalesce(p_supplier_id, supplier_id), coalesce(p_unit_cost, cost));
  end if;

  return v_lot;
end;
$$;

-- Respuesta común: + ubicación del movimiento.
create or replace function public._movement_result(p_status text, p_movement public.inventory_movements)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'status',         p_status,
    'movement_id',    p_movement.id,
    'movement_type',  p_movement.type,
    'location',       p_movement.location,
    'delta',          p_movement.delta,
    'quantity_after', p_movement.quantity_after,
    'product',        to_jsonb(p)
  )
  from public.products p
  where p.id = p_movement.product_id;
$$;

-- =====================================================================
-- Funciones de la app (se reemplazan las anteriores; los parámetros nuevos
-- tienen default, así que las llamadas existentes siguen funcionando)
-- =====================================================================
drop function public.register_scan(text, text, integer, uuid, text);
drop function public.create_product(text, text, numeric, numeric, text, text, integer, text, uuid, text, bigint);
drop function public.adjust_stock(uuid, integer, text, uuid);
drop function public.undo_movement(uuid, uuid);
drop function public.cancel_movement(uuid, text, uuid);

-- ---------------------------------------------------------------------
-- register_scan: escaneo en una ubicación (solo admin).
--   'add' → suma p_quantity: lote nuevo, o el de la sesión de escaneo.
--   'set' → fija la cantidad de ESA ubicación. Si sube, entra como 'add';
--           si baja, salen de los lotes elegidos (p_lots).
--   p_supplier_id / p_unit_cost: los elige la sesión; nulos = los últimos.
-- status: 'ok' | 'duplicate' | 'not_found'
-- ---------------------------------------------------------------------
create function public.register_scan(
  p_barcode      text,
  p_mode         text,
  p_quantity     integer,
  p_client_op_id uuid default null,
  p_note         text default null,
  p_location     public.stock_location default 'store',
  p_supplier_id  uuid default null,
  p_unit_cost    numeric default null,
  p_session_id   uuid default null,
  p_lots         jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product  public.products;
  v_movement public.inventory_movements;
  v_loc      public.stock_location := coalesce(p_location, 'store');
  v_current  integer;
  v_new_qty  integer;
begin
  perform public._require_admin();

  if p_mode not in ('add', 'set') then
    raise exception 'Modo inválido: %', p_mode using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 0 or (p_mode = 'add' and p_quantity = 0) then
    raise exception 'Cantidad inválida: %', p_quantity using errcode = '22023';
  end if;

  if p_client_op_id is not null then
    select * into v_movement from public.inventory_movements where client_op_id = p_client_op_id;
    if found then
      return public._movement_result('duplicate', v_movement);
    end if;
  end if;

  select * into v_product from public.products where barcode = btrim(p_barcode) for update;
  if not found then
    return jsonb_build_object('status', 'not_found', 'barcode', btrim(p_barcode));
  end if;

  v_current := public._location_qty(v_product.id, v_loc);
  v_new_qty := case when p_mode = 'add' then v_current + p_quantity else p_quantity end;

  insert into public.inventory_movements (product_id, type, delta, quantity_after, note, client_op_id, created_by, location)
  values (
    v_product.id,
    case when p_mode = 'add' then 'scan_add' else 'set_total' end::public.movement_type,
    v_new_qty - v_current,
    v_new_qty,
    p_note,
    p_client_op_id,
    auth.uid(),
    v_loc
  )
  returning * into v_movement;

  if v_new_qty > v_current then
    perform public._add_entry(v_product.id, v_loc, v_new_qty - v_current, p_supplier_id, p_unit_cost,
                              'scan', v_movement.id, p_session_id);
  elsif v_new_qty < v_current then
    perform public._take_chosen(v_product.id, v_loc, p_lots, v_current - v_new_qty, v_movement.id);
  end if;

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------------------------------------------------------------------
-- create_product: alta + primer lote (si trae cantidad inicial) en la
-- ubicación indicada, con su proveedor y costo. Solo admin.
--   p_supplier (texto) se conserva para la cola anterior: si no viene
--   p_supplier_id, se busca o se crea el proveedor con ese nombre.
-- status: 'ok' | 'duplicate' | 'exists'
-- ---------------------------------------------------------------------
create function public.create_product(
  p_barcode            text,
  p_name               text,
  p_price              numeric,
  p_cost               numeric default null,
  p_category           text default null,
  p_supplier           text default null,
  p_initial_quantity   integer default 0,
  p_image_url          text default null,
  p_client_op_id       uuid default null,
  p_description        text default null,
  p_catalog_product_id bigint default null,
  p_location           public.stock_location default 'store',
  p_supplier_id        uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_barcode  text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_internal boolean := false;
  v_loc      public.stock_location := coalesce(p_location, 'store');
  v_product  public.products;
  v_movement public.inventory_movements;
begin
  perform public._require_admin();

  if p_initial_quantity is null or p_initial_quantity < 0 then
    raise exception 'Cantidad inicial inválida: %', p_initial_quantity using errcode = '22023';
  end if;

  if p_client_op_id is not null then
    select * into v_movement from public.inventory_movements where client_op_id = p_client_op_id;
    if found then
      return public._movement_result('duplicate', v_movement);
    end if;
  end if;

  if v_barcode is null then
    v_barcode  := 'HCH-' || lpad(nextval('public.internal_code_seq')::text, 6, '0');
    v_internal := true;
  else
    select * into v_product from public.products where barcode = v_barcode;
    if found then
      return jsonb_build_object('status', 'exists', 'product', to_jsonb(v_product));
    end if;
    -- El prefijo HCH- está reservado para la secuencia interna.
    if upper(v_barcode) like 'HCH-%' then
      raise exception 'El prefijo HCH- está reservado para códigos internos' using errcode = '22023';
    end if;
  end if;

  insert into public.products (
    barcode, name, price, cost, category, supplier_id, quantity, image_url, is_internal_code, created_by,
    description, catalog_product_id
  ) values (
    v_barcode,
    btrim(p_name),
    p_price,
    p_cost,
    nullif(btrim(coalesce(p_category, '')), ''),
    public._resolve_supplier(p_supplier_id, p_supplier),
    0,
    p_image_url,
    v_internal,
    auth.uid(),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_catalog_product_id
  )
  returning * into v_product;

  insert into public.inventory_movements (product_id, type, delta, quantity_after, note, client_op_id, created_by, location)
  values (v_product.id, 'initial_count', p_initial_quantity, p_initial_quantity, 'Alta de producto', p_client_op_id, auth.uid(), v_loc)
  returning * into v_movement;

  if p_initial_quantity > 0 then
    perform public._add_entry(v_product.id, v_loc, p_initial_quantity, null, null, 'product_create', v_movement.id);
  end if;

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------------------------------------------------------------------
-- adjust_stock: fija la cantidad de una ubicación con su motivo (solo admin).
--   Si sube: lote 'adjustment' con p_supplier_id / p_unit_cost (nulos = últimos).
--   Si baja (merma, dañado, conteo): salen de los lotes elegidos (p_lots).
-- status: 'ok' | 'duplicate'
-- ---------------------------------------------------------------------
create function public.adjust_stock(
  p_product_id   uuid,
  p_quantity     integer,
  p_reason       text,
  p_client_op_id uuid default null,
  p_location     public.stock_location default 'store',
  p_lots         jsonb default null,
  p_supplier_id  uuid default null,
  p_unit_cost    numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product  public.products;
  v_movement public.inventory_movements;
  v_loc      public.stock_location := coalesce(p_location, 'store');
  v_current  integer;
begin
  perform public._require_admin();

  if p_client_op_id is not null then
    select * into v_movement from public.inventory_movements where client_op_id = p_client_op_id;
    if found then
      return public._movement_result('duplicate', v_movement);
    end if;
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 0 then
    raise exception 'Cantidad inválida: %', p_quantity using errcode = '22023';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Producto no encontrado' using errcode = 'P0002';
  end if;
  v_current := public._location_qty(v_product.id, v_loc);
  if v_current = p_quantity then
    raise exception 'La cantidad en % ya es %', public._location_name(v_loc), p_quantity using errcode = '22023';
  end if;

  insert into public.inventory_movements (product_id, type, delta, quantity_after, note, client_op_id, created_by, location)
  values (
    v_product.id,
    'adjustment',
    p_quantity - v_current,
    p_quantity,
    'Ajuste de existencias. Motivo: ' || btrim(p_reason),
    p_client_op_id,
    auth.uid(),
    v_loc
  )
  returning * into v_movement;

  if p_quantity > v_current then
    perform public._add_entry(v_product.id, v_loc, p_quantity - v_current, p_supplier_id, p_unit_cost,
                              'adjustment', v_movement.id);
  else
    perform public._take_chosen(v_product.id, v_loc, p_lots, v_current - p_quantity, v_movement.id);
  end if;

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------------------------------------------------------------------
-- _revert_movement: núcleo de undo_movement y cancel_movement.
--   Regresa las piezas exactamente a los lotes y la ubicación de los que
--   salieron (o las quita del lote que creó el movimiento). Si esas piezas
--   ya se vendieron o se movieron, falla: hay que hacer un ajuste.
--   Movimientos anteriores a los lotes (sin movement_lots): si hay que
--   regresar piezas, entra un lote 'adjustment' con el último costo; si hay
--   que quitarlas, salen de los lotes elegidos (p_lots).
-- ---------------------------------------------------------------------
create function public._revert_movement(
  p_target       public.inventory_movements,
  p_note         text,
  p_client_op_id uuid,
  p_lots         jsonb
)
returns public.inventory_movements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_movement public.inventory_movements;
  v_current  integer;
  r          record;
begin
  if p_target.type = 'sale' then
    raise exception 'Las ventas no se cancelan desde el historial de inventario' using errcode = '22023';
  end if;
  if p_target.type = 'barcode_unlink' then
    raise exception 'Un desvinculado no se cancela: vuelve a dar de alta el código' using errcode = '22023';
  end if;
  if p_target.type = 'transfer' then
    raise exception 'Un traspaso se corrige con otro traspaso en sentido contrario' using errcode = '22023';
  end if;
  if p_target.type = 'purchase' then
    raise exception 'Una compra se cancela desde Compras' using errcode = '22023';
  end if;
  if p_target.reverts_movement_id is not null then
    raise exception 'No se puede cancelar una cancelación' using errcode = '22023';
  end if;

  perform 1 from public.products where id = p_target.product_id for update;
  v_current := public._location_qty(p_target.product_id, p_target.location);

  insert into public.inventory_movements (
    product_id, type, delta, quantity_after, note, client_op_id, reverts_movement_id, created_by, location
  ) values (
    p_target.product_id,
    'adjustment',
    -p_target.delta,
    v_current - p_target.delta,
    p_note,
    p_client_op_id,
    p_target.id,
    auth.uid(),
    p_target.location
  )
  returning * into v_movement;

  if exists (select 1 from public.movement_lots where movement_id = p_target.id) then
    for r in
      select lot_id, location, sum(delta)::integer as delta
      from public.movement_lots where movement_id = p_target.id
      group by lot_id, location
      order by lot_id, location
    loop
      if r.delta > 0 then
        begin
          perform public._lot_take(r.lot_id, r.location, r.delta, v_movement.id);
        exception when sqlstate 'P0001' then
          raise exception 'Ya se vendieron o se movieron piezas de ese lote; corrige con un ajuste'
            using errcode = 'P0001';
        end;
      elsif r.delta < 0 then
        perform public._lot_add(r.lot_id, r.location, -r.delta, v_movement.id);
      end if;
    end loop;
  elsif p_target.delta < 0 then
    perform public._add_entry(p_target.product_id, p_target.location, -p_target.delta, null, null,
                              'adjustment', v_movement.id);
  elsif p_target.delta > 0 then
    perform public._take_chosen(p_target.product_id, p_target.location, p_lots, p_target.delta, v_movement.id);
  end if;

  return v_movement;
end;
$$;

-- undo_movement: "Deshacer" del escáner (solo admin).
-- status: 'ok' | 'duplicate' | 'already_undone'
create function public.undo_movement(
  p_movement_id  uuid,
  p_client_op_id uuid default null,
  p_lots         jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target   public.inventory_movements;
  v_movement public.inventory_movements;
begin
  perform public._require_admin();

  if p_client_op_id is not null then
    select * into v_movement from public.inventory_movements where client_op_id = p_client_op_id;
    if found then
      return public._movement_result('duplicate', v_movement);
    end if;
  end if;

  select * into v_target from public.inventory_movements where id = p_movement_id for update;
  if not found then
    raise exception 'Movimiento no encontrado' using errcode = 'P0002';
  end if;
  if v_target.type = 'adjustment' and v_target.reverts_movement_id is not null then
    raise exception 'No se puede deshacer un "deshacer"' using errcode = '22023';
  end if;

  select * into v_movement from public.inventory_movements where reverts_movement_id = p_movement_id;
  if found then
    return public._movement_result('already_undone', v_movement);
  end if;

  v_movement := public._revert_movement(
    v_target,
    'Deshacer: ' || case v_target.type
      when 'initial_count' then 'alta de producto'
      when 'scan_add'      then 'escaneo (sumar)'
      when 'set_total'     then 'escaneo (fijar total)'
      else 'ajuste'
    end,
    p_client_op_id,
    p_lots
  );

  return public._movement_result('ok', v_movement);
end;
$$;

-- cancel_movement: cancela un movimiento con su motivo (solo admin).
-- status: 'ok' | 'duplicate' | 'already_undone'
create function public.cancel_movement(
  p_movement_id  uuid,
  p_reason       text,
  p_client_op_id uuid default null,
  p_lots         jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target   public.inventory_movements;
  v_movement public.inventory_movements;
begin
  perform public._require_admin();

  if p_client_op_id is not null then
    select * into v_movement from public.inventory_movements where client_op_id = p_client_op_id;
    if found then
      return public._movement_result('duplicate', v_movement);
    end if;
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;

  select * into v_target from public.inventory_movements where id = p_movement_id for update;
  if not found then
    raise exception 'Movimiento no encontrado' using errcode = 'P0002';
  end if;

  select * into v_movement from public.inventory_movements where reverts_movement_id = p_movement_id;
  if found then
    return public._movement_result('already_undone', v_movement);
  end if;

  v_movement := public._revert_movement(
    v_target,
    'Cancelación de ' || case v_target.type
      when 'initial_count' then 'alta de producto'
      when 'scan_add'      then 'escaneo (sumar)'
      when 'set_total'     then 'escaneo (fijar total)'
      else 'ajuste'
    end || '. Motivo: ' || btrim(p_reason),
    p_client_op_id,
    p_lots
  );

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------------------------------------------------------------------
-- pay_ticket: igual que antes, pero
--   * las piezas salen de los lotes de la TIENDA, del más viejo (FIFO);
--   * si la tienda no alcanza, SIEMPRE se rechaza (p_offline ya no permite
--     cobrar sin stock; se conserva el parámetro por compatibilidad).
-- SECURITY DEFINER porque el mostrador no lee ni escribe lotes directamente.
-- ---------------------------------------------------------------------
create or replace function public.pay_ticket(
  p_ticket_id      uuid,
  -- Ya no se usa: el nombre es "Ticket N" con el folio que se asigna aquí.
  p_name           text,
  p_payment_method public.payment_method,
  p_items          jsonb,
  p_customer_id    uuid default null,
  p_opened_at      timestamptz default null,
  -- Ya no se usa (no se cobra sin conexión).
  p_offline        boolean default false,
  -- [{ "method": "cash", "amount": 500 }, { "method": "credit", "amount": 200 }]
  -- null = un solo pago por el total con p_payment_method.
  p_payments       jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket   public.tickets;
  v_items    jsonb;
  v_item     record;
  v_product  public.products;
  v_movement public.inventory_movements;
  v_missing  text;
  v_short    text[] := '{}';
  v_count    integer;
  v_total    numeric(12, 2);
  v_products jsonb := '[]'::jsonb;
  v_payments jsonb;
  v_paid     numeric(12, 2);
  v_credit   numeric(12, 2);
  v_balance  numeric(12, 2);
  v_methods  integer;
  v_method   public.payment_method;
  v_number   bigint;
begin
  -- Idempotencia: si ya se cobró (reintento), se devuelve tal cual.
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if found then
    return jsonb_build_object('status', 'duplicate', 'ticket', to_jsonb(v_ticket), 'products', '[]'::jsonb);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El ticket no tiene productos' using errcode = '22023';
  end if;

  -- Renglones agrupados por código (por si el mismo producto viene dos veces).
  select jsonb_agg(jsonb_build_object('barcode', barcode, 'quantity', quantity, 'unit_price', unit_price, 'position', position)
                   order by position)
  into v_items
  from (
    select
      btrim(e ->> 'barcode')             as barcode,
      sum((e ->> 'quantity')::integer)   as quantity,
      max((e ->> 'unit_price')::numeric) as unit_price,
      min(ord)                           as position
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
    group by btrim(e ->> 'barcode')
  ) g;

  if exists (
    select 1 from jsonb_to_recordset(v_items) as i(barcode text, quantity integer, unit_price numeric)
    where coalesce(i.barcode, '') = '' or i.quantity is null or i.quantity <= 0 or i.unit_price is null or i.unit_price < 0
  ) then
    raise exception 'Hay productos con datos inválidos en el ticket' using errcode = '22023';
  end if;

  select string_agg(i.barcode, ', ') into v_missing
  from jsonb_to_recordset(v_items) as i(barcode text)
  where not exists (select 1 from public.products p where p.barcode = i.barcode);
  if v_missing is not null then
    raise exception 'No existe el producto %', v_missing using errcode = 'P0002';
  end if;

  -- Bloquea los productos en orden fijo (evita interbloqueos) y revisa el
  -- stock de la TIENDA.
  for v_item in
    select p.name, p.quantity as stock, p.warehouse_quantity as warehouse, i.quantity
    from jsonb_to_recordset(v_items) as i(barcode text, quantity integer)
    join public.products p on p.barcode = i.barcode
    order by p.id
    for update of p
  loop
    if v_item.quantity > v_item.stock then
      v_short := v_short || format('%s (pide %s, hay %s en tienda%s)', v_item.name, v_item.quantity, v_item.stock,
        case when v_item.warehouse > 0 then format(' y %s en bodega: pide un movimiento', v_item.warehouse) else '' end);
    end if;
  end loop;

  if cardinality(v_short) > 0 then
    raise exception 'Stock insuficiente: %', array_to_string(v_short, '; ') using errcode = 'P0001';
  end if;

  select sum(i.quantity), sum(i.quantity * i.unit_price) into v_count, v_total
  from jsonb_to_recordset(v_items) as i(quantity integer, unit_price numeric);

  -- ---------- pagos ----------
  if p_payments is null then
    if p_payment_method is null or p_payment_method = 'mixed' then
      raise exception 'Falta la forma de pago' using errcode = '22023';
    end if;
    v_payments := case when v_total > 0
      then jsonb_build_array(jsonb_build_object('method', p_payment_method, 'amount', v_total))
      else '[]'::jsonb end;
  else
    if jsonb_typeof(p_payments) <> 'array' then
      raise exception 'Pagos inválidos' using errcode = '22023';
    end if;
    -- Agrupa por método (si el mismo método viene dos veces, se suma).
    select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amount)), '[]'::jsonb)
    into v_payments
    from (
      select e ->> 'method' as method, sum((e ->> 'amount')::numeric(12, 2)) as amount
      from jsonb_array_elements(p_payments) e
      group by e ->> 'method'
    ) g;
    if exists (
      select 1 from jsonb_to_recordset(v_payments) as x(method text, amount numeric)
      where x.method is null or x.method not in ('cash', 'card', 'credit', 'transfer') or x.amount is null or x.amount <= 0
    ) then
      raise exception 'Hay pagos con método o monto inválido' using errcode = '22023';
    end if;
  end if;

  select coalesce(sum(x.amount), 0), coalesce(sum(x.amount) filter (where x.method = 'credit'), 0), count(*)
  into v_paid, v_credit, v_methods
  from jsonb_to_recordset(v_payments) as x(method text, amount numeric);

  if v_paid <> v_total then
    raise exception 'Los pagos (%) no suman el total del ticket (%)', v_paid, v_total using errcode = '22023';
  end if;

  v_method := case
    when v_methods > 1 then 'mixed'::public.payment_method
    when v_methods = 1 then (v_payments -> 0 ->> 'method')::public.payment_method
    else coalesce(p_payment_method, 'cash')
  end;

  -- Créditos: el cliente debe tener saldo. Se bloquea al cliente para que dos
  -- cobros al mismo tiempo no usen el mismo saldo.
  if v_credit > 0 then
    if p_customer_id is null then
      raise exception 'Para pagar con créditos el ticket necesita un cliente' using errcode = '22023';
    end if;
    perform 1 from public.customers where id = p_customer_id for update;
    if not found then
      raise exception 'No existe el cliente' using errcode = 'P0002';
    end if;
    select coalesce(sum(amount), 0) into v_balance
    from public.customer_credit_movements where customer_id = p_customer_id;
    if v_credit > v_balance then
      raise exception 'Créditos insuficientes: el cliente tiene % y se quieren usar %', v_balance, v_credit using errcode = 'P0001';
    end if;
  end if;

  -- Folio consecutivo sin huecos: si algo falla más abajo, la transacción
  -- completa se deshace y el número no se pierde.
  v_number := public._next_ticket_number();

  insert into public.tickets (
    id, number, name, customer_id, payment_method, item_count, subtotal, total, paid_offline, note, opened_at, created_by
  ) values (
    p_ticket_id,
    v_number,
    'Ticket ' || v_number,
    p_customer_id,
    v_method,
    v_count,
    v_total,
    v_total,
    false,
    null,
    p_opened_at,
    auth.uid()
  )
  returning * into v_ticket;

  for v_item in
    select i.barcode, i.quantity, i.unit_price, i.position, p.id as product_id, p.name as product_name, p.quantity as stock
    from jsonb_to_recordset(v_items) as i(barcode text, quantity integer, unit_price numeric, position integer)
    join public.products p on p.barcode = i.barcode
    order by i.position
  loop
    insert into public.ticket_items (ticket_id, product_id, barcode, product_name, quantity, unit_price, position)
    values (v_ticket.id, v_item.product_id, v_item.barcode, v_item.product_name, v_item.quantity, v_item.unit_price, v_item.position);

    insert into public.inventory_movements (product_id, type, delta, quantity_after, note, ticket_id, created_by, location)
    values (v_item.product_id, 'sale', -v_item.quantity, v_item.stock - v_item.quantity, 'Venta: ' || v_ticket.name,
            v_ticket.id, auth.uid(), 'store')
    returning * into v_movement;

    perform public._take_auto(v_item.product_id, 'store', v_item.quantity, v_movement.id, false);

    select * into v_product from public.products where id = v_item.product_id;
    v_products := v_products || to_jsonb(v_product);
  end loop;

  insert into public.ticket_payments (ticket_id, method, amount)
  select v_ticket.id, x.method::public.payment_method, x.amount
  from jsonb_to_recordset(v_payments) as x(method text, amount numeric);

  if v_credit > 0 then
    insert into public.customer_credit_movements (customer_id, kind, amount, note, ticket_id, created_by)
    values (p_customer_id, 'sale', -v_credit, 'Compra: ' || v_ticket.name, v_ticket.id, auth.uid());
  end if;

  return jsonb_build_object('status', 'ok', 'ticket', to_jsonb(v_ticket), 'products', v_products, 'payments', v_payments);
end;
$$;

-- =====================================================================
-- Compras (solo admin)
-- =====================================================================

-- p_items: [{ "product_id": "...", "quantity": 10, "unit_cost": 55.50 }, ...]
-- Cada renglón crea su lote en la ubicación de la compra.
-- status: 'ok' | 'duplicate'
create function public.register_purchase(
  p_purchase_id uuid,
  p_supplier_id uuid,
  p_items       jsonb,
  p_location    public.stock_location default 'store',
  p_folio       text default null,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases;
  v_loc      public.stock_location := coalesce(p_location, 'store');
  v_item     record;
  v_pi       uuid;
  v_movement public.inventory_movements;
  v_current  integer;
begin
  perform public._require_admin();

  select * into v_purchase from public.purchases where id = p_purchase_id;
  if found then
    return jsonb_build_object('status', 'duplicate', 'purchase', to_jsonb(v_purchase));
  end if;

  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Elige el proveedor' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra no tiene productos' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as i(product_id uuid, quantity integer, unit_cost numeric)
    where i.product_id is null or i.quantity is null or i.quantity <= 0
       or i.unit_cost is null or i.unit_cost < 0 or i.unit_cost <> round(i.unit_cost, 2)
  ) then
    raise exception 'Hay productos con cantidad o costo inválido' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as i(product_id uuid)
    where not exists (select 1 from public.products p where p.id = i.product_id)
  ) then
    raise exception 'Uno de los productos no existe' using errcode = 'P0002';
  end if;

  -- Bloquea los productos en orden fijo (evita interbloqueos).
  perform 1 from public.products
  where id in (select (e ->> 'product_id')::uuid from jsonb_array_elements(p_items) e)
  order by id
  for update;

  insert into public.purchases (id, supplier_id, location, folio, note, created_by)
  values (p_purchase_id, p_supplier_id, v_loc, nullif(btrim(coalesce(p_folio, '')), ''),
          nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_purchase;

  for v_item in
    select (e ->> 'product_id')::uuid as product_id, (e ->> 'quantity')::integer as quantity,
           (e ->> 'unit_cost')::numeric(12, 2) as unit_cost, (ord - 1)::integer as position
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
    order by ord
  loop
    insert into public.purchase_items (purchase_id, product_id, quantity, unit_cost, position)
    values (v_purchase.id, v_item.product_id, v_item.quantity, v_item.unit_cost, v_item.position)
    returning id into v_pi;

    v_current := public._location_qty(v_item.product_id, v_loc);
    insert into public.inventory_movements (product_id, type, delta, quantity_after, note, purchase_id, created_by, location)
    values (v_item.product_id, 'purchase', v_item.quantity, v_current + v_item.quantity,
            'Compra' || coalesce(' ' || v_purchase.folio, '') || ' · ' || (select name from public.suppliers where id = p_supplier_id),
            v_purchase.id, auth.uid(), v_loc)
    returning * into v_movement;

    update public.purchase_items set movement_id = v_movement.id where id = v_pi;

    perform public._add_entry(v_item.product_id, v_loc, v_item.quantity, p_supplier_id, v_item.unit_cost,
                              'purchase', v_movement.id, null, v_pi);
  end loop;

  update public.purchases
  set total = (select coalesce(sum(quantity * unit_cost), 0) from public.purchase_items where purchase_id = v_purchase.id)
  where id = v_purchase.id
  returning * into v_purchase;

  return jsonb_build_object('status', 'ok', 'purchase', to_jsonb(v_purchase));
end;
$$;

-- Un lote está intacto si solo tiene su entrada (nada vendido, movido ni ajustado).
create function public._lot_is_intact(p_lot_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) = 1 from public.movement_lots where lot_id = p_lot_id;
$$;

-- update_purchase: corrige proveedor, folio, nota y costos.
--   Folio y nota se pueden cambiar siempre. Proveedor y costos solo si los
--   lotes afectados están intactos.
--   p_costs: [{ "item_id": "...", "unit_cost": 50 }, ...] (opcional)
create function public.update_purchase(
  p_purchase_id uuid,
  p_supplier_id uuid,
  p_folio       text default null,
  p_note        text default null,
  p_costs       jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases;
  r          record;
begin
  perform public._require_admin();

  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Compra no encontrada' using errcode = 'P0002';
  end if;
  if v_purchase.status = 'cancelled' then
    raise exception 'La compra está cancelada' using errcode = '22023';
  end if;
  if not exists (select 1 from public.suppliers where id = p_supplier_id) then
    raise exception 'Elige el proveedor' using errcode = '22023';
  end if;
  if p_costs is not null and (jsonb_typeof(p_costs) <> 'array' or exists (
    select 1 from jsonb_to_recordset(p_costs) as c(item_id uuid, unit_cost numeric)
    where c.unit_cost is null or c.unit_cost < 0 or c.unit_cost <> round(c.unit_cost, 2)
       or not exists (select 1 from public.purchase_items pi where pi.id = c.item_id and pi.purchase_id = p_purchase_id)
  )) then
    raise exception 'Hay costos inválidos' using errcode = '22023';
  end if;

  -- Renglones que cambian (proveedor de toda la compra, o su costo).
  for r in
    select pi.id as item_id, l.id as lot_id, coalesce(c.unit_cost, pi.unit_cost)::numeric(12, 2) as new_cost, pi.unit_cost as old_cost
    from public.purchase_items pi
    join public.lots l on l.purchase_item_id = pi.id
    left join jsonb_to_recordset(coalesce(p_costs, '[]'::jsonb)) as c(item_id uuid, unit_cost numeric) on c.item_id = pi.id
    where pi.purchase_id = p_purchase_id
      and (p_supplier_id <> v_purchase.supplier_id or coalesce(c.unit_cost, pi.unit_cost) <> pi.unit_cost)
    order by pi.position
    for update of l
  loop
    if not public._lot_is_intact(r.lot_id) then
      raise exception 'Ya se vendieron, movieron o ajustaron piezas de esta compra; corrige con un ajuste'
        using errcode = 'P0001';
    end if;
    update public.purchase_items set unit_cost = r.new_cost where id = r.item_id;
    update public.lots set unit_cost = r.new_cost, supplier_id = p_supplier_id where id = r.lot_id;
    update public.movement_lots set unit_cost = r.new_cost where lot_id = r.lot_id;
  end loop;

  update public.purchases
  set supplier_id = p_supplier_id,
      folio = nullif(btrim(coalesce(p_folio, '')), ''),
      note = nullif(btrim(coalesce(p_note, '')), ''),
      total = (select coalesce(sum(quantity * unit_cost), 0) from public.purchase_items where purchase_id = p_purchase_id)
  where id = p_purchase_id
  returning * into v_purchase;

  return jsonb_build_object('status', 'ok', 'purchase', to_jsonb(v_purchase));
end;
$$;

-- cancel_purchase: regresa todas las piezas de la compra (solo si ninguna
-- se ha vendido, movido ni ajustado). Queda en el historial como cancelada.
create function public.cancel_purchase(p_purchase_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_purchase public.purchases;
  v_movement public.inventory_movements;
  r          record;
begin
  perform public._require_admin();

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;

  select * into v_purchase from public.purchases where id = p_purchase_id for update;
  if not found then
    raise exception 'Compra no encontrada' using errcode = 'P0002';
  end if;
  if v_purchase.status = 'cancelled' then
    return jsonb_build_object('status', 'already_cancelled', 'purchase', to_jsonb(v_purchase));
  end if;

  perform 1 from public.products
  where id in (select product_id from public.purchase_items where purchase_id = p_purchase_id)
  order by id
  for update;

  for r in
    select pi.id, pi.product_id, pi.quantity, pi.movement_id, l.id as lot_id
    from public.purchase_items pi
    join public.lots l on l.purchase_item_id = pi.id
    where pi.purchase_id = p_purchase_id
    order by pi.position
  loop
    if not public._lot_is_intact(r.lot_id) then
      raise exception 'Ya se vendieron, movieron o ajustaron piezas de esta compra; corrige con un ajuste'
        using errcode = 'P0001';
    end if;

    insert into public.inventory_movements (
      product_id, type, delta, quantity_after, note, reverts_movement_id, purchase_id, created_by, location
    ) values (
      r.product_id,
      'adjustment',
      -r.quantity,
      public._location_qty(r.product_id, v_purchase.location) - r.quantity,
      'Cancelación de compra. Motivo: ' || btrim(p_reason),
      r.movement_id,
      v_purchase.id,
      auth.uid(),
      v_purchase.location
    )
    returning * into v_movement;

    perform public._lot_take(r.lot_id, v_purchase.location, r.quantity, v_movement.id);
  end loop;

  update public.purchases
  set status = 'cancelled', cancel_reason = btrim(p_reason), cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_purchase_id
  returning * into v_purchase;

  return jsonb_build_object('status', 'ok', 'purchase', to_jsonb(v_purchase));
end;
$$;

-- =====================================================================
-- Movimiento de bodega (solo admin)
--   p_items: [{ "product_id": "...", "quantity": 20 }, ...]
--   Todo o nada: si a algún producto no le alcanza el origen, no se mueve
--   nada y el error trae en DETAIL (JSON) lo disponible de cada uno.
-- status: 'ok' | 'duplicate'
-- =====================================================================
create function public.create_transfer(
  p_transfer_id uuid,
  p_from        public.stock_location,
  p_to          public.stock_location,
  p_items       jsonb,
  p_note        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.transfers;
  v_item     record;
  v_short    jsonb := '[]'::jsonb;
  v_out      public.inventory_movements;
  v_in       public.inventory_movements;
  v_from_qty integer;
  v_to_qty   integer;
  v_label    text;
  r          record;
begin
  perform public._require_admin();

  select * into v_transfer from public.transfers where id = p_transfer_id;
  if found then
    return jsonb_build_object('status', 'duplicate', 'transfer', to_jsonb(v_transfer));
  end if;

  if p_from is null or p_to is null or p_from = p_to then
    raise exception 'Origen y destino deben ser distintos' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El movimiento no tiene productos' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as i(product_id uuid, quantity integer)
    where i.product_id is null or i.quantity is null or i.quantity <= 0
  ) then
    raise exception 'Hay productos con cantidad inválida' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_items) as i(product_id uuid)
    where not exists (select 1 from public.products p where p.id = i.product_id)
  ) then
    raise exception 'Uno de los productos no existe' using errcode = 'P0002';
  end if;

  -- Bloquea los productos en orden fijo y revisa el origen.
  for v_item in
    select p.id, p.name, i.quantity,
           case when p_from = 'store' then p.quantity else p.warehouse_quantity end as available
    from (
      select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::integer)::integer as quantity
      from jsonb_array_elements(p_items) e group by 1
    ) i
    join public.products p on p.id = i.product_id
    order by p.id
    for update of p
  loop
    if v_item.quantity > v_item.available then
      v_short := v_short || jsonb_build_object(
        'product_id', v_item.id, 'name', v_item.name, 'requested', v_item.quantity, 'available', v_item.available);
    end if;
  end loop;

  if jsonb_array_length(v_short) > 0 then
    raise exception 'No hay suficiente en %: %', public._location_name(p_from),
      (select string_agg(format('%s (pide %s, hay %s)', s ->> 'name', s ->> 'requested', s ->> 'available'), '; ')
       from jsonb_array_elements(v_short) s)
      using errcode = 'P0001', detail = v_short::text, hint = 'insufficient_stock';
  end if;

  insert into public.transfers (id, from_location, to_location, note, created_by)
  values (p_transfer_id, p_from, p_to, nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
  returning * into v_transfer;

  v_label := case when p_from = 'warehouse' then 'Bodega → Tienda' else 'Tienda → Bodega' end;

  for v_item in
    select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    insert into public.transfer_items (transfer_id, product_id, quantity)
    values (v_transfer.id, v_item.product_id, v_item.quantity);

    v_from_qty := public._location_qty(v_item.product_id, p_from);
    v_to_qty := public._location_qty(v_item.product_id, p_to);

    insert into public.inventory_movements (product_id, type, delta, quantity_after, note, transfer_id, created_by, location)
    values (v_item.product_id, 'transfer', -v_item.quantity, v_from_qty - v_item.quantity,
            'Movimiento ' || v_label || coalesce('. ' || v_transfer.note, ''), v_transfer.id, auth.uid(), p_from)
    returning * into v_out;

    insert into public.inventory_movements (product_id, type, delta, quantity_after, note, transfer_id, created_by, location)
    values (v_item.product_id, 'transfer', v_item.quantity, v_to_qty + v_item.quantity,
            'Movimiento ' || v_label || coalesce('. ' || v_transfer.note, ''), v_transfer.id, auth.uid(), p_to)
    returning * into v_in;

    -- Tienda → bodega saca lo más nuevo (no altera el FIFO de venta).
    for r in select * from public._take_auto(v_item.product_id, p_from, v_item.quantity, v_out.id, p_from = 'store') loop
      perform public._lot_add(r.o_lot_id, p_to, r.o_quantity, v_in.id);
    end loop;
  end loop;

  return jsonb_build_object('status', 'ok', 'transfer', to_jsonb(v_transfer));
end;
$$;

-- ---------- contador de la pantalla de escaneo ----------
create or replace function public.inventory_totals()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'products',         count(*),
    'pieces',           coalesce(sum(quantity), 0),
    'warehouse_pieces', coalesce(sum(warehouse_quantity), 0),
    'total_pieces',     coalesce(sum(quantity + warehouse_quantity), 0)
  )
  from public.products;
$$;

-- =====================================================================
-- Vistas (respetan RLS: lotes, costos y proveedores solo los ve un admin)
-- =====================================================================

-- Lotes con piezas, por ubicación (ficha de producto, elegir lote).
create view public.product_lots
with (security_invoker = true)
as
select
  l.id          as lot_id,
  l.number,
  l.product_id,
  ls.location,
  ls.quantity,
  l.received_quantity,
  l.unit_cost,
  l.supplier_id,
  s.name        as supplier_name,
  l.origin,
  l.entry_location,
  l.received_at,
  pi.purchase_id,
  pu.folio      as purchase_folio
from public.lot_stock ls
join public.lots l on l.id = ls.lot_id
left join public.suppliers s on s.id = l.supplier_id
left join public.purchase_items pi on pi.id = l.purchase_item_id
left join public.purchases pu on pu.id = pi.purchase_id
where ls.quantity > 0;

-- Historial de compras.
create view public.purchase_history
with (security_invoker = true)
as
select
  p.id,
  p.created_at,
  p.supplier_id,
  s.name                            as supplier_name,
  p.location,
  p.folio,
  p.note,
  p.total,
  p.status,
  p.cancel_reason,
  p.cancelled_at,
  coalesce(cp.full_name, cp.email)  as cancelled_by_name,
  p.created_by,
  coalesce(pr.full_name, pr.email)  as created_by_name,
  (select count(*) from public.purchase_items i where i.purchase_id = p.id)                 as item_count,
  (select coalesce(sum(i.quantity), 0) from public.purchase_items i where i.purchase_id = p.id) as piece_count,
  -- true si ninguna pieza se ha vendido, movido ni ajustado (se puede corregir).
  not exists (
    select 1 from public.purchase_items i join public.lots l on l.purchase_item_id = i.id
    where i.purchase_id = p.id and not public._lot_is_intact(l.id)
  )                                 as is_intact
from public.purchases p
join public.suppliers s on s.id = p.supplier_id
left join public.profiles pr on pr.id = p.created_by
left join public.profiles cp on cp.id = p.cancelled_by;

-- Renglones de compra con producto.
create view public.purchase_item_details
with (security_invoker = true)
as
select
  i.id,
  i.purchase_id,
  i.position,
  i.product_id,
  pr.barcode,
  pr.name      as product_name,
  i.quantity,
  i.unit_cost,
  i.quantity * i.unit_cost as line_total,
  l.number     as lot_number
from public.purchase_items i
join public.products pr on pr.id = i.product_id
left join public.lots l on l.purchase_item_id = i.id;

-- Historial de traspasos.
create view public.transfer_history
with (security_invoker = true)
as
select
  t.id,
  t.created_at,
  t.from_location,
  t.to_location,
  t.note,
  t.created_by,
  coalesce(pr.full_name, pr.email) as created_by_name,
  (select count(*) from public.transfer_items i where i.transfer_id = t.id)                   as item_count,
  (select coalesce(sum(i.quantity), 0) from public.transfer_items i where i.transfer_id = t.id) as piece_count
from public.transfers t
left join public.profiles pr on pr.id = t.created_by;

-- De qué lotes salió cada producto de cada traspaso.
create view public.transfer_item_lots
with (security_invoker = true)
as
select
  m.transfer_id,
  m.product_id,
  p.barcode,
  p.name       as product_name,
  l.id         as lot_id,
  l.number     as lot_number,
  -ml.delta    as quantity,
  ml.unit_cost,
  s.name       as supplier_name,
  l.received_at
from public.inventory_movements m
join public.movement_lots ml on ml.movement_id = m.id
join public.lots l on l.id = ml.lot_id
join public.products p on p.id = m.product_id
left join public.suppliers s on s.id = l.supplier_id
where m.transfer_id is not null and ml.delta < 0;

-- Utilidad por renglón de venta (costo = lo que costaron los lotes).
create view public.sale_item_profit
with (security_invoker = true)
as
select
  ti.id         as ticket_item_id,
  ti.ticket_id,
  ti.product_id,
  ti.quantity,
  ti.unit_price,
  ti.line_total as revenue,
  coalesce(c.cost, 0) as cost,
  ti.line_total - coalesce(c.cost, 0) as profit
from public.ticket_items ti
left join lateral (
  select sum(-ml.delta * ml.unit_cost) as cost
  from public.inventory_movements m
  join public.movement_lots ml on ml.movement_id = m.id
  where m.ticket_id = ti.ticket_id and m.product_id = ti.product_id and m.type = 'sale'
) c on true;

-- Control de integridad: debe estar SIEMPRE vacía.
--   * lot_stock = suma de movement_lots por lote y ubicación
--   * products.quantity / warehouse_quantity = suma de sus lotes
create view public.stock_mismatches
with (security_invoker = true)
as
select 'lot' as kind, ls.lot_id as id, ls.location::text as location, ls.quantity as recorded, coalesce(m.total, 0) as expected
from public.lot_stock ls
left join (
  select lot_id, location, sum(delta) as total from public.movement_lots group by lot_id, location
) m on m.lot_id = ls.lot_id and m.location = ls.location
where ls.quantity <> coalesce(m.total, 0)
union all
select 'product', p.id, 'store', p.quantity, coalesce(s.total, 0)
from public.products p
left join (
  select l.product_id, sum(ls.quantity) as total from public.lot_stock ls join public.lots l on l.id = ls.lot_id
  where ls.location = 'store' group by l.product_id
) s on s.product_id = p.id
where p.quantity <> coalesce(s.total, 0)
union all
select 'product', p.id, 'warehouse', p.warehouse_quantity, coalesce(w.total, 0)
from public.products p
left join (
  select l.product_id, sum(ls.quantity) as total from public.lot_stock ls join public.lots l on l.id = ls.lot_id
  where ls.location = 'warehouse' group by l.product_id
) w on w.product_id = p.id
where p.warehouse_quantity <> coalesce(w.total, 0);

-- Historial de movimientos: + ubicación, compra, traspaso y lotes.
create or replace view public.movement_history
with (security_invoker = true)
as
select
  m.id,
  m.created_at,
  m.type,
  m.delta,
  m.quantity_after,
  m.note,
  m.reverts_movement_id,
  m.product_id,
  p.barcode,
  p.name       as product_name,
  m.created_by,
  pr.email     as created_by_email,
  pr.full_name as created_by_name,
  m.old_barcode,
  r.id         as cancelled_by_movement_id,
  r.created_at as cancelled_at,
  r.note       as cancel_note,
  coalesce(rp.full_name, rp.email) as cancelled_by_name,
  m.location,
  m.purchase_id,
  m.transfer_id,
  m.ticket_id,
  (select string_agg(l.number::text, ', ' order by l.number)
   from public.movement_lots ml join public.lots l on l.id = ml.lot_id
   where ml.movement_id = m.id) as lot_numbers
from public.inventory_movements m
join public.products p on p.id = m.product_id
left join public.profiles pr on pr.id = m.created_by
left join public.inventory_movements r on r.reverts_movement_id = m.id
left join public.profiles rp on rp.id = r.created_by;

-- =====================================================================
-- Permisos
-- =====================================================================
alter table public.suppliers      enable row level security;
alter table public.purchases      enable row level security;
alter table public.purchase_items enable row level security;
alter table public.transfers      enable row level security;
alter table public.transfer_items enable row level security;
alter table public.lots           enable row level security;
alter table public.lot_stock      enable row level security;
alter table public.movement_lots  enable row level security;

revoke all on public.suppliers, public.purchases, public.purchase_items, public.transfers, public.transfer_items,
              public.lots, public.lot_stock, public.movement_lots
  from anon, authenticated;

-- Solo lectura (y solo admin, por RLS). Se escribe únicamente con las funciones.
grant select on public.suppliers, public.purchases, public.purchase_items, public.transfers, public.transfer_items,
                public.lots, public.lot_stock, public.movement_lots
  to authenticated;
-- Proveedores: el admin también los crea y edita desde la app.
grant insert (name, contact, note), update (name, contact, note) on public.suppliers to authenticated;

create policy "suppliers: admin lee"        on public.suppliers      for select to authenticated using (public.is_admin());
create policy "suppliers: admin crea"       on public.suppliers      for insert to authenticated with check (public.is_admin());
create policy "suppliers: admin edita"      on public.suppliers      for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "purchases: admin lee"        on public.purchases      for select to authenticated using (public.is_admin());
create policy "purchase_items: admin lee"   on public.purchase_items for select to authenticated using (public.is_admin());
create policy "transfers: admin lee"        on public.transfers      for select to authenticated using (public.is_admin());
create policy "transfer_items: admin lee"   on public.transfer_items for select to authenticated using (public.is_admin());
create policy "lots: admin lee"             on public.lots           for select to authenticated using (public.is_admin());
create policy "lot_stock: admin lee"        on public.lot_stock      for select to authenticated using (public.is_admin());
create policy "movement_lots: admin lee"    on public.movement_lots  for select to authenticated using (public.is_admin());

revoke all on public.product_lots, public.purchase_history, public.purchase_item_details, public.transfer_history,
              public.transfer_item_lots, public.sale_item_profit, public.stock_mismatches
  from anon, authenticated;
grant select on public.product_lots, public.purchase_history, public.purchase_item_details, public.transfer_history,
                public.transfer_item_lots, public.sale_item_profit, public.stock_mismatches
  to authenticated;

-- Internas: ni la app ni anon.
revoke all on function public._sync_product_stock() from public, anon, authenticated;
revoke all on function public.guard_product_stock() from public, anon, authenticated;
revoke all on function public.sync_product_supplier() from public, anon, authenticated;
revoke all on function public.sync_supplier_name() from public, anon, authenticated;
revoke all on function public._resolve_supplier(uuid, text) from public, anon, authenticated;
revoke all on function public._require_admin() from public, anon, authenticated;
revoke all on function public._location_qty(uuid, public.stock_location) from public, anon, authenticated;
revoke all on function public._location_name(public.stock_location) from public, anon, authenticated;
revoke all on function public._lot_add(uuid, public.stock_location, integer, uuid) from public, anon, authenticated;
revoke all on function public._lot_take(uuid, public.stock_location, integer, uuid) from public, anon, authenticated;
revoke all on function public._take_auto(uuid, public.stock_location, integer, uuid, boolean) from public, anon, authenticated;
revoke all on function public._take_chosen(uuid, public.stock_location, jsonb, integer, uuid) from public, anon, authenticated;
revoke all on function public._add_entry(uuid, public.stock_location, integer, uuid, numeric, public.lot_origin, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public._revert_movement(public.inventory_movements, text, uuid, jsonb) from public, anon, authenticated;
-- La vista purchase_history la usa (corre con los permisos de quien consulta).
revoke all on function public._lot_is_intact(uuid) from public, anon;
grant execute on function public._lot_is_intact(uuid) to authenticated;

-- De la app (cada una revisa el rol por dentro).
revoke all on function public.register_scan(text, text, integer, uuid, text, public.stock_location, uuid, numeric, uuid, jsonb) from public, anon;
revoke all on function public.create_product(text, text, numeric, numeric, text, text, integer, text, uuid, text, bigint, public.stock_location, uuid) from public, anon;
revoke all on function public.adjust_stock(uuid, integer, text, uuid, public.stock_location, jsonb, uuid, numeric) from public, anon;
revoke all on function public.undo_movement(uuid, uuid, jsonb) from public, anon;
revoke all on function public.cancel_movement(uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.pay_ticket(uuid, text, public.payment_method, jsonb, uuid, timestamptz, boolean, jsonb) from public, anon;
revoke all on function public.register_purchase(uuid, uuid, jsonb, public.stock_location, text, text) from public, anon;
revoke all on function public.update_purchase(uuid, uuid, text, text, jsonb) from public, anon;
revoke all on function public.cancel_purchase(uuid, text) from public, anon;
revoke all on function public.create_transfer(uuid, public.stock_location, public.stock_location, jsonb, text) from public, anon;
revoke all on function public.inventory_totals() from public, anon;

grant execute on function public.register_scan(text, text, integer, uuid, text, public.stock_location, uuid, numeric, uuid, jsonb) to authenticated;
grant execute on function public.create_product(text, text, numeric, numeric, text, text, integer, text, uuid, text, bigint, public.stock_location, uuid) to authenticated;
grant execute on function public.adjust_stock(uuid, integer, text, uuid, public.stock_location, jsonb, uuid, numeric) to authenticated;
grant execute on function public.undo_movement(uuid, uuid, jsonb) to authenticated;
grant execute on function public.cancel_movement(uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.pay_ticket(uuid, text, public.payment_method, jsonb, uuid, timestamptz, boolean, jsonb) to authenticated;
grant execute on function public.register_purchase(uuid, uuid, jsonb, public.stock_location, text, text) to authenticated;
grant execute on function public.update_purchase(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.cancel_purchase(uuid, text) to authenticated;
grant execute on function public.create_transfer(uuid, public.stock_location, public.stock_location, jsonb, text) to authenticated;
grant execute on function public.inventory_totals() to authenticated;
