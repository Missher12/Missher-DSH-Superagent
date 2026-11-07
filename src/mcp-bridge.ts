/** Executable stdio entry. Stdout is reserved for the MCP protocol. */
import { isAbsolute } from 'node:path'
import { startStdioBridge } from './mcp/bridge.ts'

const args = process.argv.slice(2), token = process.env.DSH_SUPERAGENT_TOKEN
const stateDir = args.length === 2 && args[0] === '--state-dir' ? args[1] : undefined
if (!stateDir || !isAbsolute(stateDir) || !token || !/^dshsa_[a-f0-9-]{36}_[a-f0-9]{64}$/.test(token)) {
  process.stderr.write('Superagent MCP: 请使用 DSH 设置页生成的连接配置。\n')
  process.exitCode = 1
} else startStdioBridge(stateDir, token)
