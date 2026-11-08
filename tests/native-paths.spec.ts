/** Windows path checks run offline with Node's win32 path implementation; no Windows filesystem is simulated. */
import * as path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

async function schemas(platform: 'win32' | 'posix') {
  vi.resetModules()
  vi.doMock('node:path', () => ({ ...path, ...path[platform], default: path[platform] }))
  const { Config, machineOf } = await import('../src/deployment.ts')
  const { ExecutorConfigSchema } = await import('../src/policy.ts')
  const { workerBin, workerGitConfig } = await import('../src/infra/environment.ts')
  return { Config, machineOf, ExecutorConfigSchema, workerBin, workerGitConfig }
}
afterEach(() => { vi.doUnmock('node:path'); vi.resetModules() })

describe('native absolute directories', () => {
  it('accepts Windows drive and UNC paths unchanged and derives files on that drive or share', async () => {
    const { Config, machineOf, ExecutorConfigSchema, workerBin, workerGitConfig } = await schemas('win32')
    for (const [directory, bin, git] of [
      ['C:\\Users\\测试用户\\.dsh\\superagent-local', 'C:\\Users\\测试用户\\.dsh\\superagent-local\\worker-bin', 'C:\\Users\\测试用户\\.dsh\\superagent-local\\worker-gitconfig'],
      ['D:/DSH Data/superagent-local', 'D:\\DSH Data\\superagent-local\\worker-bin', 'D:\\DSH Data\\superagent-local\\worker-gitconfig'],
      ['\\\\server\\share\\DSH Data', '\\\\server\\share\\DSH Data\\worker-bin', '\\\\server\\share\\DSH Data\\worker-gitconfig'],
    ]) {
      const machine = machineOf(Config({ mode: 'local', stateDir: directory }))
      expect(machine.stateDir).toBe(directory)
      expect(ExecutorConfigSchema.parse({ directory }).directory).toBe(directory)
      expect(workerBin(machine.stateDir)).toBe(bin)
      expect(workerGitConfig(machine.stateDir)).toBe(git)
    }
  })
  it('rejects Windows drive-relative and ordinary relative directories', async () => {
    const { Config, ExecutorConfigSchema } = await schemas('win32')
    for (const directory of ['C:relative', 'C:', '\\state', '/state', 'relative\\state', '.\\state', '..\\state', '~/state', 'file:///C:/state']) {
      expect(() => Config({ stateDir: directory }), directory).toThrow()
      expect(() => ExecutorConfigSchema.parse({ directory }), directory).toThrow()
    }
    expect(() => Config({ stateDir: '' })).toThrow()
    expect(ExecutorConfigSchema.parse({ directory: '' }).directory).toBe('')
  })
  it('preserves POSIX absolute paths and rejects foreign paths that would become relative on POSIX', async () => {
    const { Config, machineOf, ExecutorConfigSchema } = await schemas('posix')
    const directory = '/srv/DSH 数据/superagent-local'
    expect(machineOf(Config({ stateDir: directory })).stateDir).toBe(directory)
    expect(ExecutorConfigSchema.parse({ directory }).directory).toBe(directory)
    for (const directory of ['relative/state', '~/state', 'C:\\Users\\me\\state', 'C:/state', '\\\\server\\share\\state']) {
      expect(() => Config({ stateDir: directory }), directory).toThrow()
      expect(() => ExecutorConfigSchema.parse({ directory }), directory).toThrow()
    }
  })
})
