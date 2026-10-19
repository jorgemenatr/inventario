-- =====================================================================
-- Pruebas de categorías configurables y catálogo por cliente.
-- Base con datos de antes (categorias_antes.sql) + todas las migraciones.
-- Se corren en un Postgres LOCAL con supabase/tests/run.sh.
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

create function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FALLA: %', p_what; end if;
end $$;

create function pg_temp.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'FALLA: se esperaba "%" en: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'FALLA:%' then raise; end if;
  if position(lower(p_pattern) in lower(sqlerrm)) = 0 then
    raise exception 'FALLA: error distinto. Esperado "%", recibido "%"', p_pattern, sqlerrm;
  end if;
end $$;

-- ---------- 1. Las categorías de antes quedaron como datos ----------
select pg_temp.check(
  (select array_agg(public.category_value(c) order by public.category_value(c)) from public.product_categories c)
  = array['Accesorios', 'Cafetería', 'Comida', 'Juegos de Mesa', 'Rol', 'Rol · Dados', 'TCG',
          'TCG · Flesh and Blood', 'TCG · Lorcana', 'TCG · Magic', 'TCG · Pokémon', 'TCG · Yu-Gi-Oh!', 'Torneos'],
  '1a: categorías sembradas');
select pg_temp.check(
  (select catalog_sources from public.product_categories where name = 'Accesorios') = '{dragon-shield,ultra-pro-pokemon}',
  '1b: accesorios ligados al catálogo');

-- ---------- 2. Fuente del catálogo rellenada ----------
select pg_temp.check(
  (select array_agg(source order by id) from public.catalog_products) = '{pokemon,magic,dragon-shield,one-piece}',
  '2: source de lo ya importado');

-- ---------- 3. La búsqueda solo muestra lo que se vende ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2"}', false);
set role authenticated;
select pg_temp.check((select count(*) from public.search_catalog('booster box')) = 0, '3a: One Piece no se vende');
select pg_temp.check((select count(*) from public.search_catalog('elite')) = 1, '3b: Pokémon sí');
select pg_temp.check((select source from public.search_catalog('sleeves')) = 'dragon-shield', '3c: columna source');
select pg_temp.check((public.catalog_status() ->> 'products')::int = 3, '3d: catalog_status cuenta lo que se vende');

-- ---------- 4. El mostrador lee pero no cambia categorías ----------
select pg_temp.check((select count(*) from public.product_categories) = 13, '4a: mostrador lee');
select pg_temp.expect_error($$insert into public.product_categories (name) values ('Hack')$$, 'row-level security');
update public.product_categories set name = 'Hack' where name = 'Comida';
select pg_temp.check(exists (select 1 from public.product_categories where name = 'Comida'), '4b: mostrador no renombra');

-- ---------- 5. Admin: alta, reglas y catálogo ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1"}', false);

insert into public.product_categories (parent_id, name, catalog_sources)
select id, 'One Piece', '{one-piece}' from public.product_categories where name = 'TCG';
select pg_temp.check((select count(*) from public.search_catalog('booster box')) = 1, '5a: al ligar One Piece aparece');

select pg_temp.expect_error(
  $$insert into public.product_categories (name, catalog_sources) values ('Otra', '{pokemon}')$$,
  'ya está ligado a la categoría "TCG · Pokémon"');
select pg_temp.expect_error($$insert into public.product_categories (name) values ('cafetería')$$, 'duplicate key');
select pg_temp.expect_error($$insert into public.product_categories (name) values ('A · B')$$, 'check constraint');
select pg_temp.expect_error(
  $$insert into public.product_categories (parent_id, name)
    select id, 'Nieta' from public.product_categories where name = 'Pokémon'$$,
  'Solo se permite un nivel');
select pg_temp.expect_error(
  $$update public.product_categories set parent_id = (select id from public.product_categories where name = 'Cafetería')
    where name = 'TCG'$$,
  'no puede volverse subcategoría');

-- ---------- 6. Renombrar mueve a los productos ----------
update public.product_categories set name = 'Juegos de cartas' where name = 'TCG';
select pg_temp.check(
  (select array_agg(category order by barcode) from public.products where barcode in ('P1', 'P2', 'P4'))
  = array['Juegos de cartas · Pokémon', 'Juegos de cartas · Pokémon', 'Juegos de cartas'],
  '6a: renombrar la principal');
update public.product_categories set name = 'Pokemon' where name = 'Pokémon';
select pg_temp.check((select category from public.products where barcode = 'P1') = 'Juegos de cartas · Pokemon', '6b: renombrar subcategoría');
update public.product_categories set parent_id = null where name = 'Dados';
select pg_temp.check((select category from public.products where barcode = 'P5') = 'Dados', '6c: subcategoría a principal');

-- ---------- 7. Borrar ----------
select pg_temp.expect_error($$delete from public.product_categories where name = 'Cafetería'$$, 'tiene 1 producto');
select pg_temp.expect_error($$delete from public.product_categories where name = 'Juegos de cartas'$$, 'tiene subcategorías');
delete from public.product_categories where name = 'Torneos';
select pg_temp.check(not exists (select 1 from public.product_categories where name = 'Torneos'), '7: borrar sin productos');

reset role;
select 'OK: categorías configurables';
