/** Host-independent graph validation; the client must not import runtime policy schemas. */
import type { TeamMember } from './contracts.ts'
export function planIssues(members: TeamMember[]): { path: (string | number)[]; message: string }[] {
  const issues: { path: (string | number)[]; message: string }[] = []
  const ids = new Set(members.map(member => member.id))
  if (ids.size !== members.length) issues.push({ path: ['members'], message: '成员标识不能重复' })
  const done = new Set<string>()
  for (let pass = 0; pass < members.length; pass++) for (const member of members) {
    if (member.dependencies.every(id => done.has(id))) done.add(member.id)
  }
  members.forEach((member, index) => {
    if (new Set(member.dependencies).size !== member.dependencies.length || member.dependencies.some(id => !ids.has(id) || id === member.id)) {
      issues.push({ path: ['members', index, 'dependencies'], message: '请选择其他已存在的成员，且不要重复' })
    }
    const seen = new Set([member.id])
    let parent = member.parentId ?? 'coordinator'
    while (parent !== 'coordinator') {
      const owner = members.find(member => member.id === parent)
      if (!owner || seen.has(parent) || owner.responsibility !== 'manager') {
        issues.push({ path: ['members', index, 'parentId'], message: '上级必须是已有管理成员，上下级不能形成循环' }); break
      }
      seen.add(parent); parent = owner.parentId ?? 'coordinator'
    }
  })
  if (done.size !== ids.size) issues.push({ path: ['members'], message: '成员交付依赖不能形成循环' })
  return issues
}
