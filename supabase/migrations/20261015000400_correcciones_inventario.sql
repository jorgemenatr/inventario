-- =====================================================================
-- Inventario Hachiko · Correcciones de inventario (solo admin)
--
--   unlink_product   Desvincula un producto de su código de barras y del
--                    catálogo TCGplayer: se queda con un código interno HCH-
--                    y el código real queda libre para darlo de alta de nuevo.
--   cancel_movement  Cancela un movimiento (alta, escaneo, ajuste). No borra
--                    nada: registra un movimiento que lo revierte y el
--                    original queda marcado como cancelado.
--   adjust_stock     Fija la cantidad correcta de un producto.
--
-- Las tres piden un motivo y quedan en el historial con quién y cuándo.
-- Los candados de rol (solo admin) los pone el trigger de
-- 20261015000100_roles_usuarios.sql sobre inventory_movements.
-- =====================================================================

-- Se usa solo dentro de funciones (en tiempo de ejecución), así que se puede
-- agregar en la misma transacción.
alter type public.movement_type add value if not exists 'barcode_unlink';

-- Código que tenía el producto antes de desvincularlo.
alter table public.inventory_movements add column old_barcode text;

create index inventory_movements_old_barcode_idx on public.inventory_movements (old_barcode) where old_barcode is not null;

-- ---------------------------------------------------------------------
-- unlink_product: libera el código de barras y quita el vínculo al catálogo.
--   Si el producto ya tenía código interno, solo quita el vínculo al catálogo.
-- status: 'ok' | 'duplicate'
-- ---------------------------------------------------------------------
create function public.unlink_product(p_product_id uuid, p_reason text, p_client_op_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product  public.products;
  v_movement public.inventory_movements;
  v_old      text;
  v_new      text;
begin
  if p_client_op_id is not null then
    select * into v_movement from public.inventory_movements where client_op_id = p_client_op_id;
    if found then
      return public._movement_result('duplicate', v_movement);
    end if;
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Producto no encontrado' using errcode = 'P0002';
  end if;
  if v_product.is_internal_code and v_product.catalog_product_id is null then
    raise exception 'Este producto no tiene código de barras ni catálogo que desvincular' using errcode = '22023';
  end if;

  v_old := v_product.barcode;
  v_new := v_product.barcode;
  if not v_product.is_internal_code then
    v_new := 'HCH-' || lpad(nextval('public.internal_code_seq')::text, 6, '0');
  end if;

  update public.products
  set barcode = v_new, is_internal_code = true, catalog_product_id = null
  where id = v_product.id
  returning * into v_product;

  insert into public.inventory_movements (
    product_id, type, delta, quantity_after, note, client_op_id, old_barcode, created_by
  ) values (
    v_product.id,
    'barcode_unlink',
    0,
    v_product.quantity,
    case when v_old = v_new
      then 'Desvinculado del catálogo. Motivo: ' || btrim(p_reason)
      else 'Código ' || v_old || ' desvinculado (ahora ' || v_new || '). Motivo: ' || btrim(p_reason)
    end,
    p_client_op_id,
    case when v_old = v_new then null else v_old end,
    auth.uid()
  )
  returning * into v_movement;

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------------------------------------------------------------------
-- cancel_movement: revierte un movimiento con un 'adjustment' de delta
-- opuesto (igual que undo_movement), pidiendo el motivo. Las ventas no se
-- cancelan aquí (el ticket seguiría cobrado).
-- status: 'ok' | 'duplicate' | 'already_undone'
-- ---------------------------------------------------------------------
create function public.cancel_movement(p_movement_id uuid, p_reason text, p_client_op_id uuid default null)
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
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;

  select * into v_target from public.inventory_movements where id = p_movement_id;
  if not found then
    raise exception 'Movimiento no encontrado' using errcode = 'P0002';
  end if;
  if v_target.type = 'sale' then
    raise exception 'Las ventas no se cancelan desde el historial de inventario' using errcode = '22023';
  end if;
  if v_target.type = 'barcode_unlink' then
    raise exception 'Un desvinculado no se cancela: vuelve a dar de alta el código' using errcode = '22023';
  end if;
  if v_target.reverts_movement_id is not null then
    raise exception 'No se puede cancelar una cancelación' using errcode = '22023';
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
    'Cancelación de ' || case v_target.type
      when 'initial_count' then 'alta de producto'
      when 'scan_add'      then 'escaneo (sumar)'
      when 'set_total'     then 'escaneo (fijar total)'
      else 'ajuste'
    end || '. Motivo: ' || btrim(p_reason),
    p_client_op_id,
    v_target.id,
    auth.uid()
  )
  returning * into v_movement;

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------------------------------------------------------------------
-- adjust_stock: fija la cantidad de un producto (corrección de conteo,
-- merma, dañado…) con un movimiento 'adjustment' y su motivo.
-- status: 'ok' | 'duplicate'
-- ---------------------------------------------------------------------
create function public.adjust_stock(p_product_id uuid, p_quantity integer, p_reason text, p_client_op_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product  public.products;
  v_movement public.inventory_movements;
begin
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
  if v_product.quantity = p_quantity then
    raise exception 'La cantidad ya es %', p_quantity using errcode = '22023';
  end if;

  update public.products set quantity = p_quantity where id = v_product.id;

  insert into public.inventory_movements (product_id, type, delta, quantity_after, note, client_op_id, created_by)
  values (
    v_product.id,
    'adjustment',
    p_quantity - v_product.quantity,
    p_quantity,
    'Ajuste de existencias. Motivo: ' || btrim(p_reason),
    p_client_op_id,
    auth.uid()
  )
  returning * into v_movement;

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------------------------------------------------------------------
-- movement_history: + código anterior y si el movimiento fue cancelado
-- (quién, cuándo y con qué nota). Las columnas nuevas van al final.
-- ---------------------------------------------------------------------
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
  coalesce(rp.full_name, rp.email) as cancelled_by_name
from public.inventory_movements m
join public.products p on p.id = m.product_id
left join public.profiles pr on pr.id = m.created_by
left join public.inventory_movements r on r.reverts_movement_id = m.id
left join public.profiles rp on rp.id = r.created_by;

-- ---------- Permisos de ejecución ----------
revoke all on function public.unlink_product(uuid, text, uuid) from public, anon;
revoke all on function public.cancel_movement(uuid, text, uuid) from public, anon;
revoke all on function public.adjust_stock(uuid, integer, text, uuid) from public, anon;
grant execute on function public.unlink_product(uuid, text, uuid) to authenticated;
grant execute on function public.cancel_movement(uuid, text, uuid) to authenticated;
grant execute on function public.adjust_stock(uuid, integer, text, uuid) to authenticated;
