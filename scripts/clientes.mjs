#!/usr/bin/env node
/*
 * Administra a los clientes del sistema. Cada cliente tiene su propio
 * proyecto de Supabase (su propia base, usuarios e imágenes) y todos corren
 * el mismo código y las mismas migraciones.
 *
 * Uso (npm run clientes -- <comando> …):
 *   estado                       Migraciones aplicadas y pendientes de cada cliente.
 *   migrar [--prueba]            Aplica las migraciones pendientes (en orden, cada una
 *                                en su propia transacción). --prueba solo las lista.
 *   funciones                    Despliega las Edge Functions (crear-usuario).
 *   alta --ref <id> --negocio "Nombre" --prefijo ABC
 *        --admin-correo a@b.mx --admin-nombre "Nombre"
 *                                Prepara un proyecto NUEVO: cierra el registro público,
 *                                corre las migraciones, guarda el nombre y el prefijo,
 *                                despliega la función, crea el primer admin e imprime
 *                                las variables para Netlify.
 *   catalogo [-- --juegos …]     Importa el catálogo TCG en cada cliente
 *                                (pasa los argumentos a importar-catalogo.mjs).
 *
 * --ref <id> limita cualquier comando a un solo proyecto.
 *
 * Variables de entorno (en .env.clientes o en los secrets de GitHub Actions):
 *   SUPABASE_ACCESS_TOKEN  Token personal de Supabase (Account → Access Tokens).
 *                          Da acceso a TODOS tus proyectos: nunca en el frontend.
 *   CLIENTES               IDs de proyecto (project ref) separados por coma.
 */

import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations')
const FUNCTIONS = ['crear-usuario']
const API = 'https://api.supabase.com/v1'

// ---------- argumentos ----------
function parseArgs(argv) {
  const sep = argv.indexOf('--')
  const own = sep === -1 ? argv : argv.slice(0, sep)
  const passthrough = sep === -1 ? [] : argv.slice(sep + 1)
  const [command, ...rest] = own
  const opts = {}
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (!a.startsWith('--')) throw new Error(`Argumento inesperado: ${a}`)
    const [k, inline] = a.slice(2).split(/=(.*)/s)
    if (inline !== undefined) opts[k] = inline
    else if (rest[i + 1] && !rest[i + 1].startsWith('--')) opts[k] = rest[++i]
    else opts[k] = true
  }
  return { command, opts, passthrough }
}

// ---------- Management API de Supabase ----------
function token() {
  const t = process.env.SUPABASE_ACCESS_TOKEN
  if (!t) {
    throw new Error(
      'Falta SUPABASE_ACCESS_TOKEN. Créalo en https://supabase.com/dashboard/account/tokens ' +
        'y ponlo en .env.clientes (copia .env.clientes.example).',
    )
  }
  return t
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || text || res.statusText
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`)
  }
  return data
}

/** Corre SQL en el proyecto (como postgres). Devuelve las filas del último SELECT. */
const sql = (ref, query, readOnly = false) =>
  api('POST', `/projects/${ref}/database/query`, { query, read_only: readOnly })

/** Literal de texto para SQL. */
const lit = (s) => `'${String(s).replaceAll("'", "''")}'`

async function apiKeys(ref) {
  const keys = await api('GET', `/projects/${ref}/api-keys?reveal=true`)
  const anon = keys.find((k) => k.name === 'anon')?.api_key ?? keys.find((k) => k.type === 'publishable')?.api_key
  const service =
    keys.find((k) => k.name === 'service_role')?.api_key ?? keys.find((k) => k.type === 'secret')?.api_key
  if (!anon || !service) throw new Error(`No encontré las llaves anon / service_role del proyecto ${ref}`)
  return { anon, service }
}

// ---------- clientes ----------
function clientRefs(opts) {
  if (typeof opts.ref === 'string') return [opts.ref]
  const refs = (process.env.CLIENTES ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!refs.length) {
    throw new Error('No hay clientes: pon sus IDs de proyecto en CLIENTES (separados por coma) o usa --ref <id>.')
  }
  return refs
}

async function projectInfo(ref) {
  const p = await api('GET', `/projects/${ref}`)
  return { ref, name: p.name, status: p.status, region: p.region }
}

// ---------- migraciones ----------
// Mismo registro que usa `supabase db push` (supabase_migrations.schema_migrations),
// así el CLI y este script ven lo mismo.
export function localMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((file) => {
      const [, version, name] = file.match(/^(\d+)_(.+)\.sql$/)
      return { file, version, name, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8') }
    })
}

async function appliedVersions(ref) {
  const rows = await sql(
    ref,
    `select coalesce(array_agg(version order by version), '{}') as versions
     from supabase_migrations.schema_migrations
     where to_regclass('supabase_migrations.schema_migrations') is not null`,
    true,
  ).catch((e) => {
    // Proyecto recién creado: la tabla aún no existe.
    if (/schema_migrations/.test(e.message)) return [{ versions: [] }]
    throw e
  })
  return new Set(rows[0]?.versions ?? [])
}

async function pendingMigrations(ref) {
  const applied = await appliedVersions(ref)
  const local = localMigrations()
  const localVersions = new Set(local.map((m) => m.version))
  // Aplicadas en la base pero que no están en este código (otra rama sin mergear).
  const unknown = [...applied].filter((v) => !localVersions.has(v))
  return { pending: local.filter((m) => !applied.has(m.version)), unknown, applied }
}

/** La migración y su registro, en una transacción: si falla, no queda a medias ni registrada. */
export function migrationQuery(m) {
  return `begin;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text
);
${m.sql}
;
insert into supabase_migrations.schema_migrations (version, statements, name)
values (${lit(m.version)}, array[${lit(m.sql)}], ${lit(m.name)});
commit;`
}

async function migrate(ref, { dryRun = false } = {}) {
  const { pending, unknown } = await pendingMigrations(ref)
  if (unknown.length) {
    throw new Error(
      `${ref} tiene migraciones que no están en este código (${unknown.join(', ')}). ` +
        'Actualiza tu copia del repositorio antes de migrar.',
    )
  }
  if (!pending.length) {
    console.log(`  ${ref}: al día`)
    return 0
  }
  for (const m of pending) {
    if (dryRun) {
      console.log(`  ${ref}: pendiente ${m.file}`)
      continue
    }
    process.stdout.write(`  ${ref}: ${m.file} … `)
    await sql(ref, migrationQuery(m)).catch((e) => {
      console.log('falló')
      throw e
    })
    console.log('ok')
  }
  return pending.length
}

// ---------- Edge Functions ----------
function deployFunctions(ref) {
  for (const fn of FUNCTIONS) {
    console.log(`  ${ref}: desplegando ${fn} …`)
    const r = spawnSync(
      'npx',
      ['--yes', 'supabase@latest', 'functions', 'deploy', fn, '--project-ref', ref, '--use-api'],
      { cwd: ROOT, stdio: 'inherit', env: process.env },
    )
    if (r.status !== 0) {
      throw new Error(
        `No se pudo desplegar ${fn} en ${ref}. Puedes hacerlo a mano: ` +
          `npx supabase functions deploy ${fn} --project-ref ${ref}`,
      )
    }
  }
}

// ---------- comandos ----------
async function cmdEstado(opts) {
  const local = localMigrations()
  console.log(`Migraciones en el código: ${local.length} (última ${local.at(-1)?.file})\n`)
  for (const ref of clientRefs(opts)) {
    try {
      const info = await projectInfo(ref)
      const { pending, unknown } = await pendingMigrations(ref)
      const settings = await sql(
        ref,
        `select business_name, internal_code_prefix from public.app_settings
         where to_regclass('public.app_settings') is not null`,
        true,
      ).catch(() => [])
      const negocio = settings[0] ? `${settings[0].business_name} (${settings[0].internal_code_prefix}-)` : '—'
      console.log(`${ref} · ${info.name} · ${info.status} · negocio: ${negocio}`)
      if (pending.length) console.log(`  pendientes: ${pending.map((m) => m.file).join(', ')}`)
      else console.log('  migraciones al día')
      if (unknown.length) console.log(`  ⚠️ aplicadas que no están en este código: ${unknown.join(', ')}`)
    } catch (e) {
      console.log(`${ref} · ERROR: ${e.message}`)
      process.exitCode = 1
    }
  }
}

async function cmdMigrar(opts) {
  const dryRun = Boolean(opts.prueba)
  let failed = 0
  for (const ref of clientRefs(opts)) {
    try {
      await migrate(ref, { dryRun })
    } catch (e) {
      // Un cliente con error no detiene a los demás.
      console.error(`  ${ref}: ERROR → ${e.message}`)
      failed++
    }
  }
  if (failed) {
    console.error(`\n${failed} cliente(s) con error.`)
    process.exitCode = 1
  }
}

async function cmdFunciones(opts) {
  for (const ref of clientRefs(opts)) deployFunctions(ref)
}

async function cmdAlta(opts) {
  const ref = opts.ref
  const negocio = typeof opts.negocio === 'string' ? opts.negocio.trim() : ''
  const prefijo = typeof opts.prefijo === 'string' ? opts.prefijo.trim().toUpperCase() : ''
  const correo = typeof opts['admin-correo'] === 'string' ? opts['admin-correo'].trim().toLowerCase() : ''
  const nombre = typeof opts['admin-nombre'] === 'string' ? opts['admin-nombre'].trim() : ''
  if (typeof ref !== 'string' || !negocio || !prefijo || !correo || !nombre) {
    throw new Error(
      'Uso: npm run clientes -- alta --ref <id> --negocio "Nombre" --prefijo ABC ' +
        '--admin-correo a@b.mx --admin-nombre "Nombre"',
    )
  }
  if (!/^[A-Z]{2,5}$/.test(prefijo)) throw new Error('El prefijo debe ser de 2 a 5 letras (A-Z), p. ej. DRG.')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw new Error('El correo del admin no parece válido.')

  const info = await projectInfo(ref)
  console.log(`Proyecto ${ref} · ${info.name} · ${info.region} · ${info.status}`)
  if (info.status !== 'ACTIVE_HEALTHY') throw new Error('El proyecto todavía no está listo (espera a que diga ACTIVE_HEALTHY).')

  console.log('\n1. Cerrando el registro público (solo un admin crea usuarios)')
  await api('PATCH', `/projects/${ref}/config/auth`, { disable_signup: true })

  console.log('\n2. Migraciones')
  await migrate(ref)

  console.log('\n3. Nombre y prefijo del negocio')
  await sql(
    ref,
    `update public.app_settings set business_name = ${lit(negocio)}, internal_code_prefix = ${lit(prefijo)} where id`,
  )
  console.log(`  ${negocio} · códigos internos ${prefijo}-000001`)

  console.log('\n4. Edge Functions')
  deployFunctions(ref)

  console.log('\n5. Primer administrador')
  const { anon, service } = await apiKeys(ref)
  const url = `https://${ref}.supabase.co`
  const password = randomBytes(9).toString('base64url')
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: correo, password, email_confirm: true, user_metadata: { full_name: nombre } }),
  })
  let created = true
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    if (res.status === 422 && /exist|registered/i.test(JSON.stringify(body))) {
      created = false
      console.log(`  ${correo} ya existía: se deja su contraseña y se le da rol admin`)
    } else {
      throw new Error(`No se pudo crear el admin: ${res.status} ${JSON.stringify(body)}`)
    }
  }
  await sql(
    ref,
    `update public.profiles set role = 'admin', full_name = ${lit(nombre)} where lower(email) = ${lit(correo)}`,
  )

  console.log(`
Listo. Falta publicar la app para este cliente:

  Netlify → Add new site → Import from Git → este repositorio (rama main),
  y en Site configuration → Environment variables:

    VITE_SUPABASE_URL=${url}
    VITE_SUPABASE_ANON_KEY=${anon}
    VITE_BUSINESS_NAME=${negocio}

  Agrega ${ref} a CLIENTES (en .env.clientes y en GitHub → Settings → Secrets
  and variables → Actions → Variables) para que reciba las actualizaciones.
${created ? `\nAcceso del admin (pídele que la cambie):\n  ${correo}\n  ${password}\n` : ''}`)
}

async function cmdCatalogo(opts, passthrough) {
  let failed = 0
  for (const ref of clientRefs(opts)) {
    console.log(`\n=== ${ref}`)
    const { service } = await apiKeys(ref)
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'importar-catalogo.mjs'), ...passthrough], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: service },
    })
    if (r.status !== 0) failed++
  }
  if (failed) process.exitCode = 1
}

const COMMANDS = {
  estado: cmdEstado,
  migrar: cmdMigrar,
  funciones: cmdFunciones,
  alta: cmdAlta,
  catalogo: cmdCatalogo,
}

async function main() {
  const { command, opts, passthrough } = parseArgs(process.argv.slice(2))
  const run = COMMANDS[command]
  if (!run) {
    console.log(`Comandos: ${Object.keys(COMMANDS).join(', ')} (ver el encabezado de scripts/clientes.mjs)`)
    process.exit(command ? 1 : 0)
  }
  await run(opts, passthrough)
}

// Solo corre como comando (las pruebas importan migrationQuery).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`\nError: ${e.message}`)
    process.exit(1)
  })
}
