-- =====================================================================
-- Pruebas de la configuración del negocio (nombre y prefijo de códigos
-- internos). Se corren en una base LOCAL recién creada con
-- supabase/tests/run.sh, nunca contra la base real.
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'admin@prueba.mx'),
  ('00000000-0000-0000-0000-0000000000c2', 'mostrador@prueba.mx');
update public.profiles set role = 'admin'     where id = '00000000-0000-0000-0000-0000000000c1';
update public.profiles set role = 'mostrador' where id = '00000000-0000-0000-0000-0000000000c2';

-- ---------- 1. Base nueva: valores por defecto ----------
do $$ begin
  if (select business_name from public.app_settings) <> 'Mi negocio'
     or (select internal_code_prefix from public.app_settings) <> 'HCH' then
    raise exception 'FALLA 1: valores por defecto inesperados';
  end if;
end $$;

-- ---------- 2. Sin códigos internos, el prefijo se puede cambiar (alta) ----------
update public.app_settings set business_name = 'Dragón Rojo', internal_code_prefix = 'DRG' where id;

do $$ begin
  begin
    update public.app_settings set internal_code_prefix = 'drg' where id;
    raise exception 'FALLA 2: aceptó un prefijo en minúsculas';
  exception when check_violation then null;
  end;
end $$;

-- ---------- 3. Los códigos internos usan el prefijo configurado ----------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1"}', false);
set role authenticated;

do $$
begin
  perform public.create_product(null, 'Sin código', 10);
  if (select barcode from public.products where name = 'Sin código') is distinct from 'DRG-000001' then
    raise exception 'FALLA 3a: código interno %', (select barcode from public.products where name = 'Sin código');
  end if;

  -- El prefijo propio está reservado; el de otro cliente ya no.
  begin
    perform public.create_product('drg-000999', 'Falso interno', 10);
    raise exception 'FALLA 3b: aceptó un código con el prefijo reservado';
  exception when others then
    if sqlerrm not like 'El prefijo DRG- está reservado%' then raise; end if;
  end;
  perform public.create_product('HCH-000999', 'Código de otra tienda', 10);

  -- Desvincular un código real asigna el siguiente código interno.
  perform public.create_product('7501234567890', 'Con código', 10);
  perform public.unlink_product((select id from public.products where name = 'Con código'), 'Etiqueta equivocada');
  if (select barcode from public.products where name = 'Con código') is distinct from 'DRG-000002' then
    raise exception 'FALLA 3c: unlink asignó %', (select barcode from public.products where name = 'Con código');
  end if;
end $$;

-- ---------- 4. Permisos ----------
-- El admin cambia el nombre, pero no el prefijo.
update public.app_settings set business_name = 'Dragón Rojo Games' where id;
do $$ begin
  begin
    update public.app_settings set internal_code_prefix = 'XYZ' where id;
    raise exception 'FALLA 4a: el admin pudo cambiar el prefijo';
  exception when insufficient_privilege then null;
  end;
end $$;

-- El mostrador lee, pero no cambia nada (RLS: 0 filas).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c2"}', false);
update public.app_settings set business_name = 'Hackeado' where id;
do $$ begin
  if (select business_name from public.app_settings) is distinct from 'Dragón Rojo Games' then
    raise exception 'FALLA 4b: el mostrador cambió el nombre';
  end if;
end $$;

-- anon no ve nada.
reset role;
set role anon;
do $$ begin
  begin
    perform 1 from public.app_settings;
    raise exception 'FALLA 4c: anon pudo leer app_settings';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------- 5. Ya con códigos internos, el prefijo no cambia ----------
do $$ begin
  begin
    update public.app_settings set internal_code_prefix = 'ABC' where id;
    raise exception 'FALLA 5: cambió el prefijo con códigos internos impresos';
  exception when others then
    if sqlerrm not like 'El prefijo de códigos internos ya no se puede cambiar%' then raise; end if;
  end;
end $$;

select 'OK: configuración del negocio';
