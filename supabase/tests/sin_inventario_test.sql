-- =====================================================================
-- Pruebas de productos sin control de inventario (track_stock = false).
-- Se corren en una base LOCAL recién creada con supabase/tests/run.sh,
-- nunca contra la base real.
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'admin@prueba.mx'),
  ('00000000-0000-0000-0000-0000000000d2', 'mostrador@prueba.mx');
update public.profiles set role = 'admin'     where id = '00000000-0000-0000-0000-0000000000d1';
update public.profiles set role = 'mostrador' where id = '00000000-0000-0000-0000-0000000000d2';

-- ---------- 1. Alta: comida sin inventario y un producto normal ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1"}', false);
set role authenticated;

do $$
begin
  perform public.create_product('COMIDA1', 'Orden de Boneless', 110);
  perform public.create_product('NORMAL1', 'Booster', 90, 50, null, null, 2);
  update public.products set track_stock = false where barcode = 'COMIDA1';

  -- Con piezas no se puede marcar sin inventario.
  begin
    update public.products set track_stock = false where barcode = 'NORMAL1';
    raise exception 'FALLA 1a: marcó sin inventario un producto con piezas';
  exception when others then
    if sqlerrm not like '%déjalas en 0%' then raise; end if;
  end;

  -- No recibe piezas (escaneo).
  begin
    perform public.register_scan('COMIDA1', 'add', 1);
    raise exception 'FALLA 1b: sumó piezas a un producto sin inventario';
  exception when others then
    if sqlerrm not like '%no lleva inventario%' then raise; end if;
  end;
end $$;

-- ---------- 2. El mostrador no puede cambiar track_stock ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2"}', false);

do $$
begin
  begin
    update public.products set track_stock = true where barcode = 'COMIDA1';
    raise exception 'FALLA 2: el mostrador cambió track_stock';
  exception when others then
    if sqlerrm not like 'Solo un administrador%' then raise; end if;
  end;
end $$;

-- ---------- 3. Venta: sin inventario no revisa stock; el normal sí ----------
do $$
declare r jsonb;
begin
  r := public.pay_ticket('60000000-0000-0000-0000-000000000001', null, 'cash',
    '[{"barcode":"COMIDA1","quantity":5,"unit_price":110},{"barcode":"NORMAL1","quantity":1,"unit_price":90}]'::jsonb);
  if r ->> 'status' <> 'ok' then
    raise exception 'FALLA 3a: %', r;
  end if;
  if (select count(*) from public.ticket_items where ticket_id = '60000000-0000-0000-0000-000000000001') <> 2 then
    raise exception 'FALLA 3b: faltan renglones del ticket';
  end if;

  begin
    perform public.pay_ticket('60000000-0000-0000-0000-000000000002', null, 'cash',
      '[{"barcode":"NORMAL1","quantity":2,"unit_price":90}]'::jsonb);
    raise exception 'FALLA 3c: vendió más stock del que hay';
  exception when others then
    if sqlerrm not like 'Stock insuficiente%' then raise; end if;
  end;
end $$;

reset role;

do $$
begin
  if (select quantity from public.products where barcode = 'COMIDA1') <> 0 then
    raise exception 'FALLA 3d: cambió la cantidad del producto sin inventario';
  end if;
  if (select quantity from public.products where barcode = 'NORMAL1') <> 1 then
    raise exception 'FALLA 3e: no descontó el producto normal';
  end if;
  if exists (select 1 from public.inventory_movements m join public.products p on p.id = m.product_id
             where p.barcode = 'COMIDA1' and m.type = 'sale') then
    raise exception 'FALLA 3f: la venta generó movimiento de inventario';
  end if;
  if (select revenue - profit from public.sale_item_profit s join public.products p on p.id = s.product_id where p.barcode = 'COMIDA1') <> 0 then
    raise exception 'FALLA 3g: costo distinto de 0';
  end if;
  if exists (select 1 from public.stock_mismatches) then
    raise exception 'FALLA 3h: descuadre de inventario';
  end if;
end $$;

\echo 'OK: productos sin inventario'

-- ---------- 4. Asignar código a un producto con código interno ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1"}', false);
set role authenticated;

do $$
declare
  v_id  uuid;
  v_old text;
  r     jsonb;
begin
  perform public.create_product(null, 'Torneo Fun', 50);
  select id, barcode into v_id, v_old from public.products where name = 'Torneo Fun';

  r := public.assign_barcode(v_id, ' 32000002 ');
  if (select barcode from public.products where id = v_id) <> '32000002'
     or (select is_internal_code from public.products where id = v_id) then
    raise exception 'FALLA 4a: no asignó el código';
  end if;
  if (select old_barcode from public.inventory_movements where product_id = v_id and type = 'barcode_assign') <> v_old then
    raise exception 'FALLA 4b: el historial no guarda el código anterior';
  end if;

  -- Ya tiene código real: no se reasigna.
  begin
    perform public.assign_barcode(v_id, '32000003');
    raise exception 'FALLA 4c: reasignó un código real';
  exception when others then
    if sqlerrm not like '%desvincúlalo%' then raise; end if;
  end;

  -- Código ocupado por otro producto.
  perform public.create_product(null, 'Torneo Advance', 100);
  begin
    perform public.assign_barcode((select id from public.products where name = 'Torneo Advance'), 'COMIDA1');
    raise exception 'FALLA 4d: asignó un código ocupado';
  exception when others then
    if sqlerrm not like 'El código COMIDA1 ya es de%' then raise; end if;
  end;

  -- Prefijo interno reservado.
  begin
    perform public.assign_barcode((select id from public.products where name = 'Torneo Advance'), 'HCH-999999');
    raise exception 'FALLA 4e: aceptó un código interno';
  exception when others then
    if sqlerrm not like '%reservado%' then raise; end if;
  end;

  -- No se cancela desde el historial.
  begin
    perform public.cancel_movement(
      (select id from public.inventory_movements where product_id = v_id and type = 'barcode_assign'), 'Prueba');
    raise exception 'FALLA 4f: canceló una asignación';
  exception when others then
    if sqlerrm not like 'Una asignación de código no se cancela%' then raise; end if;
  end;
end $$;

-- El mostrador no puede asignar códigos.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2"}', false);

do $$
begin
  begin
    perform public.assign_barcode((select id from public.products where name = 'Torneo Advance'), '32000003');
    raise exception 'FALLA 4g: el mostrador asignó un código';
  exception when others then
    if sqlerrm not like 'Solo un administrador%' then raise; end if;
  end;
end $$;

reset role;
\echo 'OK: asignar código'
