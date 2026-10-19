-- =====================================================================
-- Inventario Hachiko · El costo del producto solo lo ve un admin (1 de 2)
--
-- Aquí va lo que no rompe a la versión anterior de la app: la vista
-- product_costs (de donde el admin lee el costo) y quitar el costo de las
-- respuestas de las funciones para quien no es admin. Quitar el SELECT de
-- products.cost al rol de la app va en 20261019000300_costo_solo_admin.sql,
-- que se aplica cuando la app nueva ya está publicada.
-- =====================================================================

-- Sin security_invoker: corre con los permisos de su dueño (sí lee cost) y
-- el WHERE deja ver los costos solo a un administrador.
create view public.product_costs
as
select p.id as product_id, p.cost
from public.products p
where public.is_admin();

revoke all on public.product_costs from anon, authenticated;
grant select on public.product_costs to authenticated;

-- unlink_product lee el producto completo (select *): pasa a SECURITY
-- DEFINER. Sigue siendo solo para admin (lo exige el trigger de
-- movimientos con auth.uid()).
alter function public.unlink_product(uuid, text, uuid) security definer;

-- Las respuestas de las funciones tampoco llevan el costo si quien llama no
-- es admin (pay_ticket la usa el mostrador).
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
    'product',        to_jsonb(p) - case when public.is_admin() then '' else 'cost' end
  )
  from public.products p
  where p.id = p_movement.product_id;
$$;

do $$
declare
  v_def text := pg_get_functiondef(
    'public.pay_ticket(uuid, text, public.payment_method, jsonb, uuid, timestamptz, boolean, jsonb)'::regprocedure);
begin
  if position('v_products := v_products || to_jsonb(v_product);' in v_def) = 0 then
    raise exception 'pay_ticket cambió: revisa esta migración';
  end if;
  execute replace(v_def,
    'v_products := v_products || to_jsonb(v_product);',
    'v_products := v_products || (to_jsonb(v_product) - ''cost'');');
end $$;
