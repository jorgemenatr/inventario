-- =====================================================================
-- Código de cliente (opcional)
--
-- customers.code: ID del cliente que se liga a un código de barras
-- (tarjeta de cliente). 8 dígitos y siempre empieza con 1 (10000001…).
--   * Es opcional; un cliente sin código sigue funcionando igual.
--   * No se repite entre clientes.
--   * Para tener código el cliente necesita correo y teléfono.
-- En el mostrador, escanear el código asigna el cliente al ticket.
-- =====================================================================

alter table public.customers add column code text;

alter table public.customers
  add constraint customers_code_format check (code is null or code ~ '^1[0-9]{7}$'),
  add constraint customers_code_contact check (
    code is null
    or (nullif(btrim(email), '') is not null and nullif(btrim(phone), '') is not null)
  ),
  add constraint customers_code_key unique (code);
