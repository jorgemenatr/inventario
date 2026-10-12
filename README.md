# Inventario Hachiko · Fase 1 (captura de inventario)

App web para hacer el levantamiento inicial del inventario de Hachiko con un lector
de código de barras USB conectado a una laptop. La base de datos queda lista para
construir después el punto de venta (POS) sobre ella.

**Stack:** Vite + React + TypeScript · Tailwind CSS · Supabase (Postgres, Auth, Storage)
· React Router · SheetJS · JsBarcode · Netlify.

---

## Puesta en marcha

### 1. Crear el proyecto en Supabase

1. Entra a <https://supabase.com/dashboard> → **New project**.
2. Elige nombre (p. ej. `hachiko`), contraseña de la base de datos y la región más cercana
   (p. ej. *East US* o *West US*).
3. Espera a que termine de aprovisionarse.

### 2. Desactivar el registro público

La app **no** tiene pantalla de "crear cuenta". Además, hay que cerrar el registro en Supabase,
porque si no cualquiera con la anon key podría crear un usuario por la API:

1. **Authentication → Sign In / Providers** (en algunas versiones del dashboard: *Authentication → Settings*).
2. Desactiva **Allow new users to sign up**.
3. Verifica que el proveedor **Email** esté habilitado (es el que usa el login con correo y contraseña).
4. Guarda.

### 3. Correr las migraciones

Las migraciones están en `supabase/migrations/` y deben aplicarse **en orden**:

| Archivo | Contenido |
| --- | --- |
| `20261012000100_esquema.sql` | Tipos, tablas `profiles`, `products`, `inventory_movements`, la secuencia `HCH-` y los triggers |
| `20261012000200_seguridad_rls.sql` | Permisos y políticas RLS |
| `20261012000300_funciones_rpc.sql` | RPC `register_scan`, `create_product`, `undo_movement`, `inventory_totals` y la vista `movement_history` |
| `20261012000400_storage.sql` | Bucket privado `product-images` y sus políticas |

**Opción A: SQL Editor (lo más sencillo).** En el dashboard ve a **SQL Editor → New query**,
pega el contenido de cada archivo en orden y presiona **Run**.

**Opción B: Supabase CLI.**

```bash
npx supabase login
npx supabase link --project-ref <ID-DEL-PROYECTO>   # el ID está en la URL del dashboard
npx supabase db push
```

### 4. Crear el primer usuario

1. **Authentication → Users → Add user → Create new user**.
2. Escribe correo y contraseña y marca **Auto Confirm User**. Si no lo marcas, el login dirá
   que el correo no está confirmado.
3. El perfil se crea solo en `public.profiles` con rol `staff` (lo hace un trigger).
4. Opcional: para que la primera cuenta sea administradora, corre esto en el SQL Editor:

   ```sql
   update public.profiles set role = 'admin' where email = 'tu-correo@ejemplo.com';
   ```

   (En esta fase el rol solo se guarda; todavía no restringe nada.)

Para agregar más personas, repite el paso 1. Para quitar el acceso a alguien, bórralo o
bloquéalo desde la misma pantalla.

### 5. Variables de entorno

Copia `.env.example` a `.env.local` y llena los valores de **Project Settings → API**:

```bash
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...   # la "anon" / "publishable" key
```

> ⚠️ **Nunca** pongas la `service_role` (o *secret*) key en el frontend ni en Netlify. Todo lo
> que empieza con `VITE_` termina en el JavaScript público. La anon key es segura de exponer
> porque toda la protección está en RLS.

### 6. Correr la app en local

Requiere Node 20 o superior (recomendado 22).

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # verifica tipos y genera dist/
```

### 7. Publicar en Netlify

1. En Netlify: **Add new site → Import an existing project** y conecta este repositorio.
2. Netlify toma la configuración de `netlify.toml`: `npm run build`, carpeta `dist` y
   redirección SPA para que `/historial` y `/etiqueta/...` funcionen al recargar.
3. En **Site configuration → Environment variables** agrega `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_ANON_KEY`, y vuelve a desplegar (las variables se leen en el *build*).
4. Netlify sirve en HTTPS, que es lo que necesita la webcam (`getUserMedia`).
5. Opcional: en Supabase, **Authentication → URL Configuration → Site URL**, pon la URL de
   Netlify.

---

## El día del escaneo

### Configurar el lector

- El lector debe mandar **Enter** al final de cada código (sufijo CR). Casi todos vienen así
  de fábrica.
- **Distribución de teclado:** muchos lectores "teclean" como un teclado de EE. UU. Si la
  laptop está en *Español (Latinoamérica)*, el guion de `HCH-000001` puede llegar como
  `HCH'000001`. La app lo corrige sola para los códigos internos. Aun así, la primera prueba
  con el lector real debe ser escanear una etiqueta `HCH-` impresa. Si otros códigos con
  símbolos salen mal, configura el lector para que use la misma distribución que la laptop
  (viene en el manual del lector, con códigos de configuración).
- Haz una prueba de escaneo después de cada cambio de configuración.

### Probar sin lector

Abre la app con `?simulador=1` para mostrar un **simulador de lector**: escribe códigos a
velocidad de lector en el campo con foco y manda Enter. Se apaga con `?simulador=0`. Detalles en
[`docs/PRUEBAS_MANUALES.md`](docs/PRUEBAS_MANUALES.md).

### Cómo se usa

- **Sumar** con cantidad `1`: escanea pieza por pieza. Con `24`: "tengo 24 de estos".
- **Fijar total**: cada escaneo deja la cantidad del producto en el valor indicado (para corregir).
- **Código desconocido**: se abre el formulario con el código ya puesto. Nombre y precio son
  obligatorios. *Enter* guarda y *Esc* cancela.
- **Producto sin código**: genera `HCH-000001`, `HCH-000002`, … y ofrece imprimir una etiqueta
  Code128 de 50 × 30 mm (ajusta la escala en el diálogo de impresión si tu etiqueta es de otro tamaño).
- **Deshacer último escaneo**: revierte el escaneo más reciente de la sesión con un movimiento de
  ajuste. Si lo presionas otra vez, deshace el anterior.
- El foco regresa solo al campo de escaneo. Si el lector "escribe" por accidente en el campo
  de cantidad, la app lo detecta y lo procesa como escaneo. Si pasa dentro del formulario de
  producto nuevo, lo ignora y avisa, para que no se guarde un código como nombre.

---

## Decisiones de diseño

### Modelo de datos

- `products.quantity` es el stock actual. **Todo** cambio pasa por una RPC que actualiza la
  cantidad e inserta el movimiento en la misma transacción.
- `inventory_movements` es *append-only* (sin UPDATE ni DELETE desde el cliente). Cada
  movimiento guarda `delta`, `quantity_after` y quién lo hizo (`created_by = auth.uid()`).
  El tipo `sale` ya existe en el enum para el POS.
- `client_op_id` (único) hace las RPC **idempotentes**: si la red se cae justo después de
  enviar un escaneo y la cola lo reintenta, no se cuenta dos veces.
- `reverts_movement_id` (único) liga cada "deshacer" con el movimiento que revierte. Así un
  movimiento no se puede deshacer dos veces.
- El prefijo `HCH-` está reservado: solo lo genera la secuencia. No se puede dar de alta
  a mano un código que empiece así.
- Precio y costo son `numeric(12,2)`. No hay `CHECK quantity >= 0`, para no estorbar al POS;
  la captura sí valida que no se metan cantidades negativas.

### Seguridad (RLS)

- RLS está activado en `profiles`, `products` e `inventory_movements`. Además se revocaron
  todos los privilegios de `anon`: sin sesión no se puede leer ni escribir nada, ni llamar
  a las RPC.
- `authenticated` puede leer, crear y editar `products`. **No hay política DELETE**: los
  productos solo se borran desde el dashboard.
- `authenticated` lee todos los `profiles`, para mostrar "quién lo hizo" en el historial y en
  la exportación. Los perfiles solo se crean con el trigger.
- Las RPC son `SECURITY INVOKER` con `search_path` fijo, así que respetan RLS.
  **Riesgo aceptado para la Fase 1:** como el usuario necesita permiso de UPDATE en
  `products`, técnicamente podría cambiar `quantity` sin pasar por la RPC (sin movimiento).
  La app nunca lo hace. En la fase del POS conviene cerrarlo: quitar el UPDATE de
  `quantity` al rol y mover las RPC a `SECURITY DEFINER` con validación de rol.

### Imágenes (bucket privado)

- `product-images` es **privado**: solo usuarios autenticados suben y leen.
- `products.image_url` guarda la **ruta** del archivo (p. ej. `products/<uuid>.jpg`), no una
  URL, porque las URLs firmadas caducan. La app genera una URL firmada (1 h) cada vez que
  muestra una imagen.
- En la exportación, la columna "URL de imagen" trae una URL firmada que **vale 7 días**. Si
  algún día se necesitan links permanentes en el Excel, habría que hacer público el bucket
  (y aceptar que cualquiera con el link vea las fotos).
- Antes de subir, las imágenes se redimensionan en el navegador a un máximo de 800 px por
  lado y se comprimen a JPEG.

### Sin conexión (respaldo local)

- La app guarda en `localStorage` una copia del catálogo (código → nombre, cantidad…). Con
  eso sabe si un código existe aunque no haya red, y calcula los contadores.
- Si una operación falla por red, se guarda en una **cola** en `localStorage` y el
  encabezado muestra **"Sin conexión: N pendientes"**. Mientras haya pendientes, las nuevas
  operaciones también se encolan, para conservar el orden.
- Al volver la red (evento `online` o una prueba de conexión cada 15 s), la cola se
  sincroniza en orden, sola.
- Sin red **sí** se puede: escanear códigos conocidos, dar de alta productos nuevos (sin
  imagen) y deshacer.
- Sin red **no** se puede: generar códigos `HCH-` (la secuencia vive en la base de datos),
  subir imágenes ni exportar.
- Si la sesión expira sin red, la cola no se pierde. Al volver la red, la sesión se refresca
  sola; si no se puede, la app pide iniciar sesión y luego sincroniza.
- Si cierras sesión con pendientes, la app pide confirmación. La cola se queda en la
  computadora y se envía con el siguiente inicio de sesión.
- Si el servidor rechaza una operación de la cola (p. ej. un código que ya no existe), se
  aparta y se muestra en **Historial → Operaciones locales** para revisarla a mano.
- Pensado para **una sola computadora escaneando a la vez**. Con varias, "Fijar total"
  desde la cola podría pisar lo que otra sumó mientras tanto.

### Exportación

- **Exportar Excel (.xlsx)** es el formato recomendado para abrir en Excel: el código se
  guarda como **texto**, así que no se pierden ceros a la izquierda ni aparece notación
  científica (`7.50101E+12`).
- **Exportar CSV** va en UTF-8 con BOM (Excel respeta los acentos). Ojo: si abres el CSV con
  doble clic en Excel, **Excel convierte los códigos largos a número** y los daña. Usa el CSV
  para importar a otros sistemas, y el .xlsx para Excel.
- En **Historial** también se exportan los movimientos, con el usuario que hizo cada uno.

---

## Estructura

```
supabase/migrations/     Migraciones SQL (esquema, RLS, RPC, storage)
src/
  lib/supabase.ts        Cliente único de Supabase + detección de errores de red/sesión
  auth/                  AuthProvider, useAuth, ProtectedRoute (listo para roles)
  store/                 Store de inventario: caché, cola offline, deshacer, sincronización
  pages/                 Login, Escaneo, Historial, Etiqueta
  components/            Layout, formulario de producto, webcam, imagen, foco
  lib/                   Exportación, imágenes, sonidos, normalización de códigos
netlify.toml             Build + redirección SPA
```

Pruebas manuales para el día del escaneo: [`docs/PRUEBAS_MANUALES.md`](docs/PRUEBAS_MANUALES.md).
