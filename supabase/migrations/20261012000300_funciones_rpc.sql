-- =====================================================================
-- Inventario Hachiko · Fase 1 · Funciones RPC
-- Todos los cambios de cantidad pasan por aquí: actualizan products.quantity
-- e insertan el movimiento en la misma transacción.
-- SECURITY INVOKER + search_path fijo: corren con los permisos y RLS del usuario.
-- Todas aceptan p_client_op_id para que la cola offline pueda reintentar
-- sin duplicar (si ya existe un movimiento con ese id, se devuelve ese resultado).
-- =====================================================================

-- Respuesta común: { status, movement_id, delta, quantity_after, product }
create function public._movement_result(p_status text, p_movement public.inventory_movements)
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
    'delta',          p_movement.delta,
    'quantity_after', p_movement.quantity_after,
    'product',        to_jsonb(p)
  )
  from public.products p
  where p.id = p_movement.product_id;
$$;

-- ---------------------------------------------------------------------
-- register_scan: escaneo de un código existente.
--   p_mode = 'add' → suma p_quantity (scan_add)
--   p_mode = 'set' → fija la cantidad en p_quantity (set_total)
-- status: 'ok' | 'duplicate' (op ya aplicada) | 'not_found' (código no existe)
-- ---------------------------------------------------------------------
create function public.register_scan(
  p_barcode      text,
  p_mode         text,
  p_quantity     integer,
  p_client_op_id uuid default null,
  p_note         text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product  public.products;
  v_movement public.inventory_movements;
  v_new_qty  integer;
begin
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

  select * into v_product
  from public.products
  where barcode = btrim(p_barcode)
  for update;

  if not found then
    return jsonb_build_object('status', 'not_found', 'barcode', btrim(p_barcode));
  end if;

  v_new_qty := case when p_mode = 'add' then v_product.quantity + p_quantity else p_quantity end;

  update public.products set quantity = v_new_qty where id = v_product.id;

  insert into public.inventory_movements (product_id, type, delta, quantity_after, note, client_op_id, created_by)
  values (
    v_product.id,
    case when p_mode = 'add' then 'scan_add' else 'set_total' end::public.movement_type,
    v_new_qty - v_product.quantity,
    v_new_qty,
    p_note,
    p_client_op_id,
    auth.uid()
  )
  returning * into v_movement;

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------------------------------------------------------------------
-- create_product: alta de producto + movimiento initial_count.
--   p_barcode vacío/null → genera código interno HCH-000001.
-- status: 'ok' | 'duplicate' (op ya aplicada) | 'exists' (el código ya existe;
--         no se modifica nada y se devuelve el producto existente)
-- ---------------------------------------------------------------------
create function public.create_product(
  p_barcode          text,
  p_name             text,
  p_price            numeric,
  p_cost             numeric default null,
  p_category         text default null,
  p_supplier         text default null,
  p_initial_quantity integer default 0,
  p_image_url        text default null,
  p_client_op_id     uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_barcode  text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_internal boolean := false;
  v_product  public.products;
  v_movement public.inventory_movements;
begin
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
    barcode, name, price, cost, category, supplier, quantity, image_url, is_internal_code, created_by
  ) values (
    v_barcode,
    btrim(p_name),
    p_price,
    p_cost,
    nullif(btrim(coalesce(p_category, '')), ''),
    nullif(btrim(coalesce(p_supplier, '')), ''),
    p_initial_quantity,
    p_image_url,
    v_internal,
    auth.uid()
  )
  returning * into v_product;

  insert into public.inventory_movements (product_id, type, delta, quantity_after, note, client_op_id, created_by)
  values (v_product.id, 'initial_count', p_initial_quantity, p_initial_quantity, 'Alta de producto', p_client_op_id, auth.uid())
  returning * into v_movement;

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------------------------------------------------------------------
-- undo_movement: revierte un movimiento registrando un 'adjustment'
-- con delta opuesto. Cada movimiento solo se puede deshacer una vez.
-- status: 'ok' | 'duplicate' | 'already_undone'
-- ---------------------------------------------------------------------
create function public.undo_movement(
  p_movement_id  uuid,
  p_client_op_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_target   public.inventory_movements;
  v_movement public.inventory_movements;
  v_qty      integer;
begin
  if p_client_op_id is not null then
    select * into v_movement from public.inventory_movements where client_op_id = p_client_op_id;
    if found then
      return public._movement_result('duplicate', v_movement);
    end if;
  end if;

  select * into v_target from public.inventory_movements where id = p_movement_id;
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

  select quantity into v_qty from public.products where id = v_target.product_id for update;

  update public.products set quantity = v_qty - v_target.delta where id = v_target.product_id;

  insert into public.inventory_movements (
    product_id, type, delta, quantity_after, note, client_op_id, reverts_movement_id, created_by
  ) values (
    v_target.product_id,
    'adjustment',
    -v_target.delta,
    v_qty - v_target.delta,
    'Deshacer: ' || case v_target.type
      when 'initial_count' then 'alta de producto'
      when 'scan_add'      then 'escaneo (sumar)'
      when 'set_total'     then 'escaneo (fijar total)'
      when 'sale'          then 'venta'
      else 'ajuste'
    end,
    p_client_op_id,
    v_target.id,
    auth.uid()
  )
  returning * into v_movement;

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------------------------------------------------------------------
-- inventory_totals: contador de la pantalla de escaneo.
-- ---------------------------------------------------------------------
create function public.inventory_totals()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'products', count(*),
    'pieces',   coalesce(sum(quantity), 0)
  )
  from public.products;
$$;

-- ---------------------------------------------------------------------
-- Vista de historial (respeta RLS del usuario gracias a security_invoker).
-- ---------------------------------------------------------------------
create view public.movement_history
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
  pr.full_name as created_by_name
from public.inventory_movements m
join public.products p on p.id = m.product_id
left join public.profiles pr on pr.id = m.created_by;

-- ---------- Permisos de ejecución ----------
revoke all on function public._movement_result(text, public.inventory_movements) from public, anon, authenticated;
revoke all on function public.register_scan(text, text, integer, uuid, text) from public, anon;
revoke all on function public.create_product(text, text, numeric, numeric, text, text, integer, text, uuid) from public, anon;
revoke all on function public.undo_movement(uuid, uuid) from public, anon;
revoke all on function public.inventory_totals() from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.set_updated_at() from public, anon, authenticated;

grant execute on function public._movement_result(text, public.inventory_movements) to authenticated;
grant execute on function public.register_scan(text, text, integer, uuid, text) to authenticated;
grant execute on function public.create_product(text, text, numeric, numeric, text, text, integer, text, uuid) to authenticated;
grant execute on function public.undo_movement(uuid, uuid) to authenticated;
grant execute on function public.inventory_totals() to authenticated;

revoke all on public.movement_history from anon, authenticated;
grant select on public.movement_history to authenticated;
