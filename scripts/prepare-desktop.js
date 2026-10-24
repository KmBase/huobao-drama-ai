// ============================================================
// Prepare script for the Electron desktop build.
//
// Unlike scripts/build.js (which targets Vercel + PostgreSQL), this
// keeps the app fully on local SQLite:
//   1. Switch Prisma schema to SQLite mode + generate client
//   2. Generate the SQLite DDL used for first-run DB init
//      (electron/main.js executes it on an empty userData database)
//   3. `next build` with standalone output
//   4. Copy static assets + Prisma query engine into the standalone
//      bundle (Next's file tracing does not always include the engine)
// ============================================================

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')

function run(cmd, opts = {}) {
  console.log(`[desktop] > ${cmd}`)
  execSync(cmd, { stdio: 'inherit', cwd: root, timeout: opts.timeout || 600000 })
}

function main() {
  // Step 1: SQLite schema + Prisma client (reuses the local-dev switcher)
  run('node scripts/pre-dev.js')

  // Step 2: Generate SQLite DDL from the schema for first-run init
  console.log('[desktop] Generating SQLite init SQL...')
  const sql = execSync(
    'npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script',
    { cwd: root, encoding: 'utf8', timeout: 120000 }
  )
  const sqlPath = path.join(root, 'electron', 'sqlite-init.sql')
  fs.mkdirSync(path.dirname(sqlPath), { recursive: true })
  fs.writeFileSync(sqlPath, sql)
  console.log(`[desktop] SQLite init SQL written to ${path.relative(root, sqlPath)} (${sql.length} bytes)`)

  // Step 3: Next.js standalone build (NOT scripts/build.js — that targets PostgreSQL).
  // NEXT_PUBLIC_HUOBAO_DESKTOP switches next-intl to localePrefix 'always'
  // (see src/i18n/routing.ts — 'as-needed' loops on the standalone runtime).
  const buildEnv = { ...process.env, NEXT_PUBLIC_HUOBAO_DESKTOP: '1' }
  console.log('[desktop] > npx next build')
  execSync('npx next build', {
    stdio: 'inherit',
    cwd: root,
    env: buildEnv,
    timeout: 900000,
  })

  const standaloneDir = path.join(root, '.next', 'standalone')
  if (!fs.existsSync(path.join(standaloneDir, 'server.js'))) {
    throw new Error('Standalone output missing — expected .next/standalone/server.js')
  }

  // Step 4: Copy static assets into the standalone bundle
  console.log('[desktop] Copying static assets into standalone bundle...')
  fs.cpSync(path.join(root, '.next', 'static'), path.join(standaloneDir, '.next', 'static'), { recursive: true })
  if (fs.existsSync(path.join(root, 'public'))) {
    fs.cpSync(path.join(root, 'public'), path.join(standaloneDir, 'public'), { recursive: true })
  }

  // Step 5: Ensure the Prisma query engine ships with the standalone bundle
  const prismaClientSrc = path.join(root, 'node_modules', '.prisma', 'client')
  const prismaClientDest = path.join(standaloneDir, 'node_modules', '.prisma', 'client')
  if (fs.existsSync(prismaClientSrc)) {
    console.log('[desktop] Copying Prisma client + query engine into standalone bundle...')
    fs.cpSync(prismaClientSrc, prismaClientDest, { recursive: true, force: true })
  }

  // Step 6: Stage a verbatim copy for electron-builder. extraResources with a
  // dot-directory source (".next/standalone") gets dot-dir/node_modules filtered,
  // and electron-builder hard-excludes any "node_modules" dir from extraResources,
  // so ship the deps under a different name — electron/main.js junction-links it
  // back to node_modules on first launch (Windows junctions need no admin rights).
  const payloadDir = path.join(root, 'desktop-payload', 'standalone')
  console.log('[desktop] Staging desktop-payload/standalone...')
  fs.rmSync(path.join(root, 'desktop-payload'), { recursive: true, force: true })
  fs.cpSync(standaloneDir, payloadDir, { recursive: true })
  fs.renameSync(
    path.join(payloadDir, 'node_modules'),
    path.join(payloadDir, 'runtime-modules')
  )

  console.log('[desktop] Desktop build ready: .next/standalone/server.js')
}

try {
  main()
} catch (err) {
  console.error('[desktop] FAILED:', err.message || err)
  process.exit(1)
}
