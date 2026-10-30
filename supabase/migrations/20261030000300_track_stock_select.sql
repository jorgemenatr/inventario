-- =====================================================================
-- La app puede leer products.track_stock
--
-- products tiene SELECT por columna (20261019000300_costo_solo_admin.sql):
-- a la columna nueva de 20261030000100 le faltó su grant. Sin él la app no
-- podía cargar el catálogo y se quedaba con la copia vieja (la comida y los
-- torneos aparecían con 0 piezas en el mostrador).
-- =====================================================================

grant select (track_stock) on public.products to authenticated;
