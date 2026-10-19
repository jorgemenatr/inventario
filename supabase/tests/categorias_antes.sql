-- Datos de una base en uso ANTES de 20261020000200_categorias_configurables.sql
-- (los carga run.sh entre migraciones). Solo para pruebas locales.
\set ON_ERROR_STOP 1
\set QUIET 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'admin@prueba.mx'),
  ('00000000-0000-0000-0000-0000000000d2', 'mostrador@prueba.mx');
update public.profiles set role = 'admin'     where id = '00000000-0000-0000-0000-0000000000d1';
update public.profiles set role = 'mostrador' where id = '00000000-0000-0000-0000-0000000000d2';

insert into public.products (barcode, name, price, category) values
  ('P1', 'Booster Pokémon',  100, 'TCG · Pokémon'),
  ('P2', 'Booster Pokémon 2', 100, 'TCG · Pokémon'),
  ('P3', 'Café americano',    40, 'Cafetería'),
  ('P4', 'Mazo One Piece',   300, 'TCG'),
  ('P5', 'Dados',             50, 'Rol · Dados'),
  ('P6', 'Sin categoría',     10, null);

insert into public.catalog_products (id, category_id, game, group_id, name) values
  (1, 3,  'Pokemon',              10, 'Elite Trainer Box'),
  (2, 1,  'Magic: The Gathering', 11, 'Bundle'),
  (3, 31, 'Dragon Shield',        12, 'Matte Sleeves'),
  (4, 68, 'One Piece Card Game',  13, 'Booster Box');
