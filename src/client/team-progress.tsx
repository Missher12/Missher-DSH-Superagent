import type { TeamView } from '../teams/contracts.ts'
import { usePanel } from './provider.tsx'
import { Icon } from './controls.tsx'
import type { WorkbenchTool } from './route.ts'
import { teamFeedback } from './team-participants.ts'

const steps = ['studioBrief', 'studioAssign', 'studioBuild', 'studioReview', 'studioTry'] as const
const stage = { draft: 0, briefing: 0, creating: 1, planning: 1, working: 2, reviewing: 3, integrating: 3, reporting: 4, completed: 4 }

const settings = [
  { id: 'mcp', label: 'mcpTitle', icon: 'session' },
  { id: 'execution', label: 'studioExecutorSettings', icon: 'settings' },
] as const

export function TeamProgress({ team, tool, open }: { team: TeamView; tool?: WorkbenchTool; open: (tool: WorkbenchTool) => void }) {
  const { t } = usePanel()
  const feedback = teamFeedback(team), phase = team.phase
  const reviewing = team.members.some(member => member.responsibility === 'reviewer' && member.running)
  const current = phase ? (phase === 'working' && reviewing && !team.members.some(member => member.responsibility === 'implementer' && member.running) ? 3 : stage[phase]) : undefined
  const issue = team.workflow?.halted || team.error || team.members.find(member => member.attention)?.attention
  return <aside className="dt-progress-rail" aria-label={t('studioProgress')}>
    <header><strong>{t('studioProgress')}</strong>{current !== undefined && <small>{current + 1} / 5</small>}</header>
    <ol>{steps.map((step, index) => {
      const done = current !== undefined && (index < current || phase === 'completed')
      const active = index === current && !done
      const status = done ? 'teamPhase.completed' : !active ? (current === undefined ? 'studioProgressUnknown' : 'studioPending')
        : team.state === 'stopped' ? 'teamStateStopped' : team.state === 'failed' ? 'teamStateFailed'
        : issue ? 'studioAttention' : feedback?.revising ? 'teamRework' : team.state === 'waiting' ? 'teamStateWaiting'
        : team.state === 'draft' ? 'teamStateDraft' : 'teamStateWorking'
      return <li key={step} data-done={done || undefined} aria-current={active ? 'step' : undefined}>
        <span className="dt-stage-marker">{done && <Icon name="decision" size={10} />}</span><span className="dt-stage-copy"><strong>{t(step)}</strong><small>{t(status)}</small></span>
      </li>
    })}</ol>
    {!phase && <p>{t('studioProgressUnknown')}</p>}
    {(issue || feedback) && <section role="status"><strong>{t(issue ? 'studioAttention' : 'teamRework')}</strong><p>{issue || feedback?.reason}</p></section>}
    <details className="dt-rail-settings" open>
      <summary><span>{t('tab.settings')}</span><Icon name="chevron-down" size={13} /></summary>
      {settings.map(item => <button key={item.id} type="button" aria-controls="dt-team-right" aria-current={tool === item.id ? 'page' : undefined} onClick={() => open(item.id)}>
        <Icon name={item.icon} size={14} /><span>{t(item.label)}</span>
      </button>)}
    </details>
    <button type="button" className="dt-rail-records" aria-controls="dt-team-right" aria-current={tool === 'records' ? 'page' : undefined} onClick={() => open('records')}><Icon name="history" size={13} />{t('teamRecords')}</button>
  </aside>
}
