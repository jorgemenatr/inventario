-- =====================================================================
-- Asignar código de barras a un producto con código interno
--
-- Lo contrario de unlink_product: un producto dado de alta con código
-- interno (HCH-) recibe su código real. Queda en el historial como
-- movimiento 'barcode_assign' (delta 0, old_barcode = el código interno).
-- Para cambiar un código real por otro, primero se desvincula.
-- =====================================================================

-- Se usa solo dentro de funciones (en tiempo de ejecución), así que se
-- puede agregar en la misma transacción.
alter type public.movement_type add value if not exists 'barcode_assign';

create function public.assign_barcode(p_product_id uuid, p_barcode text, p_client_op_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product  public.products;
  v_movement public.inventory_movements;
  v_code     text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_old      text;
  v_owner    text;
begin
  perform public._require_admin();
  if p_client_op_id is not null then
    select * into v_movement from public.inventory_movements where client_op_id = p_client_op_id;
    if found then
      return public._movement_result('duplicate', v_movement);
    end if;
  end if;
  if v_code is null then
    raise exception 'Escribe el código de barras' using errcode = '22023';
  end if;
  perform public._check_reserved_barcode(v_code);

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Producto no encontrado' using errcode = 'P0002';
  end if;
  if not v_product.is_internal_code then
    raise exception 'Este producto ya tiene el código %: desvincúlalo antes de asignarle otro', v_product.barcode
      using errcode = '22023';
  end if;

  select name into v_owner from public.products where barcode = v_code;
  if found then
    raise exception 'El código % ya es de "%"', v_code, v_owner using errcode = '23505';
  end if;

  v_old := v_product.barcode;
  update public.products
  set barcode = v_code, is_internal_code = false
  where id = v_product.id
  returning * into v_product;

  insert into public.inventory_movements (
    product_id, type, delta, quantity_after, note, client_op_id, old_barcode, created_by
  ) values (
    v_product.id,
    'barcode_assign',
    0,
    v_product.quantity,
    'Código ' || v_code || ' asignado (antes ' || v_old || ')',
    p_client_op_id,
    v_old,
    auth.uid()
  )
  returning * into v_movement;

  return public._movement_result('ok', v_movement);
end;
$$;

revoke all on function public.assign_barcode(uuid, text, uuid) from public, anon;
grant execute on function public.assign_barcode(uuid, text, uuid) to authenticated;

-- Una asignación no se cancela desde el historial (se corrige desvinculando).
do $$
declare
  v_def text := pg_get_functiondef(
    'public._revert_movement(public.inventory_movements, text, uuid, jsonb)'::regprocedure);
  v_old text := '  if p_target.type = ''barcode_unlink'' then';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception '_revert_movement cambió: revisa esta migración';
  end if;
  execute replace(v_def, v_old,
    '  if p_target.type = ''barcode_assign'' then
    raise exception ''Una asignación de código no se cancela: desvincula el código'' using errcode = ''22023'';
  end if;
' || v_old);
end $$;
