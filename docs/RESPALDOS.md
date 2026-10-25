# Respaldos

El workflow **Respaldo de clientes** (`.github/workflows/respaldo.yml`) respalda a todos
los clientes de `src/tenants.json`:

| Cuándo | Qué | Se guarda |
| --- | --- | --- |
| Todos los días (02:41 hora de CDMX) | La base: ventas, inventario, clientes, créditos, usuarios… (`respaldo-base-…`) | 14 días |
| Domingos | La base **y las fotos** de productos (`respaldo-completo-…`) | 35 días |

Así lo más que se puede perder es un día de movimientos. Las fotos van solo los domingos
porque casi no cambian y son lo que más pesa. Cada respaldo trae:

| Archivo | Qué trae |
| --- | --- |
| `app.sql` | Todo el esquema `public` (tablas, funciones, triggers, permisos, políticas) con sus datos, y el registro de migraciones |
| `usuarios.sql` | Los usuarios (`auth.users`, `auth.identities`, con sus contraseñas cifradas) y los buckets |
| `storage/product-images/…` | Las fotos de los productos |

Todo va en un solo archivo **cifrado** (`respaldo-base-AAAA-MM-DD.tar.gz.gpg` o
`respaldo-completo-…`), guardado como artifact de la corrida: **Actions → Respaldo de
clientes → la corrida → Artifacts**. El repositorio es público y cualquiera con cuenta de GitHub puede
bajar los artifacts; por eso van cifrados, y sin `BACKUP_PASSPHRASE` el workflow no sube
nada.

## Configurar (una vez)

En GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

- `SUPABASE_ACCESS_TOKEN`: el mismo de "Actualizar clientes".
- `BACKUP_PASSPHRASE`: una contraseña **larga** (16+ caracteres; mejor una frase).
  **Guárdala también fuera de GitHub** (gestor de contraseñas): sin ella los respaldos no
  se pueden abrir, y GitHub no deja volver a verla.

Para probar: **Actions → Respaldo de clientes → Run workflow** (con o sin fotos).

El respaldo usa un acceso temporal de **solo lectura** a cada base que da la API de
Supabase (dura 5 minutos), así que no necesita la contraseña de la base.

## Abrir un respaldo

Necesitas `gpg` (Linux/macOS: ya viene o con tu gestor de paquetes; Windows: Gpg4win).

```bash
gpg --decrypt respaldo-base-2026-10-26.tar.gz.gpg | tar -xz
# → respaldos/<id-del-proyecto>/app.sql, usuarios.sql, storage/…
```

Los `.sql` son texto: se pueden revisar o buscar ahí un dato puntual (una venta, un
cliente) sin restaurar nada.

## Restaurar un cliente

Se restaura **siempre en un proyecto nuevo**, nunca encima del dañado (el comando se niega
si el proyecto destino ya tiene datos). Así el original queda intacto hasta confirmar que
todo está bien.

1. En Supabase, **New project** (misma región que el original). Espera a que esté listo.
2. Abre el respaldo más reciente. Si es de base (sin fotos), copia también la carpeta
   `storage/` del último respaldo completo dentro de `respaldos/<id-original>/`.
3. Con Postgres 17 instalado (`psql`) y `.env.clientes` con tu token:

   ```bash
   npm run clientes -- restaurar --ref <nuevo> --dir respaldos/<id-original> --confirmar <nuevo>
   ```

   Carga en este orden: quita los permisos automáticos de Supabase para tablas nuevas
   (si no, las tablas quedarían con más permisos que los originales), los usuarios, la
   base de la app (con sus permisos exactos) y las fotos.
4. `npm run clientes -- estado --ref <nuevo>` debe decir "migraciones al día".
5. Cierra el registro público del proyecto nuevo (Authentication → Sign In / Providers),
   despliega la función: `npm run clientes -- funciones --ref <nuevo>`.
6. En `src/tenants.json`, cambia `supabase_url` y `anon_key` del cliente por los del
   proyecto nuevo, commit y push. Los usuarios entran con sus mismas contraseñas.
7. Cuando confirmes que todo está bien, pausa o borra el proyecto viejo.

El orden y los permisos se probaron en un Postgres local: después de restaurar, los
permisos de tablas, columnas y funciones, las políticas, los triggers, las funciones y
los datos quedan idénticos al original.
