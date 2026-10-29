-- =====================================================================
-- Nombre de los tickets: solo el folio
--
-- Los tickets se guardaban como "Ticket 140". La palabra no aporta nada:
-- ahora el nombre es solo el folio ("140") y la app arma el título con el
-- cliente ("140. Ana Martínez"). La app ya entiende los dos formatos, así
-- que esta migración se puede aplicar antes o después de publicarla.
-- =====================================================================

-- Ventas existentes.
update public.tickets
set name = number::text
where name = 'Ticket ' || number;

-- Ventas nuevas: pay_ticket guarda el folio sin la palabra "Ticket".
do $$
declare
  v_def text := pg_get_functiondef(
    'public.pay_ticket(uuid, text, public.payment_method, jsonb, uuid, timestamptz, boolean, jsonb)'::regprocedure);
begin
  if position('''Ticket '' || v_number,' in v_def) = 0 then
    raise exception 'pay_ticket cambió: revisa esta migración';
  end if;
  execute replace(v_def, '''Ticket '' || v_number,', 'v_number::text,');
end $$;
