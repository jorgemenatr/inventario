-- =====================================================================
-- Combos con grupo de bebidas
--
-- Antes cada combo tenía su propia lista de opciones (product_combo_options).
-- En la práctica todas las bebidas aplican a todos los combos, así que ahora:
--   * products.is_combo: el producto es un combo que incluye una bebida.
--   * app_settings.combo_drinks_category: la categoría (texto de
--     products.category, p. ej. "Cafetería · Bebidas") cuyos productos son
--     las bebidas a elegir. Se cambia la lista moviendo productos de categoría.
-- checkout_ticket valida la bebida contra ese grupo.
--
-- Los productos que ya tenían opciones quedan marcados como combo.
-- product_combo_options ya no se usa; se conserva para la app publicada
-- hasta que se actualice (se puede borrar en una migración posterior).
-- =====================================================================

alter table public.products add column is_combo boolean not null default false;

grant select (is_combo) on public.products to authenticated;
grant insert (is_combo) on public.products to authenticated;
grant update (is_combo) on public.products to authenticated;

update public.products p set is_combo = true
where exists (select 1 from public.product_combo_options o where o.combo_product_id = p.id);

alter table public.app_settings add column combo_drinks_category text;

grant select (combo_drinks_category) on public.app_settings to authenticated;
grant update (combo_drinks_category) on public.app_settings to authenticated;

-- Solo un admin marca combos (igual que el resto del producto).
create or replace function public.guard_products()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Solo un administrador puede dar de alta productos' using errcode = '42501';
  end if;
  -- Mostrador: solo puede cambiar la cantidad (ventas con checkout_ticket).
  if (new.barcode, new.name, new.category, new.supplier, new.supplier_id, new.cost, new.price, new.image_url,
      new.is_internal_code, new.description, new.catalog_product_id, new.track_stock,
      new.is_preorder, new.preorder_deposit_type, new.preorder_deposit_value, new.is_combo)
     is distinct from
     (old.barcode, old.name, old.category, old.supplier, old.supplier_id, old.cost, old.price, old.image_url,
      old.is_internal_code, old.description, old.catalog_product_id, old.track_stock,
      old.is_preorder, old.preorder_deposit_type, old.preorder_deposit_value, old.is_combo) then
    raise exception 'Solo un administrador puede editar productos' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- checkout_ticket: la bebida del combo debe estar en el grupo de bebidas.
-- Se parcha la definición vigente (como en productos_sin_inventario).
-- ---------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef(
    'public.checkout_ticket(uuid, jsonb, jsonb, uuid, text, text, timestamptz)'::regprocedure);
  v_old text := '  if exists (select 1 from _co_items i where i.choice_product_id is not null
             and not exists (select 1 from public.product_combo_options o
                             where o.combo_product_id = i.product_id and o.option_product_id = i.choice_product_id)) then
    raise exception ''El refresco elegido no es una opción de ese combo'' using errcode = ''22023'';
  end if;';
  v_new text := '  if exists (select 1 from _co_items i
             join public.products cp on cp.id = i.product_id
             join public.products ch on ch.id = i.choice_product_id
             where not cp.is_combo
                or ch.category is distinct from (select s.combo_drinks_category from public.app_settings s)) then
    raise exception ''La bebida elegida no está en el grupo de bebidas de los combos'' using errcode = ''22023'';
  end if;';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'checkout_ticket cambió: revisa esta migración';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
