/** Native directory validation and packaged asset paths from either source or compiled lib/ output. */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, parse, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Match DSH workspace semantics: Windows roots must include a drive or UNC share, never the current drive. */
export function absoluteDirectory(path: string): boolean {
  const root = parse(path).root
  return isAbsolute(path) && (sep !== '\\' || root !== '\\' && root !== '/')
}

let cached: string | undefined
export function packageRoot(): string {
  if (cached) return cached
  let directory = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < 6; depth++) {
    const manifest = join(directory, 'package.json')
    if (existsSync(manifest)) {
      try { if ((JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === '@missher/dsh-superagent') return cached = directory }
      catch { /* A foreign package.json on the way up is not this package. */ }
    }
    directory = dirname(directory)
  }
  throw new Error('dsh-superagent package root not found')
}
export const packagePath = (...parts: string[]): string => join(packageRoot(), ...parts)
