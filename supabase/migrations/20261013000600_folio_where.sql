-- =====================================================================
-- Inventario Hachiko · Corrección del contador de folios
-- Supabase rechaza UPDATE sin WHERE en peticiones de la app (pg_safeupdate):
-- "UPDATE requires a WHERE clause". El contador es de una sola fila, pero
-- igual necesita su WHERE.
-- =====================================================================

create or replace function public._next_ticket_number()
returns bigint
language sql
security definer
set search_path = ''
as $$
  update public.ticket_counter set last_number = last_number + 1 where id returning last_number;
$$;
