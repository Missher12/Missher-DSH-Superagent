import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Setup } from '../src/app/setup.ts'
import { SettingsSchema } from '../src/policy.ts'
import { testMachine } from './fixtures/deployment.ts'

describe('local desktop setup', () => {
  it('starts without GitHub credentials and leaves the desktop process environment alone', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'superagent-local-setup-'))
    const before = { ...process.env }
    const ctx = new Context()
    ctx.reflect.provide('subprocess', { spawn: () => { throw new Error('Local startup must not invoke an account CLI') } })
    const setup = new Setup({ context: ctx, machine: { ...testMachine({ stateDir: directory }), mode: 'local' } as never,
      lifetime: new AbortController().signal, restart: () => {} })
    try {
      expect(await setup.run(SettingsSchema.parse({}))).toBe(true)
      expect(setup.configured()).toBe(true)
      expect(setup.deployment.github).toBeUndefined()
      expect(setup.commandEnvironment).toEqual({})
      expect(process.env).toEqual(before)
      expect(existsSync(join(directory, 'worker-bin'))).toBe(false)
      expect(existsSync(join(directory, 'worker-gitconfig'))).toBe(false)
    } finally { setup.restore(); rmSync(directory, { recursive: true, force: true }) }
  })
})
