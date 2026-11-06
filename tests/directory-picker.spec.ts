import { expect, it, vi } from 'vitest'
import { pickWorkspaceDirectory } from '../src/navigation.ts'

it('uses the Desktop bridge without starting a second Host-native dialog', async () => {
  const hostPick = vi.fn(async (): Promise<string | null> => { throw new Error('Host dialog unavailable') })
  const desktop = { pick: vi.fn(async (): Promise<string | null> => '/tmp/project') }
  expect(await pickWorkspaceDirectory(hostPick, { __DSH_DIRECTORY_PICKER__: desktop })).toBe('/tmp/project')
  expect(hostPick).not.toHaveBeenCalled()
  desktop.pick.mockResolvedValueOnce(null)
  expect(await pickWorkspaceDirectory(hostPick, { __DSH_DIRECTORY_PICKER__: desktop })).toBeNull()
  expect(hostPick).not.toHaveBeenCalled()
})

it('keeps the Host picker available in a web client without the Desktop bridge', async () => {
  const hostPick = vi.fn(async () => '/tmp/web-project')
  expect(await pickWorkspaceDirectory(hostPick, {})).toBe('/tmp/web-project')
})
