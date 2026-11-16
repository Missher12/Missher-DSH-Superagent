/** Exercise the actual OS launcher; Windows CI uses cmd/PATHEXT, POSIX uses the shell shim. */
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { workerBin, writeEnvironment } from '../src/infra/environment.ts'
import { testDeployment } from './fixtures/deployment.ts'

it('launches configured executables and preserves blocked commands on the current platform', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'superagent tools ')), exec = promisify(execFile)
  try {
    const deployment = testDeployment({ stateDir: directory, github: { ...testDeployment().github!, cli: process.execPath }, feishu: undefined })
    const run = (name: string, args: string[]) => process.platform === 'win32'
      ? exec(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `""${join(workerBin(directory), name)}.cmd" ${args.join(' ')}"`], { windowsVerbatimArguments: true })
      : exec(join(workerBin(directory), name), args)
    await writeEnvironment(deployment, ['blocked-cli'])
    expect((await run('gh', ['--version'])).stdout.trim()).toBe(process.version)
    await expect(run('blocked-cli', [])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('blocked in this installation') })
    await expect(run('lark-cli', [])).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining('no Feishu bot') })
    await writeEnvironment(deployment, [])
    expect((await run('gh', ['--version'])).stdout.trim()).toBe(process.version)
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 20_000)
