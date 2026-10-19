-- =====================================================================
-- Inventario Hachiko · El costo del producto solo lo ve un admin (2 de 2)
--
-- products.cost (último costo de compra) ya no se puede leer con el rol de
-- la app: se quita el SELECT de esa columna. El admin lo lee con la vista
-- product_costs (20261019000200_vista_costos.sql).
-- Aplicar solo cuando la app publicada ya lea el costo de product_costs.
--
-- OJO: al agregar columnas nuevas a products hay que darles SELECT aquí
-- (grant select (columna) on public.products to authenticated).
-- =====================================================================

revoke select on public.products from authenticated;
grant select (
  id, barcode, name, category, supplier, supplier_id, price, quantity, warehouse_quantity,
  image_url, is_internal_code, description, catalog_product_id, created_by, created_at, updated_at
) on public.products to authenticated;
