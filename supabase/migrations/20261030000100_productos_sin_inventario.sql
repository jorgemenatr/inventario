-- =====================================================================
-- Productos sin control de inventario
--
-- Comida, torneos y otros servicios se venden pero no tienen existencias.
-- products.track_stock = false:
--   * pay_ticket no revisa ni descuenta stock (no hay lote ni movimiento de
--     inventario; la venta queda en ticket_items como siempre, con costo 0
--     en sale_item_profit).
--   * No pueden recibir piezas (escaneo, compra, ajuste, alta con cantidad):
--     _lot_add lo rechaza.
--   * Solo se marca así un producto con 0 piezas en tienda y bodega.
--   * Solo un admin lo cambia (guard_products).
-- =====================================================================

alter table public.products add column track_stock boolean not null default true;

-- ---------------------------------------------------------------------
-- guard_products: track_stock también es solo de admin.
-- ---------------------------------------------------------------------
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
      new.is_internal_code, new.description, new.catalog_product_id, new.track_stock)
     is distinct from
     (old.barcode, old.name, old.category, old.supplier, old.supplier_id, old.cost, old.price, old.image_url,
      old.is_internal_code, old.description, old.catalog_product_id, old.track_stock) then
    raise exception 'Solo un administrador puede editar productos' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Un producto con piezas no se puede marcar sin inventario (se perderían de
-- vista): primero se dejan en 0 con un ajuste.
create function public.guard_track_stock()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not new.track_stock and (new.quantity <> 0 or new.warehouse_quantity <> 0) then
    raise exception '% tiene piezas en tienda o bodega: déjalas en 0 antes de quitarle el inventario', new.name
      using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger products_track_stock_guard
  before insert or update of track_stock on public.products
  for each row execute function public.guard_track_stock();

revoke all on function public.guard_track_stock() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- _lot_add: un producto sin inventario no recibe piezas.
-- ---------------------------------------------------------------------
create or replace function public._lot_add(p_lot_id uuid, p_location public.stock_location, p_quantity integer, p_movement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Cantidad inválida: %', p_quantity using errcode = '22023';
  end if;
  select p.* into v_product from public.lots l join public.products p on p.id = l.product_id where l.id = p_lot_id;
  if not v_product.track_stock then
    raise exception '% no lleva inventario: no se le pueden sumar piezas', v_product.name using errcode = '22023';
  end if;

  insert into public.lot_stock (lot_id, location, quantity) values (p_lot_id, p_location, p_quantity)
  on conflict (lot_id, location) do update set quantity = public.lot_stock.quantity + excluded.quantity;

  insert into public.movement_lots (movement_id, lot_id, location, delta, unit_cost)
  select p_movement_id, l.id, p_location, p_quantity, l.unit_cost from public.lots l where l.id = p_lot_id;
end;
$$;

-- ---------------------------------------------------------------------
-- pay_ticket: los productos sin inventario no revisan stock ni generan
-- movimiento. Se parcha la definición vigente (como en nombre_tickets).
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef(
    'public.pay_ticket(uuid, text, public.payment_method, jsonb, uuid, timestamptz, boolean, jsonb)'::regprocedure);
  v_old text;
  v_new text;
  v_parts text[][] := array[
    -- Revisión de stock: se lee track_stock y solo se exige stock si lo lleva.
    array['select p.name, p.quantity as stock, p.warehouse_quantity as warehouse, i.quantity
',
          'select p.name, p.quantity as stock, p.warehouse_quantity as warehouse, i.quantity, p.track_stock
'],
    array['if v_item.quantity > v_item.stock then',
          'if v_item.track_stock and v_item.quantity > v_item.stock then'],
    -- Renglones: el movimiento y la salida de lotes solo si lleva inventario.
    array['p.name as product_name, p.quantity as stock
',
          'p.name as product_name, p.quantity as stock, p.track_stock
'],
    array['    insert into public.inventory_movements (product_id, type, delta, quantity_after, note, ticket_id, created_by, location)
    values (v_item.product_id, ''sale'', -v_item.quantity, v_item.stock - v_item.quantity, ''Venta: '' || v_ticket.name,
            v_ticket.id, auth.uid(), ''store'')
    returning * into v_movement;

    perform public._take_auto(v_item.product_id, ''store'', v_item.quantity, v_movement.id, false);
',
          '    if v_item.track_stock then
      insert into public.inventory_movements (product_id, type, delta, quantity_after, note, ticket_id, created_by, location)
      values (v_item.product_id, ''sale'', -v_item.quantity, v_item.stock - v_item.quantity, ''Venta: '' || v_ticket.name,
              v_ticket.id, auth.uid(), ''store'')
      returning * into v_movement;

      perform public._take_auto(v_item.product_id, ''store'', v_item.quantity, v_movement.id, false);
    end if;
']
  ];
begin
  for i in 1 .. array_length(v_parts, 1) loop
    v_old := v_parts[i][1];
    v_new := v_parts[i][2];
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception 'pay_ticket cambió (parte %): revisa esta migración', i;
    end if;
    v_def := replace(v_def, v_old, v_new);
  end loop;
  execute v_def;
end $$;
