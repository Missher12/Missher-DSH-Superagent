/** Real model acceptance: dispatch, concurrent worktrees, integrated products and commander reply. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export async function verifyNativeTeam(admin, temporary, modelId) {
  const directory = join(temporary, 'superagent-native-project')
  mkdirSync(directory)
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Superagent acceptance', '-c', 'user.email=acceptance@localhost',
    '-c', 'commit.gpgsign=false', '-C', directory, ...args], { encoding: 'utf8' }).trim()
  git('init', '-q'); writeFileSync(join(directory, 'README.md'), '# Native platform acceptance\n')
  git('add', 'README.md'); git('commit', '-qm', 'Initialize acceptance project')
  const initial = git('rev-parse', 'HEAD')
  const { blocks: { executor } } = await admin('settings')
  await admin('settings/executor', 'PUT', { revision: executor.revision, value: { ...executor.value, maxWorkers: 3 } })
  const team = await admin('local/teams', 'POST', {
    requestId: `native-${process.platform}-${Date.now()}`, name: '跨平台并行交付', title: '真实宿主并行与总指挥验收',
    directory, permissionPreset: 'workspace-write', model: { provider: 'qwen-token-plan', model: modelId, reasoningEffort: 'high' },
    coordinatorName: '策划', workflow: { maxRounds: 2, workspace: 'worktree' },
    instructions: `策划先核对分工，让文本和数值成员同时开发，各自使用独立 Git 工作区。检验收到两组代码后独立实跑测试；策划最后再次实跑并写 USAGE.md，交给总指挥报告全部5个成品和真实检查结果。原项目 README.md 保持不变。禁止子代理、安装依赖、网络访问、推送或部署。宿主系统 ${process.platform}；Node 可执行文件 ${process.execPath}，命令使用适合当前系统的引号。最终回复使用中文自然语言。`,
    members: [
      { id: 'text', name: '文本', parentId: 'coordinator', responsibility: 'implementer', dependencies: [],
        instructions: '只交付 label.mjs 与 label.test.mjs。导出 normalizeLabel(value)：只接受字符串，trim 后连续空白合并为一个空格，保留大小写与中文；非字符串抛 TypeError。用 node:test 覆盖空字符串、英文、中文、连续空白和非法类型。实际运行自己的测试。' },
      { id: 'numbers', name: '数值', parentId: 'coordinator', responsibility: 'implementer', dependencies: [],
        instructions: '只交付 sum.mjs 与 sum.test.mjs。导出 sum(values)：有限数字数组求和，空数组返回0；非法参数、NaN、Infinity抛TypeError，不修改输入。用 node:test 覆盖全部情况，实际运行自己的测试。' },
      { id: 'check', name: '检验', parentId: 'coordinator', responsibility: 'reviewer', dependencies: ['text', 'numbers'],
        instructions: '独立读取两组成品，实际运行 node --test label.test.mjs sum.test.mjs，检查与要求一致；失败报告给策划返工，通过则提交真实检查与4个文件。' },
    ],
  })
  let current = team, concurrent = false
  try {
    for (let attempt = 0; attempt < 480; attempt++) {
      current = await admin(`local/teams/${team.id}`)
      const implementers = current.members.filter(member => ['text', 'numbers'].includes(member.id))
      concurrent ||= implementers.length === 2 && implementers.every(member => member.running)
      if (current.state === 'completed') break
      if (['failed', 'attention', 'stopped'].includes(current.state)) {
        const reasons = current.members.filter(member => member.attention).map(member => `${member.name}: ${member.attention}`)
        throw new Error(`Team ${current.state}: ${current.error ?? reasons.join('; ')}`)
      }
      if (attempt % 12 === 0) console.log(JSON.stringify({ platform: process.platform, team: team.id, state: current.state,
        concurrent, members: current.members.map(({ id, state, running }) => ({ id, state, running })) }))
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
    assert.equal(current.state, 'completed', 'Team completes within 16 minutes')
    assert.equal(concurrent, true, 'Two real model workers overlap')
    assert.equal(current.completion.commander, true)
    assert.equal(current.summary, current.commander.summary)
    assert.notEqual(current.commander.sessionId, current.members.find(member => member.id === 'coordinator')?.sessionId)
    const products = current.finalDelivery.artifacts
    assert.equal(products.length, 5)
    assert.equal(new Set(current.members.map(member => member.directory)).size, 4)
    const tested = execFileSync(process.execPath, ['--test', 'label.test.mjs', 'sum.test.mjs'], { cwd: current.directory, encoding: 'utf8', timeout: 30_000 })
    assert.match(tested, /# fail 0/)
    for (const file of products) {
      assert.equal(file.exists, true)
      const content = await admin(`local/teams/${team.id}/download?path=${encodeURIComponent(file.path)}`, 'GET', undefined, true)
      assert.ok(content.equals(readFileSync(file.path)), 'Reported product can be downloaded')
    }
    assert.equal(git('rev-parse', 'HEAD'), initial)
    assert.equal(git('status', '--porcelain'), '')
    return { id: team.id, model: modelId, effort: 'high', concurrent, products: products.length,
      commander: current.commander.sessionId, checks: current.completion.checks, sourceUnchanged: true }
  } finally {
    if (current.state !== 'completed') await admin(`local/teams/${team.id}/stop`, 'POST', {}).catch(() => {})
  }
}
