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
| `20261012000500_catalogo_tcg.sql` | Tabla `catalog_products`, vínculo en `products`, RPC `search_catalog` y `catalog_status` |
| `20261013000100_catalogo_busqueda_accesorios.sql` | Búsqueda con palabras en español (micas, tapete, carpeta, colores…) |
| `20261013000200_clientes.sql` | Tabla `customers` (clientes) y sus permisos |
| `20261013000300_ventas.sql` | Tablas `tickets` y `ticket_items`, RPC `pay_ticket` y vista `sales_history` |
| `20261013000400_creditos.sql` | Créditos de tienda (`customer_credit_movements`, `grant_credits`) y pagos con varios métodos (`ticket_payments`) |
| `20261013000500_folio_tickets.sql` | Folio consecutivo de tickets ("Ticket 1, 2, 3…") asignado al cobrar |

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

### 8. Cargar el catálogo TCG

Ver [Catálogo TCG](#catálogo-tcg). Se hace una vez al inicio y luego se mantiene solo (o
a mano con cada expansión).

---

## Catálogo TCG

Para no capturar a mano nombre, foto y descripción del producto sellado, la app tiene una
copia del catálogo de **TCGplayer** (vía [tcgcsv.com](https://tcgcsv.com), un espejo
público y gratuito que se actualiza a diario). Incluye **producto sellado** (cajas,
sobres, ETB, blisters, mazos, latas…, sin cartas sueltas) y **accesorios**:

| Fuente (`--juegos`) | Qué trae | Productos aprox. | Con código de barras |
| --- | --- | --- | --- |
| `pokemon` | Pokémon (inglés), sellado | 2,900 | ~950 |
| `magic` | Magic: The Gathering, sellado | 3,800 | ~1,050 |
| `yugioh` | Yu-Gi-Oh!, sellado | 1,200 | ~440 |
| `lorcana` | Disney Lorcana, sellado | 180 | — |
| `flesh-and-blood` | Flesh and Blood, sellado | 230 | — |
| `dragon-shield` | **Todo** Dragon Shield: micas, deck boxes, playmats, carpetas, páginas, contadores | 800 | ~130 |
| `ultra-pro-pokemon` | Ultra Pro **solo de Pokémon**: carpetas, portafolios, deck boxes, micas, playmats | 430 | ~45 |

(Cifras de octubre de 2026.)

### Cómo funciona al escanear

1. Escaneas un código que no está en el inventario y se abre **Producto nuevo**.
2. Si ese código viene en el catálogo, el producto se **vincula solo** ("Encontrado en el
   catálogo por código de barras"). Pasa con parte de Magic, Yu-Gi-Oh! y Pokémon.
3. Si no, el cursor queda en **Buscar en el catálogo TCG**. Escribe palabras del nombre en
   cualquier orden, como aparecen en TCGplayer (en inglés): `delta reign etb`,
   `151 booster bundle`, `bloomburrow play box`. También entiende `etb`, `upc`
   (Ultra Premium Collection), `caja`, `sobre`, `mazo` y `lata`, y para accesorios
   `micas`, `carpeta`, `tapete`, `portafolio`, `bolsillos`, `mate` y los colores
   (`micas negras mate dragon`, `tapete pikachu`, `carpeta charizard 9 bolsillos`).
   Flechas para moverte y Enter para elegir.
4. Se llenan **nombre, categoría (el juego), descripción y foto**. Tú solo pones precio,
   costo y cantidad, y guardas. El nombre y la descripción se pueden editar (p. ej. agregar
   "(español)").
5. A partir de ahí ese código de barras queda ligado al producto. **El vínculo se hace una
   sola vez por SKU**, no por pieza.

Detalles:

- En accesorios, la categoría queda como la marca (`Dragon Shield` o `Ultra Pro`).
- La foto se **descarga y se guarda en el bucket propio** (`product-images`), igual que una
  foto tomada con la cámara. No depende de TCGplayer después del alta. Si subes o tomas una
  foto propia, tiene prioridad sobre la del catálogo.
- El precio de TCGplayer (en dólares) se muestra **solo como referencia**; no llena el
  precio de venta.
- Si eliges un producto del catálogo que ya está vinculado a otro código, la app avisa
  ("Ya está en inventario con el código …"), pero te deja continuar: hay productos que
  tienen dos códigos (p. ej. otra impresión o idioma).
- **Producto en español:** TCGplayer cataloga la versión en inglés. Para producto en
  español, vincula la versión en inglés equivalente (misma caja, mismo set) y ajusta el
  nombre si quieres. La foto será la de la caja en inglés.
- Sin internet no se puede buscar en el catálogo; el alta se hace a mano como antes.

### Cargar o actualizar el catálogo

**¿Hay que hacerlo con cada expansión nueva?** Sí: el catálogo es una copia, así que los
productos de una expansión aparecen hasta que se vuelve a importar. TCGplayer suele
publicar el producto sellado unas semanas **antes** del lanzamiento (preventa), así que
normalmente ya está cuando llega la mercancía. Hay dos formas, y **la importación es
segura de repetir**: actualiza lo que ya existe, agrega lo nuevo y nunca borra, así que
los productos ya vinculados no se pierden.

Ambas usan la **service_role key** de Supabase (*Project Settings → API*, "service_role" o
"secret"). Esa llave se salta todos los permisos: **nunca** la pongas en Netlify, en
variables `VITE_` ni en el código de la app.

**Opción A: automática con GitHub Actions (recomendada).** Se actualiza sola cada lunes.

1. En GitHub, en el repositorio: **Settings → Secrets and variables → Actions → New
   repository secret**. Crea dos:
   - `SUPABASE_URL`: la URL del proyecto (`https://xxxx.supabase.co`).
   - `SUPABASE_SERVICE_ROLE_KEY`: la service_role key.
2. Ve a la pestaña **Actions → Importar catálogo TCG → Run workflow** para la primera carga
   (tarda menos de un minuto). Al terminar, el resumen muestra cuántos productos importó
   por juego.
3. Ya no hay que hacer nada: corre cada lunes. Si sale una expansión a media semana y la
   necesitas ya, repite el paso 2.

**Opción B: a mano desde una computadora** (Node 22 o superior).

```bash
cp .env.catalogo.example .env.catalogo   # y llénalo (está en .gitignore)
npm run catalogo                          # todos los juegos
npm run catalogo -- --juegos pokemon      # solo un juego
npm run catalogo -- --desde 2026-01-01    # solo sets publicados desde esa fecha (no aplica a accesorios)
npm run catalogo -- --juegos dragon-shield,ultra-pro-pokemon   # solo accesorios
npm run catalogo -- --prueba              # descarga sin escribir en Supabase (catalogo-prueba.json)
```

En la app, el buscador muestra cuántos productos tiene el catálogo y la fecha de la última
importación.

**Agregar otro juego o marca** (p. ej. One Piece o Ultimate Guard): súmalo a `JUEGOS` en
`scripts/importar-catalogo.mjs` con su `categoryId` de TCGplayer (la lista está en
<https://tcgcsv.com/tcgplayer/categories>) y vuelve a importar. Para accesorios se filtra
por el nombre del grupo (la marca) y, si quieres, por el nombre del producto, como se
hace con Ultra Pro y Pokémon.

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

## Menú

El menú lateral queda: **Mostrador · Ventas · Clientes · Inventario**. Al entrar a Inventario
aparecen sus subsecciones: **Agregar** (la pantalla de escaneo para dar de alta y contar
productos, en `/agregar`) e **Historial**. Al iniciar sesión la app abre en el **Mostrador**.

## Inventario

En **Inventario** (`/inventario`) se consultan los productos dados de alta:

- **Cuadrícula** (foto, nombre, precio y stock) o **Lista** (tabla con código, categoría,
  proveedor, stock y precio, ordenable con clic en el encabezado). La app recuerda la
  última vista elegida.
- Buscador (nombre, código, categoría o proveedor), filtro por categoría y por existencias.
- Arriba, el total de productos, piezas y valor a precio de venta de lo que está filtrado.
- Usa la misma copia local que Escaneo, así que también funciona sin conexión. Las fotos sí
  necesitan internet.

## Clientes

En **Clientes** (`/clientes`) se da de alta y se consulta a los clientes de la tienda:

- **Nombre** obligatorio; **correo** y **teléfono** opcionales.
- **Juegos que juega**: selección múltiple como tags. Un clic agrega o quita un juego de la
  lista (Pokémon, Magic, Yu-Gi-Oh!, Lorcana, Star Wars Unlimited…) y "Otro juego" permite
  escribir uno nuevo; los juegos que ya tiene algún cliente aparecen como opción para los
  demás.
- La lista se busca por nombre, correo o teléfono y se filtra por juego. Al abrir un
  cliente se ven sus datos y se pueden editar.
- Los clientes no se borran desde la app (solo desde el dashboard de Supabase), porque
  después tendrán ventas ligadas.

## Mostrador y ventas

### Mostrador (`/mostrador`)

1. **Abre un ticket** con "Nuevo ticket". Puede haber varios abiertos a la vez; en la
   columna izquierda se identifican por su cliente (o "Sin cliente"), la hora en que se
   abrieron, las piezas y el total. No llevan nombre: **al cobrarlos reciben su folio**
   ("Ticket 1", "Ticket 2", …), consecutivo y sin repetirse nunca. Las ventas cobradas sin
   conexión reciben su folio al sincronizarse.
2. **Asigna un cliente** (opcional): búscalo por nombre o teléfono, o dalo de alta ahí mismo
   con "Nuevo cliente".
3. **Agrega productos** con el lector (código + Enter) o escribiendo parte del nombre y
   eligiendo con flechas + Enter. La cantidad se cambia con − / + o escribiéndola.
4. Elige la **forma de pago** (efectivo, tarjeta, créditos o transferencia). Con un solo método,
   un clic cubre todo el total. Para **pagar con varios**, elige también el segundo: aparece el
   monto de cada uno y, con dos métodos, al cambiar uno el otro se ajusta para completar el
   total. En efectivo, si escribes lo recibido, calcula el cambio.
5. **Pagar** registra la venta, descuenta el inventario y crea un movimiento "Venta" por
   producto (se ve en Historial). El ticket se cierra.

Reglas:

- **No se vende sin stock.** Lo que está en un ticket abierto queda **apartado**: si hay 3
  piezas y un ticket tiene 2, otro ticket solo puede llevar 1. Al pagar, el servidor
  vuelve a revisar el stock.
- Los tickets abiertos **viven en la computadora del mostrador** (hay un solo POS): no se
  pierden al recargar ni sin internet, pero no se ven desde otra computadora.
- Un ticket solo se puede eliminar si está vacío. Por ahora no hay cancelaciones ni
  descuentos, y no se desglosa IVA.

### Sin conexión

El mostrador funciona sin internet: se pueden abrir tickets, agregar productos (con el stock
de la copia local), asignar clientes ya descargados y cobrar. La venta se guarda en la cola
("Sin conexión: N pendientes") y se registra sola al volver la red, con el mismo id de
ticket, así que un reintento nunca la cobra dos veces. Como ya se cobró, el servidor la
acepta aunque el stock no alcance y lo anota en la venta. Dar de alta clientes sí necesita
conexión.

### Ventas (`/ventas`)

Historial de ventas cobradas con fecha, ticket, cliente, artículos, forma de pago y total.
Se filtra por fechas (por defecto, hoy) y forma de pago, con el total de ventas y la suma
por forma de pago. Al hacer clic en una venta se ven sus productos y quién cobró. Las
ventas que siguen en la cola sin conexión aparecen arriba como pendientes.

En el detalle de cada cliente, **Compras previas** muestra sus ventas con el total gastado.

Si una venta se pagó con más de un método, en la columna Pago dice **Mixto**; al abrirla se ve
cuánto se pagó con cada método. Los totales por forma de pago de arriba reparten las ventas
mixtas en sus métodos reales.

## Créditos de tienda

Cada cliente puede tener créditos (1 crédito = $1) para pagar productos en la tienda.

- **Agregar a un cliente:** en su perfil, **Agregar crédito** → monto y concepto (p. ej.
  "Premio torneo Pokémon"). Se guarda el monto, la fecha, el concepto y quién lo agregó.
- **Agregar a varios:** en **Clientes**, **Agregar créditos** → un concepto y la lista de
  clientes, cada uno con su monto (p. ej. los premios de un torneo).
- **Perfil del cliente:** saldo disponible, créditos ganados y usados (histórico) y el
  historial de movimientos. La lista de clientes muestra el saldo de cada uno.
- **Pagar con créditos:** en el Mostrador elige "Créditos". El ticket necesita un cliente;
  se muestra su saldo y no deja usar más de lo que tiene (si no alcanza, combínalo con otro
  método). Necesita conexión para leer el saldo real; los demás métodos funcionan sin red.
- Por ahora los créditos no se pueden quitar ni corregir desde la app: se registran al
  agregarlos y se descuentan al usarlos. Nada se edita ni se borra.

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
- `catalog_products` (catálogo TCG): `authenticated` solo puede **leer**. Únicamente el
  script de importación escribe, con la service_role key, que nunca está en el frontend.
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
supabase/migrations/     Migraciones SQL (esquema, RLS, RPC, storage, catálogo TCG)
scripts/                 Importador del catálogo TCG (npm run catalogo)
.github/workflows/       Importación semanal del catálogo (GitHub Actions)
src/
  lib/supabase.ts        Cliente único de Supabase + detección de errores de red/sesión
  auth/                  AuthProvider, useAuth, ProtectedRoute (listo para roles)
  store/                 Store de inventario: caché, cola offline, deshacer, sincronización
  pages/                 Login, Escaneo, Inventario, Mostrador, Ventas, Clientes, Historial, Etiqueta
  components/            Layout, formulario de producto, buscador del catálogo, webcam, imagen, foco
  lib/                   Exportación, imágenes, sonidos, normalización de códigos
netlify.toml             Build + redirección SPA
```

Pruebas manuales para el día del escaneo: [`docs/PRUEBAS_MANUALES.md`](docs/PRUEBAS_MANUALES.md).
