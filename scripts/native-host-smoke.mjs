/** Install a released plugin into a fresh, real DSH Web host on the runner.
 * The default keyless check does not claim model execution or Desktop GUI acceptance.
 * No developer profile, credentials, sessions, or workspace is copied to CI.
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { verifyNativeTeam } from './native-host-team.mjs'

assert.ok(process.env.RUNNER_TEMP, 'Run in an isolated CI runner')
const temporary = resolve(process.env.RUNNER_TEMP)
const home = join(temporary, 'dsh-native-home')
assert.ok(!existsSync(home), 'Refusing to reuse a DSH home')
mkdirSync(home)
const version = process.env.SUPERAGENT_TEST_VERSION
assert.match(version ?? '', /^\d+\.\d+\.\d+$/)
const cli = join(temporary, 'dsh-native-cli/node_modules/@deepseek-ai/dsh/lib/bin.js')
const archive = join(temporary, `missher-dsh-superagent-${version}.tgz`)
const environment = { ...process.env, DSH_HOME: home, DSH_AGENTS_HOME: join(temporary, 'dsh-native-agents'), DSH_TELEMETRY_DISABLED: '1' }
const modelConfig = process.env.DSH_TEST_MODEL_CONFIG ? JSON.parse(process.env.DSH_TEST_MODEL_CONFIG) : undefined
if (process.env.DSH_TEST_MODEL_REQUIRED === 'true') assert.ok(modelConfig && process.env.DSH_TEST_MODEL_KEY, 'Dedicated model test credentials are required')
const result = { os: process.platform, arch: process.arch, dsh: process.env.DSH_TEST_VERSION, plugin: version,
  installation: false, runtime: false, management: false, modelExecution: 'not-run: no model credential supplied', surface: 'DSH Web host' }
let host, output = ''
try {
  const download = await fetch(`https://github.com/Missher12/Missher-DSH-Superagent/releases/download/v${version}/missher-dsh-superagent-${version}.tgz`)
  assert.equal(download.status, 200, 'Release package download')
  writeFileSync(archive, Buffer.from(await download.arrayBuffer()))
  execFileSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', archive], {
    env: environment, stdio: 'inherit', timeout: 600_000,
  })
  const installed = join(home, 'profiles/web/node_modules/@missher/dsh-superagent/package.json')
  assert.equal(JSON.parse(readFileSync(installed)).version, version)
  result.installation = true
  if (modelConfig) {
    assert.ok(process.env.DSH_TEST_MODEL_KEY && modelConfig.models?.[0]?.id && modelConfig.baseURL)
    assert.equal(new URL(modelConfig.baseURL).protocol, 'https:')
    const route = { ...modelConfig, apiKeyEnv: 'DSH_TEST_MODEL_KEY' }
    delete route.apiKey
    appendFileSync(join(home, 'profiles/web/cordis.patch.yml'), `\n- id: llm-pi-ai\n  config: ${JSON.stringify({ providers: { 'qwen-token-plan': route } })}\n`)
  }
  host = spawn(process.execPath, [cli, 'web', '--no-open', '--host', '127.0.0.1', '--port', '3080'], {
    env: environment, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  const collect = chunk => { output = (output + chunk).slice(-30_000) }
  host.stdout.on('data', collect); host.stderr.on('data', collect)
  host.on('error', error => { output += '\n' + error.message })
  const base = 'http://127.0.0.1:3080'
  function cookie() {
    const yaml = readFileSync(join(home, '.credentials.yaml'), 'utf8')
    const section = yaml.match(/^  client-connection\/browser-session:\s*\n((?:[ \t]{4}[^\n]*\n|\s*\n)+)/m)?.[1]
    const encoded = section?.match(/^      secret: ["']?([\w-]+)["']?\s*$/m)?.[1]
    assert.ok(encoded, 'Fresh host browser credential is available')
    const secret = Buffer.from(encoded, 'base64url'), authority = new URL(base).host
    assert.equal(secret.length, 32)
    const issuedAt = Date.now() - 1000
    const body = Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt: issuedAt + 300_000 })).toString('base64url')
    return `dsh-auth-${createHash('sha256').update(authority).digest('base64url')}=v1.${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
  }
  async function admin(path, method = 'GET', body, bytes = false) {
    const response = await fetch(`${base}/orchestrator/api/${path}`, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { cookie: cookie(), 'x-orchestrator-request': '1', 'content-type': 'application/json' }, signal: AbortSignal.timeout(20_000),
    })
    assert.equal(response.status, 200, `Management API ${path}`)
    return bytes ? Buffer.from(await response.arrayBuffer()) : response.json()
  }
  let state, lastError
  for (let attempt = 0; attempt < 90; attempt++) {
    if (host.exitCode !== null) throw new Error(`DSH exited (${host.exitCode})`)
    try { state = await admin('state'); if (state.health?.runtime?.state === 'ready') break }
    catch (error) { lastError = error }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.equal(state?.health?.runtime?.state, 'ready', lastError?.message)
  result.runtime = true
  const bench = await admin('local/workbench')
  assert.ok(Array.isArray(bench.teams) && Array.isArray(bench.members))
  result.management = true
  if (modelConfig) {
    result.modelExecution = 'running'
    result.team = await verifyNativeTeam(admin, temporary, modelConfig.models[0].id)
    result.modelExecution = 'passed'
  }
  console.log(JSON.stringify(result))
} catch (error) {
  result.error = error.message
  // Only this fresh, credential-free profile's logs; never upload its credential file.
  if (!modelConfig) console.error(output.replace(/https?:\/\/[^\s]+(?:token|secret|auth)[^\s]*/gi, '[login URL omitted]'))
  throw error
} finally {
  writeFileSync('native-host-result.json', JSON.stringify(result, null, 2) + '\n')
  if (host?.pid && host.exitCode === null) {
    if (process.platform === 'win32') {
      try { execFileSync('taskkill', ['/pid', String(host.pid), '/T', '/F'], { stdio: 'ignore' }) } catch {}
    } else host.kill('SIGTERM')
  }
}
