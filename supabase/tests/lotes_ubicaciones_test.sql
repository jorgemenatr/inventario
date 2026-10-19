-- =====================================================================
-- Pruebas de lotes y ubicaciones (tienda / bodega).
-- Se corren en un Postgres LOCAL con supabase/tests/run.sh, nunca contra
-- la base real. Cualquier assert que falle detiene el script.
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

-- ---------- utilidades de prueba ----------
create schema tests;
grant usage on schema tests to authenticated, anon;

-- Ejecuta SQL y exige que falle con un mensaje que contenga p_pattern.
create function tests.expect_error(p_sql text, p_pattern text)
returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'Se esperaba un error con "%" y no hubo error: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'Se esperaba un error%' then
    raise;
  end if;
  if position(lower(p_pattern) in lower(sqlerrm)) = 0 then
    raise exception 'Error distinto al esperado. Esperado: "%". Recibido: "%"', p_pattern, sqlerrm;
  end if;
end $$;
grant execute on function tests.expect_error(text, text) to authenticated, anon;

create function tests.assert_eq(p_got anyelement, p_expected anyelement, p_what text)
returns void language plpgsql as $$
begin
  if p_got is distinct from p_expected then
    raise exception '% → esperado %, obtuvo %', p_what, p_expected, p_got;
  end if;
end $$;
grant execute on function tests.assert_eq(anyelement, anyelement, text) to authenticated, anon;

-- Sin descuadres (se revisa como postgres para ver todo).
create function tests.assert_cuadra(p_when text)
returns void language plpgsql security definer as $$
declare n integer;
begin
  select count(*) into n from public.stock_mismatches;
  if n > 0 then
    raise exception 'stock_mismatches no está vacía (%): % filas', p_when, n;
  end if;
end $$;
grant execute on function tests.assert_cuadra(text) to authenticated;

create function tests.qty(p_barcode text, out tienda integer, out bodega integer)
language sql security definer as $$
  select quantity, warehouse_quantity from public.products where barcode = p_barcode
$$;
grant execute on function tests.qty(text) to authenticated;

create function tests.lot(p_n integer) returns uuid language sql security definer as $$
  select id from public.lots where number = p_n
$$;
grant execute on function tests.lot(integer) to authenticated;

create function tests.lot_qty(p_n integer, p_loc public.stock_location) returns integer
language sql security definer as $$
  select coalesce((select ls.quantity from public.lot_stock ls join public.lots l on l.id = ls.lot_id
                   where l.number = p_n and ls.location = p_loc), 0)
$$;
grant execute on function tests.lot_qty(integer, public.stock_location) to authenticated;

-- ---------- usuarios ----------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@test'),
  ('00000000-0000-0000-0000-00000000000b', 'mostrador@test');
update public.profiles set role = 'admin'     where id = '00000000-0000-0000-0000-00000000000a';
update public.profiles set role = 'mostrador' where id = '00000000-0000-0000-0000-00000000000b';

\set admin 'reset role; set request.jwt.claims = ''{"sub":"00000000-0000-0000-0000-00000000000a"}''; set role authenticated;'
\set mostrador 'reset role; set request.jwt.claims = ''{"sub":"00000000-0000-0000-0000-00000000000b"}''; set role authenticated;'
\set postgres 'reset role; set request.jwt.claims = '''';'

-- =====================================================================
-- 1. 10 en tienda y 50 en bodega → 10 / 50 / 60
-- =====================================================================
:admin
select public.create_product('750A', 'Booster A', 120, 50, null, 'Proveedor A', 10, null, null, null, null, 'store') \g /dev/null
select public.create_product('750B', 'Booster B', 80, 30, null, 'Proveedor A', 5, null, null, null, null, 'store') \g /dev/null
:postgres
-- (_resolve_supplier es interna: se crea el proveedor B como postgres)
select public._resolve_supplier(null, 'Proveedor B') \g /dev/null
:admin
do $$
declare v_b uuid := (select id from public.suppliers where name = 'Proveedor B');
begin
  perform public.register_purchase('10000000-0000-0000-0000-000000000001', v_b,
    jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where barcode = '750A'),
                                         'quantity', 50, 'unit_cost', 55)),
    'warehouse', 'F-1', null);
  perform tests.assert_eq((tests.qty('750A')).tienda, 10, '1. tienda');
  perform tests.assert_eq((tests.qty('750A')).bodega, 50, '1. bodega');
  perform tests.assert_eq((select quantity + warehouse_quantity from public.products where barcode = '750A'), 60, '1. total');
  perform tests.assert_cuadra('1');
end $$;
-- Lotes: 1 = A tienda (alta, $50), 2 = B tienda (alta), 3 = A bodega (compra, $55)

-- Idempotencia de la compra
do $$
begin
  perform tests.assert_eq(
    (public.register_purchase('10000000-0000-0000-0000-000000000001',
      (select id from public.suppliers where name = 'Proveedor B'), '[{"product_id":"00000000-0000-0000-0000-000000000000","quantity":1,"unit_cost":1}]'::jsonb)) ->> 'status',
    'duplicate', '1. compra repetida');
  perform tests.assert_eq((tests.qty('750A')).bodega, 50, '1. bodega tras reintento');
end $$;

-- =====================================================================
-- 2. Vender 4 descuenta solo de la tienda; la bodega queda intacta
-- =====================================================================
:mostrador
do $$
begin
  perform public.pay_ticket('20000000-0000-0000-0000-000000000001', null, 'cash',
    '[{"barcode":"750A","quantity":4,"unit_price":120}]'::jsonb);
  perform tests.assert_eq((tests.qty('750A')).tienda, 6, '2. tienda');
  perform tests.assert_eq((tests.qty('750A')).bodega, 50, '2. bodega');
  perform tests.assert_eq(tests.lot_qty(1, 'store'), 6, '2. salió del lote 1');
  perform tests.assert_cuadra('2');
end $$;
:admin
do $$
begin
  perform tests.assert_eq((select cost from public.sale_item_profit where ticket_id = '20000000-0000-0000-0000-000000000001'),
    200.00::numeric, '2. costo de la venta (4 × $50)');
end $$;

-- =====================================================================
-- 3. Vender más de lo que hay en tienda falla aunque haya en bodega
-- =====================================================================
:mostrador
do $$
begin
  perform tests.expect_error($q$select public.pay_ticket('20000000-0000-0000-0000-000000000002', null, 'cash',
    '[{"barcode":"750A","quantity":7,"unit_price":120}]'::jsonb)$q$, 'hay 6 en tienda y 50 en bodega');
  -- p_offline ya no permite cobrar sin stock
  perform tests.expect_error($q$select public.pay_ticket('20000000-0000-0000-0000-000000000003', null, 'cash',
    '[{"barcode":"750A","quantity":7,"unit_price":120}]'::jsonb, null, null, true)$q$, 'Stock insuficiente');
  perform tests.assert_eq((select count(*)::int from public.tickets), 1, '3. no se registró el ticket');
  perform tests.assert_eq((tests.qty('750A')).tienda, 6, '3. tienda igual');
end $$;

-- =====================================================================
-- 4. Bodega → tienda mueve lo más viejo; tienda → bodega, lo más nuevo
-- =====================================================================
:admin
do $$
declare v_b uuid := (select id from public.suppliers where name = 'Proveedor B');
begin
  -- Otro lote en bodega, más nuevo (lote 4, $60)
  perform public.register_purchase('10000000-0000-0000-0000-000000000002', v_b,
    jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where barcode = '750A'),
                                         'quantity', 20, 'unit_cost', 60)), 'warehouse');
  perform tests.assert_eq((tests.qty('750A')).bodega, 70, '4. bodega con 2 lotes');

  perform public.create_transfer('30000000-0000-0000-0000-000000000001', 'warehouse', 'store',
    jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where barcode = '750A'), 'quantity', 5)),
    'Reabasto');
  perform tests.assert_eq(tests.lot_qty(3, 'warehouse'), 45, '4. salió del lote viejo (3)');
  perform tests.assert_eq(tests.lot_qty(4, 'warehouse'), 20, '4. lote nuevo (4) intacto');
  perform tests.assert_eq(tests.lot_qty(3, 'store'), 5, '4. lote 3 ahora en tienda');
  perform tests.assert_eq((tests.qty('750A')).tienda, 11, '4. tienda');
  perform tests.assert_eq((tests.qty('750A')).bodega, 65, '4. bodega');

  -- Tienda → bodega: tienda tiene lote 1 (6, viejo) y lote 3 (5, más nuevo)
  perform public.create_transfer('30000000-0000-0000-0000-000000000002', 'store', 'warehouse',
    jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where barcode = '750A'), 'quantity', 3)));
  perform tests.assert_eq(tests.lot_qty(3, 'store'), 2, '4. tienda→bodega sacó del más nuevo (3)');
  perform tests.assert_eq(tests.lot_qty(1, 'store'), 6, '4. lote viejo (1) intacto en tienda');
  perform tests.assert_eq(tests.lot_qty(3, 'warehouse'), 48, '4. regresó a bodega en el mismo lote');
  perform tests.assert_cuadra('4');

  -- Historial: 2 movimientos por producto por traspaso
  perform tests.assert_eq((select count(*)::int from public.inventory_movements where transfer_id = '30000000-0000-0000-0000-000000000001'), 2, '4. movimientos del traspaso');
  perform tests.assert_eq((select sum(quantity)::int from public.transfer_item_lots where transfer_id = '30000000-0000-0000-0000-000000000001'), 5, '4. detalle de lotes');
end $$;

-- La siguiente venta sale del lote más viejo de la tienda (1), no del traspasado (3)
:mostrador
select public.pay_ticket('20000000-0000-0000-0000-000000000004', null, 'cash', '[{"barcode":"750A","quantity":7,"unit_price":120}]'::jsonb) \g /dev/null
:admin
do $$
begin
  perform tests.assert_eq(tests.lot_qty(1, 'store'), 0, '4. venta FIFO: lote 1 agotado');
  perform tests.assert_eq(tests.lot_qty(3, 'store'), 1, '4. venta FIFO: 1 pza del lote 3');
  perform tests.assert_eq((select cost from public.sale_item_profit where ticket_id = '20000000-0000-0000-0000-000000000004'),
    355.00::numeric, '4. costo mixto (6 × $50 + 1 × $55)');
end $$;

-- =====================================================================
-- 5. Traspaso con stock insuficiente falla completo y no cambia nada
-- =====================================================================
do $$
declare v_movs integer := (select count(*) from public.inventory_movements);
begin
  perform tests.expect_error(format($q$select public.create_transfer('30000000-0000-0000-0000-000000000003', 'warehouse', 'store',
    '[{"product_id":"%s","quantity":5},{"product_id":"%s","quantity":1}]'::jsonb)$q$,
    (select id from public.products where barcode = '750A'), (select id from public.products where barcode = '750B')),
    'Booster B (pide 1, hay 0)');
  perform tests.assert_eq((tests.qty('750A')).bodega, 68, '5. bodega A sin cambios');
  perform tests.assert_eq((select count(*)::int from public.inventory_movements), v_movs, '5. sin movimientos nuevos');
  perform tests.assert_eq((select count(*)::int from public.transfers), 2, '5. sin traspaso nuevo');
end $$;

-- =====================================================================
-- 6. Un usuario mostrador no puede hacer traspasos (ni ver lotes); admin sí
-- =====================================================================
:mostrador
do $$
begin
  perform tests.expect_error(format($q$select public.create_transfer('30000000-0000-0000-0000-000000000004', 'warehouse', 'store',
    '[{"product_id":"%s","quantity":1}]'::jsonb)$q$, (select id from public.products where barcode = '750A')),
    'Solo un administrador');
  perform tests.expect_error($q$select public.register_scan('750A', 'add', 1)$q$, 'Solo un administrador');
  perform tests.expect_error(format($q$select public.adjust_stock('%s', 0, 'x')$q$, (select id from public.products where barcode = '750A')), 'Solo un administrador');
  perform tests.assert_eq((select count(*)::int from public.lots), 0, '6. mostrador no ve lotes');
  perform tests.assert_eq((select count(*)::int from public.suppliers), 0, '6. mostrador no ve proveedores');
  perform tests.assert_eq((select count(*)::int from public.product_lots), 0, '6. mostrador no ve product_lots');
  perform tests.assert_eq((select count(*)::int from public.products where barcode = '750A'), 1, '6. mostrador sí ve productos');
  -- Internas: sin permiso
  perform tests.expect_error(format($q$select public._lot_take('%s', 'store', 1, null)$q$, tests.lot(3)), 'permission denied');
  perform tests.expect_error($q$update public.products set quantity = 99 where barcode = '750A'$q$, 'existencias');
end $$;
:postgres
set role anon;
do $$
begin
  perform tests.expect_error($q$select public.create_transfer(gen_random_uuid(), 'warehouse', 'store', '[]'::jsonb)$q$, 'permission denied');
  perform tests.expect_error($q$select public.pay_ticket(gen_random_uuid(), null, 'cash', '[]'::jsonb)$q$, 'permission denied');
end $$;
:admin
do $$
begin
  -- Ni el admin cambia existencias directo (solo con movimientos)
  perform tests.expect_error($q$update public.products set quantity = 99 where barcode = '750A'$q$, 'existencias');
  perform tests.expect_error($q$update public.products set warehouse_quantity = 0 where barcode = '750A'$q$, 'existencias');
  perform tests.expect_error($q$insert into public.products (barcode, name, price, quantity) values ('X1', 'x', 1, 5)$q$, 'empieza sin piezas');
  perform tests.assert_eq((select count(*)::int from public.lots), 4, '6. admin ve lotes');
  -- La bandera de pruebas de la v1 no existe ni tiene efecto
  perform set_config('app.traspasos_sin_auth', 'on', false);
end $$;
:mostrador
do $$
begin
  perform tests.expect_error(format($q$select public.create_transfer(gen_random_uuid(), 'warehouse', 'store',
    '[{"product_id":"%s","quantity":1}]'::jsonb)$q$, (select id from public.products where barcode = '750A')),
    'Solo un administrador');
end $$;

-- =====================================================================
-- 7. Merma y entrada en bodega no afectan la tienda
-- =====================================================================
:admin
do $$
declare v_a uuid := (select id from public.products where barcode = '750A');
begin
  -- Bodega tiene lote 3 (48) y lote 4 (20): sin elegir lote, falla
  perform tests.expect_error(format($q$select public.adjust_stock('%s', 60, 'Dañados', null, 'warehouse')$q$, v_a), 'Elige de qué lote');
  -- Lotes que no suman lo necesario
  perform tests.expect_error(format($q$select public.adjust_stock('%s', 60, 'Dañados', null, 'warehouse', '[{"lot_id":"%s","quantity":3}]'::jsonb)$q$,
    v_a, tests.lot(4)), 'suman 3');
  -- Merma de 8 del lote 4
  perform public.adjust_stock(v_a, 60, 'Dañados', null, 'warehouse',
    jsonb_build_array(jsonb_build_object('lot_id', tests.lot(4), 'quantity', 8)));
  perform tests.assert_eq(tests.lot_qty(4, 'warehouse'), 12, '7. merma del lote elegido');
  perform tests.assert_eq(tests.lot_qty(3, 'warehouse'), 48, '7. otro lote intacto');
  perform tests.assert_eq((tests.qty('750A')).tienda, 1, '7. tienda sin cambios');
  -- Entrada manual en bodega: lote nuevo (5) con el último costo
  perform public.adjust_stock(v_a, 65, 'Encontrados', null, 'warehouse');
  perform tests.assert_eq((tests.qty('750A')).bodega, 65, '7. entrada en bodega');
  perform tests.assert_eq((tests.qty('750A')).tienda, 1, '7. tienda sin cambios tras entrada');
  perform tests.assert_eq((select unit_cost from public.lots where number = 5), 60.00::numeric, '7. lote con el último costo');
  perform tests.assert_eq((select entry_location from public.lots where number = 5), 'warehouse'::public.stock_location, '7. lote en bodega');
  perform tests.assert_cuadra('7');
end $$;

-- =====================================================================
-- 8. Deshacer / cancelar regresa al lote exacto; dos veces no
-- =====================================================================
do $$
declare
  v_merma uuid := (select id from public.inventory_movements where note like '%Dañados%');
  r jsonb;
begin
  r := public.cancel_movement(v_merma, 'Error de captura');
  perform tests.assert_eq(r ->> 'status', 'ok', '8. cancelar merma');
  perform tests.assert_eq(tests.lot_qty(4, 'warehouse'), 20, '8. regresó al lote 4');
  r := public.cancel_movement(v_merma, 'Otra vez');
  perform tests.assert_eq(r ->> 'status', 'already_undone', '8. no se cancela dos veces');
  perform tests.assert_eq(tests.lot_qty(4, 'warehouse'), 20, '8. sin doble regreso');
  -- No se cancelan ventas, traspasos ni compras desde el historial
  perform tests.expect_error(format($q$select public.cancel_movement('%s', 'x')$q$,
    (select id from public.inventory_movements where type = 'sale' limit 1)), 'ventas no se cancelan');
  perform tests.expect_error(format($q$select public.cancel_movement('%s', 'x')$q$,
    (select id from public.inventory_movements where type = 'transfer' limit 1)), 'otro traspaso');
  perform tests.expect_error(format($q$select public.cancel_movement('%s', 'x')$q$,
    (select id from public.inventory_movements where type = 'purchase' limit 1)), 'desde Compras');
  perform tests.assert_cuadra('8');
end $$;

-- Escáner con sesión: los escaneos de la misma sesión van al mismo lote
do $$
declare
  r jsonb;
  v_b uuid := (select id from public.suppliers where name = 'Proveedor B');
begin
  perform public.register_scan('750B', 'add', 1, null, null, 'store', v_b, 33, '40000000-0000-0000-0000-000000000001');
  r := public.register_scan('750B', 'add', 2, null, null, 'store', v_b, 33, '40000000-0000-0000-0000-000000000001');
  perform tests.assert_eq((select count(*)::int from public.lots where scan_session_id = '40000000-0000-0000-0000-000000000001'), 1, '8. un lote por sesión');
  perform tests.assert_eq((select received_quantity from public.lots where scan_session_id = '40000000-0000-0000-0000-000000000001'), 3, '8. lote de la sesión con 3');
  perform tests.assert_eq((select unit_cost from public.lots where scan_session_id = '40000000-0000-0000-0000-000000000001'), 33.00::numeric, '8. costo de la sesión');
  perform tests.assert_eq((select supplier from public.products where barcode = '750B'), 'Proveedor B', '8. último proveedor');
  perform tests.assert_eq((tests.qty('750B')).tienda, 8, '8. tienda B');
  -- Deshacer el segundo escaneo quita 2 del lote de la sesión
  perform public.undo_movement((r ->> 'movement_id')::uuid);
  perform tests.assert_eq((tests.qty('750B')).tienda, 6, '8. deshacer escaneo');
  perform tests.assert_eq((select ls.quantity from public.lot_stock ls join public.lots l on l.id = ls.lot_id
     where l.scan_session_id = '40000000-0000-0000-0000-000000000001'), 1, '8. salió del lote de la sesión');
  -- Fijar total hacia abajo con varios lotes: hay que elegir
  perform tests.expect_error($q$select public.register_scan('750B', 'set', 2)$q$, 'Elige de qué lote');
  perform public.register_scan('750B', 'set', 2, null, null, 'store', null, null, null,
    jsonb_build_array(jsonb_build_object('lot_id', tests.lot(2), 'quantity', 4)));
  perform tests.assert_eq((tests.qty('750B')).tienda, 2, '8. fijar total');
  perform tests.assert_eq(tests.lot_qty(2, 'store'), 1, '8. salió del lote elegido');
  -- Deshacer una entrada cuyas piezas ya se vendieron falla
  perform tests.assert_cuadra('8b');
end $$;
:mostrador
select public.pay_ticket('20000000-0000-0000-0000-000000000005', null, 'cash', '[{"barcode":"750B","quantity":2,"unit_price":80}]'::jsonb) \g /dev/null
:admin
do $$
begin
  perform tests.expect_error(format($q$select public.cancel_movement('%s', 'x')$q$,
    (select id from public.inventory_movements where type = 'scan_add' and delta = 1 limit 1)), 'Ya se vendieron');
end $$;

-- =====================================================================
-- 9. Compras: editar / cancelar solo si están intactas
-- =====================================================================
do $$
declare
  v_a uuid := (select id from public.suppliers where name = 'Proveedor A');
  v_b uuid := (select id from public.suppliers where name = 'Proveedor B');
  v_item uuid;
  r jsonb;
begin
  -- La compra 1 ya tuvo traspasos: no se puede cambiar el costo ni cancelar
  perform tests.expect_error(format($q$select public.update_purchase('10000000-0000-0000-0000-000000000001', '%s', 'F-1', null,
    '[{"item_id":"%s","unit_cost":1}]'::jsonb)$q$, v_b,
    (select id from public.purchase_items where purchase_id = '10000000-0000-0000-0000-000000000001')), 'Ya se vendieron');
  perform tests.expect_error($q$select public.cancel_purchase('10000000-0000-0000-0000-000000000001', 'x')$q$, 'Ya se vendieron');
  -- Folio y nota sí
  r := public.update_purchase('10000000-0000-0000-0000-000000000001', v_b, 'F-1A', 'Corregido');
  perform tests.assert_eq(r -> 'purchase' ->> 'folio', 'F-1A', '9. folio editado');

  -- Compra intacta: se corrige costo y proveedor, y se cancela
  perform public.register_purchase('10000000-0000-0000-0000-000000000003', v_b,
    jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where barcode = '750B'), 'quantity', 10, 'unit_cost', 31)));
  v_item := (select id from public.purchase_items where purchase_id = '10000000-0000-0000-0000-000000000003');
  perform tests.assert_eq((tests.qty('750B')).tienda, 10, '9. compra en tienda (default)');
  perform public.update_purchase('10000000-0000-0000-0000-000000000003', v_a, null, null,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'unit_cost', 29.5)));
  perform tests.assert_eq((select unit_cost from public.lots where purchase_item_id = v_item), 29.50::numeric, '9. costo del lote corregido');
  perform tests.assert_eq((select supplier_id from public.lots where purchase_item_id = v_item), v_a, '9. proveedor del lote corregido');
  perform tests.assert_eq((select total from public.purchases where id = '10000000-0000-0000-0000-000000000003'), 295.00::numeric, '9. total');
  r := public.cancel_purchase('10000000-0000-0000-0000-000000000003', 'Duplicada');
  perform tests.assert_eq(r -> 'purchase' ->> 'status', 'cancelled', '9. compra cancelada');
  perform tests.assert_eq((tests.qty('750B')).tienda, 0, '9. piezas regresadas');
  perform tests.expect_error($q$select public.update_purchase('10000000-0000-0000-0000-000000000003',
    (select id from public.suppliers limit 1))$q$, 'cancelada');
  perform tests.assert_cuadra('9');
end $$;

-- =====================================================================
-- 12. 0 en tienda y 50 en bodega: el producto está agotado en tienda
--     (la app calcula "agotado / stock bajo" siempre con quantity)
-- =====================================================================
do $$
declare v_b uuid := (select id from public.suppliers where name = 'Proveedor B');
begin
  perform public.create_product('750C', 'Booster C', 100, 40, null, null, 50, null, null, null, null, 'warehouse', v_b);
  perform tests.assert_eq((tests.qty('750C')).tienda, 0, '12. tienda 0');
  perform tests.assert_eq((tests.qty('750C')).bodega, 50, '12. bodega 50');
  perform tests.assert_eq((select entry_location from public.lots l join public.products p on p.id = l.product_id where p.barcode = '750C'),
    'warehouse'::public.stock_location, '12. lote del alta en bodega');
  perform tests.assert_eq((select supplier from public.products where barcode = '750C'), 'Proveedor B', '12. proveedor del alta');
  perform tests.assert_eq((public.inventory_totals() ->> 'warehouse_pieces')::int, 123, '12. totales de bodega (A 73 + C 50)');
end $$;
:mostrador
do $$
begin
  perform tests.expect_error($q$select public.pay_ticket(gen_random_uuid(), null, 'cash', '[{"barcode":"750C","quantity":1,"unit_price":100}]'::jsonb)$q$,
    'hay 0 en tienda y 50 en bodega');
end $$;

-- =====================================================================
-- 13. El costo del producto solo lo lee un admin
-- =====================================================================
:mostrador
do $$
declare r jsonb;
begin
  perform tests.expect_error($q$select cost from public.products limit 1$q$, 'permission denied');
  perform tests.expect_error($q$select * from public.products limit 1$q$, 'permission denied');
  perform tests.assert_eq((select quantity from public.products where barcode = '750A'), 1, '13. mostrador lee existencias');
  perform tests.assert_eq((select count(*)::int from public.product_costs), 0, '13. mostrador no ve product_costs');
  r := public.pay_ticket(gen_random_uuid(), null, 'cash', '[{"barcode":"750A","quantity":1,"unit_price":120}]'::jsonb);
  perform tests.assert_eq(r -> 'products' -> 0 ? 'cost', false, '13. la venta no devuelve el costo');
  perform tests.assert_eq(r -> 'products' -> 0 ? 'price', true, '13. la venta sí devuelve el producto');
end $$;
:admin
do $$
declare r jsonb;
begin
  perform tests.assert_eq((select c.cost from public.product_costs c join public.products p on p.id = c.product_id where p.barcode = '750A'),
    60.00::numeric, '13. admin lee el costo');
  r := public.unlink_product((select id from public.products where barcode = '750B'), 'Prueba');
  perform tests.assert_eq(r ->> 'status', 'ok', '13. unlink_product sigue funcionando');
  perform tests.assert_eq(r -> 'product' ? 'cost', true, '13. al admin sí le llega el costo');
end $$;

-- =====================================================================
-- 11. Al final todo cuadra
-- =====================================================================
:postgres
select tests.assert_cuadra('final');
\echo 'OK: todas las pruebas de lotes y ubicaciones pasaron'
