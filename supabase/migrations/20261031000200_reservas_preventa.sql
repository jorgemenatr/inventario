-- =====================================================================
-- Piezas comprometidas en preventas: vista en lugar de columna calculada
--
-- La app pedía products.preorder_reserved (columna calculada de
-- 20261031000100). PostgREST le pasa la fila completa del producto, y el rol
-- de la app no puede leer products.cost (20261019000300_costo_solo_admin):
-- la consulta entera fallaba con "permission denied for table products"
-- (editar producto y recargar el catálogo).
--
-- Ahora la app lee las piezas comprometidas de esta vista y las junta con el
-- producto. La función preorder_reserved se queda para uso interno de las
-- RPC (corren como security definer).
-- =====================================================================

create view public.product_reservations
with (security_invoker = true)
as
select ti.product_id, sum(ti.quantity)::integer as reserved
from public.ticket_items ti
join public.tickets t on t.id = ti.ticket_id
where ti.preorder and t.status = 'preorder'
group by ti.product_id;

revoke all on public.product_reservations from anon, authenticated;
grant select on public.product_reservations to authenticated;

-- Solo para las RPC: la app ya no la llama.
revoke execute on function public.preorder_reserved(public.products) from authenticated;
