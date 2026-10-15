-- =====================================================================
-- Inventario Hachiko · Categorías fijas de producto
--
-- products.category ahora toma uno de estos valores (la lista vive en la app,
-- src/lib/categories.ts):
--   TCG · Pokémon | TCG · Yu-Gi-Oh! | TCG · Lorcana | TCG · Magic |
--   TCG · Flesh and Blood | TCG (otros juegos) | Accesorios | Cafetería |
--   Comida | Juegos de Mesa | Torneos
--
-- No se pone un CHECK: altas viejas en la cola sin conexión podrían traer
-- texto libre y fallarían para siempre. Aquí solo se acomodan los productos
-- que ya existían (la categoría se llenaba con el juego del catálogo).
-- =====================================================================

update public.products set category = case
  when category ~* 'pok[eé]mon'                 then 'TCG · Pokémon'
  when category ~* 'yu.?gi.?oh'                 then 'TCG · Yu-Gi-Oh!'
  when category ~* 'lorcana'                    then 'TCG · Lorcana'
  when category ~* 'magic'                      then 'TCG · Magic'
  when category ~* 'flesh'                      then 'TCG · Flesh and Blood'
  when category ~* 'dragon shield|ultra ?pro|accesorio' then 'Accesorios'
  when category ~* 'caf[eé]'                    then 'Cafetería'
  when category ~* 'comida|snack|bebida'        then 'Comida'
  when category ~* 'juegos? de mesa|board'      then 'Juegos de Mesa'
  when category ~* 'torneo'                     then 'Torneos'
  -- Otros juegos del catálogo (One Piece, Digimon…).
  when category ~* 'card game|tcg|digimon|star wars|dragon ball|weiss|gundam|riftbound' then 'TCG'
  else category
end
where category is not null;
