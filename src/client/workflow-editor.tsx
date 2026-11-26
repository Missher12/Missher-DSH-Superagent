/** Editable organization and delivery graphs, shared by setup and live team editing. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import type { TeamMember, TeamView } from '../teams/contracts.ts'
import { planIssues } from '../teams/plan.ts'
import type { RoleModel } from '../policy.ts'
import { Button, Icon, Input, Modal, SegmentedControl } from './controls.tsx'
import { ComposerField, ComposerForm } from './composer.tsx'
import { ModelSelect, ReasoningSelect } from './model-picker.tsx'
import { ActionMenu, Select } from './select.tsx'
import { useAction, usePanel } from './provider.tsx'
import { errorText } from './text.ts'
import { SessionButton } from './widgets.tsx'
import { MemberPlacementFields, type MemberPlacement } from './team-members-editor.tsx'
import { COMMANDER } from './team-participants.ts'

import { fitWorkflowCards, orthogonalRoute, restoreWorkflowLayout, type Point } from './workflow-routing.ts'
type Layout = Record<string, Point>
type Relation = 'parent' | 'delivery'
type Edge = { id: string; from: string; to: string; path: string; midpoint: Point }
type AddMode = 'after' | 'parallel' | 'insert' | 'child'
type Role = NonNullable<TeamMember['responsibility']>
type View = { relation: Relation; layouts: Partial<Record<Relation, Layout>>; zoom: number; panelWidth: number; details: boolean }
type Draft = { members: TeamMember[]; revision: number }
const viewKey = (id: string) => `dsh-superagent/workflow-view/${id}`
/** Keep the setup canvas when its draft becomes a real team. */
export function transferWorkflowView(from: string, to: string) {
  try { const saved = localStorage.getItem(viewKey(from)); if (saved) { localStorage.setItem(viewKey(to), saved); localStorage.removeItem(viewKey(from)) } } catch { /* Optional local view preferences. */ }
}
const bounded = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback
function readView(key: string): View | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null'); if (!saved) return
    const layouts: View['layouts'] = {}
    for (const relation of ['delivery', 'parent'] as const) if (saved.layouts?.[relation] && typeof saved.layouts[relation] === 'object') {
      layouts[relation] = Object.fromEntries(Object.entries(saved.layouts[relation]).slice(0, 14).flatMap(([id, point]) => {
        const p = point as Point | null
        return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? [[id, { x: bounded(p.x, 24, 10000, 36), y: bounded(p.y, 24, 10000, 40) }]] : []
      }))
    }
    return { relation: saved.relation === 'parent' ? 'parent' : 'delivery', layouts, zoom: bounded(saved.zoom, .6, 1.4, .85), panelWidth: bounded(saved.panelWidth, 280, 480, 380), details: saved.details !== false }
  } catch { return }
}
function readDraft(key: string): Draft | undefined {
  try {
    const draft = JSON.parse(sessionStorage.getItem(key) ?? 'null')
    if (draft && Number.isInteger(draft.revision) && draft.revision >= 0 && Array.isArray(draft.members) && draft.members.length <= 12
      && draft.members.every((member: TeamMember) => member && typeof member.id === 'string' && typeof member.name === 'string' && typeof member.instructions === 'string'
        && Array.isArray(member.dependencies) && member.dependencies.every(id => typeof id === 'string'))) return draft
  } catch { /* Unavailable or damaged browser storage must not prevent editing. */ }
}
const commander = COMMANDER, planner = 'coordinator'
const width = 216, height = 126, gap = 64
function inputs(member: TeamMember, relation: Relation) {
  if (relation === 'parent') return [member.parentId ?? planner]
  if (member.dependencies.length) return member.dependencies
  return [member.parentId === commander ? commander : planner]
}
function arrange(members: TeamMember[], relation: Relation, viewport = 0, saved?: Layout): Layout {
  const ranks: Record<string, number> = { [commander]: 0, [planner]: 1 }
  for (let pass = 0; pass <= members.length; pass++) for (const member of members) {
    const from = inputs(member, relation)
    if (from.every(id => ranks[id] !== undefined)) ranks[member.id] = Math.max(...from.map(id => ranks[id]!)) + 1
  }
  const columns: Record<number, string[]> = {}
  for (const id of [commander, planner, ...members.map(member => member.id)]) (columns[ranks[id] ?? 2] ??= []).push(id)
  const count = Math.max(...Object.values(columns).map(ids => ids.length))
  const left = Math.max(36, (viewport - (count * width + (count - 1) * 36)) / 2)
  const defaults = Object.fromEntries(Object.entries(columns).flatMap(([rank, ids]) => ids.map((id, index) => [id,
    { x: left + ((count - ids.length) / 2 + index) * (width + 36), y: 40 + Number(rank) * (height + gap) }])))
  return restoreWorkflowLayout(defaults, saved, width, height)
}
function route(a: Point, b: Point) {
  return orthogonalRoute(a, b, Math.max(a.x, b.x) + width / 2 + 16)
}

export function WorkflowEditor({ members, onChange, model, disabled = false, settings, onOpen, storageKey }: {
  members: TeamMember[]; onChange: (members: TeamMember[]) => void; model?: RoleModel; disabled?: boolean; settings?: ReactNode; onOpen?: (id: string) => void; storageKey: string
}) {
  const storage = viewKey(storageKey), [saved] = useState(() => readView(storage)), layouts = useRef(saved?.layouts ?? {})
  const { t, notify } = usePanel(), [relation, setRelation] = useState<Relation>(saved?.relation ?? 'delivery')
  const [selected, setSelected] = useState(planner), [positions, setPositions] = useState(() => arrange(members, relation, 0, saved?.layouts[relation]))
  const [zoom, setZoom] = useState(saved?.zoom ?? .85), [panelWidth, setPanelWidth] = useState(saved?.panelWidth ?? 380), [details, setDetails] = useState(saved?.details ?? true)
  const [link, setLink] = useState<{ from: string; point?: Point; target?: string }>()
  const [lines, setLines] = useState<Edge[]>([]), [edgeId, setEdgeId] = useState<string>(), [reveal, setReveal] = useState<string>()
  const canvas = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), nodes = useRef(new Map<string, HTMLElement>()), fitted = useRef(false)
  const drag = useRef<{ kind: 'node' | 'pan' | 'link' | 'resize'; id?: string; x: number; y: number; origin: Point }>()
  const member = members.find(member => member.id === selected)
  const [placement, setPlacement] = useState<MemberPlacement>()
  const edge = lines.find(line => line.id === edgeId)
  const [heights, setHeights] = useState<Record<string, number>>({})
  const defaults = arrange(members, relation), at = (id: string) => positions[id] ?? defaults[id]!
  const ids = [commander, planner, ...members.map(member => member.id)]
  const parents = [{ id: commander, name: t('teamCommander') }, { id: planner, name: t('teamCoordinator') }, ...members]
  useEffect(() => {
    layouts.current[relation] = Object.fromEntries(ids.filter(id => positions[id]).map(id => [id, positions[id]!]))
    try { localStorage.setItem(storage, JSON.stringify({ relation, layouts: layouts.current, zoom, panelWidth, details })) } catch { /* Keep the editor usable without storage. */ }
  }, [storage, positions, members, relation, zoom, panelWidth, details])
  const display = fitWorkflowCards(Object.fromEntries(ids.map(id => [id, at(id)])), heights, width, height)
  const size = { x: Math.max(800, ...ids.map(id => at(id).x + width + 70)), y: Math.max(460, ...ids.map(id => display[id]!.y + (heights[id] ?? height) + 70)) }
  const label = (id: string) => id === commander ? t('teamCommander') : id === planner ? t('teamCoordinator') : members.find(member => member.id === id)?.name ?? id
  const anchor = (id: string, side: 'in' | 'out'): Point => {
    const element = nodes.current.get(id)?.querySelector(`[data-port="${side}"]`), matrix = svg.current?.getScreenCTM?.()
    if (element && matrix) { const box = element.getBoundingClientRect(); return new DOMPoint(box.left + box.width / 2, box.top + box.height / 2).matrixTransform(matrix.inverse()) }
    return { x: at(id).x + width / 2, y: display[id]!.y + (side === 'out' ? heights[id] ?? height : 0) }
  }
  const coordinate = (x: number, y: number) => {
    const matrix = svg.current?.getScreenCTM?.()
    return matrix ? new DOMPoint(x, y).matrixTransform(matrix.inverse()) : { x, y }
  }
  const update = (next: TeamMember[]) => {
    if (disabled) return false
    // Incomplete text fields must not prevent connecting otherwise valid nodes.
    const problem = planIssues(next)[0]
    if (problem) { notify(problem.message); return false }
    onChange(next); return true
  }
  const edit = (patch: Partial<TeamMember>) => member && update(members.map(item => item.id === member.id ? { ...item, ...patch } : item))
  const remove = (id: string) => {
    const removed = members.find(item => item.id === id); if (!removed || disabled) return
    onChange(members.filter(item => item.id !== id).map(item => ({ ...item, dependencies: [...new Set(item.dependencies.flatMap(from => from === id ? removed.dependencies : [from]))],
      ...item.parentId === id ? { parentId: removed.parentId ?? planner } : {} })))
    setSelected(planner); setEdgeId(undefined)
  }
  const add = (role: Role, from = planner, mode: AddMode = 'after', connection?: Edge) => {
    if (disabled || members.length >= 12) return false
    const source = members.find(item => item.id === from), id = `member-${crypto.randomUUID().slice(0, 12)}`
    const dependencies = mode === 'parallel' ? [...source?.dependencies ?? []] : mode === 'child' || from === planner || from === commander ? [] : [from]
    const next: TeamMember = { id, name: role === 'implementer' ? t('teamMemberNumber', { count: members.length + 1 }) : `${t(`teamRole.${role}`)} ${members.length + 1}`,
      instructions: t(role === 'reviewer' ? 'teamDefaultCheckWork' : role === 'manager' ? 'flowPlannerWork' : 'flowDefaultWork'),
      responsibility: role, dependencies, parentId: from === commander || mode === 'child' || (mode !== 'parallel' && source?.responsibility === 'manager') ? from : source?.parentId ?? planner }
    const plans = members.map(item => mode === 'insert' && connection?.to === item.id
      ? { ...item, dependencies: [...item.dependencies.filter(id => id !== from), next.id] } : item)
    if (!update([...plans, next])) return false
    const origin = at(mode === 'child' && relation === 'delivery' ? inputs(next, relation)[0]! : from), point = mode === 'insert' && connection ? { ...at(connection.to) }
      : { x: origin.x + (mode === 'parallel' ? width + 36 : 0), y: origin.y + (mode === 'parallel' ? 0 : height + gap) }
    const shifted = new Set(mode === 'insert' && connection ? [connection.to] : [])
    for (let pass = 0; pass < members.length; pass++) for (const item of members) if (item.dependencies.some(id => shifted.has(id))) shifted.add(item.id)
    while (ids.some(id => !shifted.has(id) && Math.abs(at(id).x - point.x) < width + 20 && Math.abs(at(id).y - point.y) < height + 20)) point.x += width + 36
    setPositions(current => ({ ...current, ...Object.fromEntries([...shifted].map(id => [id, { x: at(id).x, y: at(id).y + height + gap }])), [id]: point }))
    setSelected(id); setEdgeId(undefined); setDetails(true); setReveal(id)
    return true
  }
  const addMenu = (label: string, from: string, mode: AddMode = 'after', compact = false, connection?: Edge) =>
    <ActionMenu label={label} compact={compact} disabled={disabled || members.length >= 12}
      items={(['implementer', 'reviewer', 'manager'] as const).map(role => ({ id: role, label: t(`flowAddRole.${role}`) }))}
      onSelect={role => add(role as Role, from, mode, connection)} />
  const chooseEdge = (line: Edge) => { setEdgeId(line.id); setLink(undefined); setDetails(true) }
  const removeEdge = () => {
    if (!edge || edge.to === planner || edge.from === planner || disabled) return
    update(members.map(item => item.id !== edge.to ? item : relation === 'parent' || edge.from === commander ? { ...item, parentId: planner }
      : { ...item, dependencies: item.dependencies.filter(id => id !== edge.from) })); setEdgeId(undefined)
  }
  const connect = (from: string, to: string) => {
    if (from === to || [commander, planner].includes(to)) return false
    return update(members.map(item => {
      if (item.id !== to) return item
      if (relation === 'parent') return { ...item, parentId: from }
      if (from === commander) return { ...item, parentId: commander, dependencies: [] }
      if (from === planner) return { ...item, parentId: item.parentId === commander ? planner : item.parentId, dependencies: [] }
      return { ...item, dependencies: [...new Set([...item.dependencies, from])] }
    }))
  }
  const near = (x: number, y: number, from: string) => members.find(item => {
    if (item.id === from) return false
    const box = nodes.current.get(item.id)?.getBoundingClientRect(); if (!box) return false
    return x >= box.left - 24 && x <= box.right && y >= box.top - 12 && y <= box.bottom + 12
  })?.id
  const memberIds = JSON.stringify(ids)
  useLayoutEffect(() => {
    const measure = () => {
      const next = Object.fromEntries(Array.from(nodes.current, ([id, node]) => [id, Math.max(height, node.offsetHeight)]))
      setHeights(old => Object.keys(next).length === Object.keys(old).length && Object.keys(next).every(id => next[id] === old[id]) ? old : next)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    for (const node of nodes.current.values()) observer.observe(node)
    return () => observer.disconnect()
  }, [memberIds])
  useLayoutEffect(() => {
    const measure = () => {
      const edges = [[commander, planner], ...members.flatMap(member => inputs(member, relation).map(from => [from, member.id]))]
      setLines(edges.map(([from, to]) => {
        const a = anchor(from!, 'out'), b = anchor(to!, 'in')
        return { id: `${from}:${to}`, from: from!, to: to!, ...route(a, b) }
      }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure); if (canvas.current) observer.observe(canvas.current)
    return () => observer.disconnect()
  }, [members, positions, relation, zoom, panelWidth, heights])
  useLayoutEffect(() => {
    if (fitted.current || !canvas.current?.clientWidth) return
    fitted.current = true
    // Center the old automatic layout too. A hand-positioned canvas keeps its coordinates.
    const layout = saved?.layouts[relation]
    if (layout && ids.some(id => layout[id]?.x !== defaults[id]?.x || layout[id]?.y !== defaults[id]?.y)) return
    const scale = saved?.zoom ?? Math.max(.75, Math.min(.85, (canvas.current.clientWidth - 24) / size.x))
    setZoom(scale); setPositions(arrange(members, relation, canvas.current.clientWidth / scale))
  }, [size.x])
  useLayoutEffect(() => { if (reveal) { nodes.current.get(reveal)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); setReveal(undefined) } }, [reveal])
  const down = (event: PointerEvent<HTMLElement>, kind: NonNullable<typeof drag.current>['kind'], id?: string) => {
    if (event.button) return
    if (disabled && (kind === 'node' || kind === 'link')) { event.stopPropagation(); return }
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { kind, id, x: event.clientX, y: event.clientY, origin: kind === 'node' ? at(id!) : kind === 'resize' ? { x: panelWidth, y: 0 }
      : { x: canvas.current?.scrollLeft ?? 0, y: canvas.current?.scrollTop ?? 0 } }
    if (kind === 'node') { setSelected(id!); setEdgeId(undefined) }
    if (kind === 'link') { setEdgeId(undefined); setLink({ from: id!, point: coordinate(event.clientX, event.clientY) }) }
  }
  const move = (event: PointerEvent) => {
    const action = drag.current; if (!action) return
    const dx = event.clientX - action.x, dy = event.clientY - action.y
    if (action.kind === 'node') setPositions(current => ({ ...current, [action.id!]: { x: Math.max(24, action.origin.x + dx / zoom), y: Math.max(24, action.origin.y + dy / zoom) } }))
    if (action.kind === 'pan' && canvas.current) { canvas.current.scrollLeft = action.origin.x - dx; canvas.current.scrollTop = action.origin.y - dy }
    if (action.kind === 'resize') setPanelWidth(Math.max(280, Math.min(480, action.origin.x - dx)))
    if (action.kind === 'link') setLink({ from: action.id!, point: coordinate(event.clientX, event.clientY), target: near(event.clientX, event.clientY, action.id!) })
  }
  const up = (event: PointerEvent) => {
    const action = drag.current; drag.current = undefined
    if (action?.kind === 'link') { const target = near(event.clientX, event.clientY, action.id!); if (target) connect(action.id!, target); setLink(undefined) }
  }
  const choose = (id: string) => { setEdgeId(undefined); if (link) { connect(link.from, id); setLink(undefined) } else { setSelected(id); setDetails(true) } }
  return <div className="dt-flow-editor" style={{ '--flow-inspector': `${panelWidth}px` } as CSSProperties} data-details={details || undefined}
    onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = undefined; setLink(undefined) }}
    onKeyDown={event => { if (event.key === 'Escape' && link) { event.stopPropagation(); setLink(undefined); drag.current = undefined } }}>
    <div className="dt-flow-main"><div className="dt-flow-toolbar">
      <SegmentedControl label={t('flowRelations')} value={relation} onChange={value => { setRelation(value); setLink(undefined); setEdgeId(undefined); setPositions(arrange(members, value, (canvas.current?.clientWidth ?? 0) / zoom, layouts.current[value])) }} options={[
        { value: 'delivery', label: t('flowDelivery') }, { value: 'parent', label: t('flowHierarchy') }]} />
      <Button size="sm" disabled={disabled || members.length >= 12} icon={<Icon name="plus" />} onClick={() => setPlacement({ parentId: selected, responsibility: 'implementer' })}>{t('teamAddMember')}</Button>
    </div><div className="dt-flow-viewport" ref={canvas} onPointerDown={event => down(event, 'pan')}>
      <div className="dt-flow-space" style={{ width: size.x * zoom, height: size.y * zoom }}><div className="dt-flow-world" style={{ width: size.x, height: size.y, transform: `scale(${zoom})` }}>
        <svg ref={svg} className="dt-flow-edges" width={size.x} height={size.y} aria-hidden="true">{lines.map(line => <g key={line.id} data-selected={edgeId === line.id || undefined}>
          <path d={line.path} data-delivery={relation === 'delivery' || undefined} />
          {line.to !== planner && <path className="dt-flow-edge-hit" d={line.path} onPointerDown={event => event.stopPropagation()} onClick={() => chooseEdge(line)} />}</g>)}
          {link?.point && <path className="dt-flow-preview" d={route(anchor(link.from, 'out'), link.target ? anchor(link.target, 'in') : link.point).path} />}</svg>
        {lines.filter(line => line.to !== planner).map(line => <button key={line.id} type="button" className="dt-flow-edge-action" disabled={disabled}
          style={{ left: line.midpoint.x, top: line.midpoint.y }} aria-label={t('flowEdge', { from: label(line.from), to: label(line.to) })} aria-pressed={edgeId === line.id}
          onPointerDown={event => event.stopPropagation()} onClick={() => chooseEdge(line)}><Icon name="settings" size={12} /></button>)}
        {ids.map(id => { const item = members.find(item => item.id === id), root = id === planner || id === commander
          return <article key={id} ref={element => { if (element) nodes.current.set(id, element); else nodes.current.delete(id) }} className="dt-flow-node" data-node={id}
            data-selected={selected === id || undefined} data-target={link?.target === id || undefined} style={{ left: display[id]!.x, top: display[id]!.y }}>
            <button type="button" className="dt-flow-node-body" onPointerDown={event => down(event, 'node', id)} onClick={() => choose(id)} aria-pressed={selected === id}
              onKeyDown={event => { if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(id); return }
                const shift = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key]; if (!shift) return
                event.preventDefault(); setPositions(current => ({ ...current, [id]: { x: Math.max(24, at(id).x + shift[0]!), y: Math.max(24, at(id).y + shift[1]!) } })) }}>
              <span className="dt-flow-node-heading"><Icon name={root || item?.responsibility === 'manager' ? 'agent' : item?.responsibility === 'reviewer' ? 'shield' : 'code'} /><strong>{label(id)}</strong></span>
              <span className="dt-flow-node-work">{root ? t(id === commander ? 'teamCommanderShared' : 'flowPlannerWork') : item?.instructions}</span>
              <span className="dt-flow-node-meta">{root ? t(id === commander ? 'teamCommander' : 'teamCoordinator') : t(`teamRole.${item?.responsibility ?? 'implementer'}`)}<span>{item?.model?.model ?? model?.model ?? t('teamModelInherit')}</span></span>
            </button>
            <button type="button" className="dt-flow-port" data-port="in" disabled={root || disabled} aria-label={t('flowConnectTo', { name: label(id) })} onPointerDown={event => event.stopPropagation()} onClick={() => { if (link) { connect(link.from, id); setLink(undefined) } }} />
            <button type="button" className="dt-flow-port" data-port="out" disabled={disabled}
              aria-label={t('flowConnectFrom', { name: label(id) })} onPointerDown={event => down(event, 'link', id)} onClick={event => { if (!event.detail) setLink({ from: id }) }} />
            <div className="dt-flow-node-actions">{addMenu(t(relation === 'parent' ? 'flowAddChildOf' : 'flowAddAfter', { name: label(id) }), id, relation === 'parent' ? 'child' : 'after', true)}
              {!root && <Button size="sm" disabled={disabled} aria-label={t('flowRemoveNode', { name: label(id) })} title={t('teamRemoveMember')}
                icon={<Icon name="close" size={13} />} onPointerDown={event => event.stopPropagation()} onClick={() => remove(id)} />}</div>
          </article> })}
      </div></div></div><div className="dt-flow-bottom"><span>{t(link ? 'flowSelectTarget' : 'flowDragHint')}</span><div>
        <Button size="sm" aria-label={t('flowZoomOut')} onClick={() => setZoom(Math.max(.6, zoom - .1))}>−</Button><span>{Math.round(zoom * 100)}%</span>
        <Button size="sm" aria-label={t('flowZoomIn')} onClick={() => setZoom(Math.min(1.4, zoom + .1))}>＋</Button>
        <Button size="sm" onClick={() => { setPositions(arrange(members, relation, (canvas.current?.clientWidth ?? 0) / zoom)); canvas.current?.scrollTo({ left: 0, top: 0 }) }}>{t('flowArrange')}</Button>
        <Button size="sm" aria-pressed={details} onClick={() => setDetails(!details)}>{t('flowProperties')}</Button>
      </div></div>
    </div>
    <div className="dt-flow-resizer" role="separator" aria-label={t('flowResize')} aria-orientation="vertical" tabIndex={0} aria-valuenow={panelWidth} aria-valuemin={280} aria-valuemax={480}
      onPointerDown={event => down(event, 'resize')} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); setPanelWidth(Math.max(280, Math.min(480, panelWidth + (event.key === 'ArrowLeft' ? 20 : -20)))) } }} />
    {details && <aside className="dt-flow-inspector"><header><h3>{edge ? t('flowConnection') : member ? t('teamMembers') : t('flowTeamSettings')}</h3><Button size="sm" aria-label={t('close')} icon={<Icon name="close" />} onClick={() => setDetails(false)} /></header>
      {edge ? <><p className="dt-flow-edge-caption">{label(edge.from)} <span>→</span> {label(edge.to)}</p>
        {relation === 'delivery' && addMenu(t('flowInsert'), edge.from, 'insert', false, edge)}
        <p className="dt-hint">{t(relation === 'delivery' ? 'flowEdgeHint' : 'flowParentHint')}</p>
        {edge.from !== planner && <div className="dt-danger-zone"><Button icon={<Icon name="trash" />} disabled={disabled} onClick={removeEdge}>{t('flowRemoveEdge')}</Button></div>}</>
      : member ? <><fieldset className="dt-flow-member-fields" disabled={disabled}><ComposerField label={t('teamMemberName')} required><Input required value={member.name} maxLength={60} onChange={event => onChange(members.map(item => item.id === member.id ? { ...item, name: event.target.value } : item))} /></ComposerField>
        <ComposerField label={t('teamMemberWork')} required><textarea className="dt-textarea" required rows={4} maxLength={4000} value={member.instructions} onChange={event => onChange(members.map(item => item.id === member.id ? { ...item, instructions: event.target.value } : item))} /></ComposerField>
        <ComposerField label={t('teamResponsibility')} note={member.responsibility === 'reviewer' ? t('flowReviewHint') : undefined}><Select value={member.responsibility ?? 'implementer'} onChange={event => edit({ responsibility: event.target.value as TeamMember['responsibility'] })}>
          {(['manager', 'implementer', 'reviewer'] as const).map(role => <option value={role} key={role}>{t(`teamRole.${role}`)}</option>)}</Select></ComposerField>
        <h4>{t('flowRelationsTitle')}</h4>
        <ComposerField label={t('teamParent')}><Select value={member.parentId ?? planner} onChange={event => edit({ parentId: event.target.value })}>
          {parents.filter(item => item.id !== member.id).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</Select></ComposerField>
        <section className="dt-flow-dependencies"><h4>{t('teamDependencies')}</h4>{members.filter(item => item.id !== member.id).map(item => <label key={item.id}><input type="checkbox" checked={member.dependencies.includes(item.id)}
          onChange={event => edit({ dependencies: event.target.checked ? [...member.dependencies, item.id] : member.dependencies.filter(id => id !== item.id) })} />{item.name}</label>)}</section>
        <h4>{t('studioExecutionSettings')}</h4>
        <ComposerField label={t('localTaskModel')}><ModelSelect inherited={model} value={member.model} defaultLabel={t('teamModelInherit')} onChange={model => edit({ model })} /></ComposerField>
        <ComposerField label={t('modelEffort')}><ReasoningSelect inherited={model} value={member.model} onChange={model => edit({ model })} /></ComposerField>

        <div className="dt-flow-member-actions">{relation === 'delivery'
          ? <>{addMenu(t('flowAddNext'), member.id)}{addMenu(t('flowAddParallel'), member.id, 'parallel')}</>
          : addMenu(t('flowAddChildOf', { name: member.name }), member.id, 'child')}</div>
        </fieldset>{onOpen && <Button onClick={() => onOpen(member.id)} icon={<Icon name="message" />}>{t('teamOpenSession')}</Button>}
        <div className="dt-danger-zone"><Button disabled={disabled} icon={<Icon name="trash" />} onClick={() => remove(member.id)}>{t('teamRemoveMember')}</Button></div></>
      : <>{settings ?? <p className="dt-hint">{t('flowPlannerWork')}</p>}{relation === 'parent'
        ? addMenu(t('flowAddChildOf', { name: label(selected) }), selected, 'child') : addMenu(t('flowAddNext'), selected)}
        {onOpen && <Button icon={<Icon name="message" />} onClick={() => onOpen(selected)}>{t('teamOpenSession')}</Button>}</>}
    </aside>}
    <Modal open={!!placement} className="dt-composer-modal dt-flow-add-member" icon={<Icon name="user" size={17} />} title={t('teamAddMember')} closeLabel={t('close')} onClose={() => setPlacement(undefined)}
      footer={<div className="dt-flow-actions"><Button onClick={() => setPlacement(undefined)}>{t('cancel')}</Button>
        <Button variant="primary" disabled={disabled || members.length >= 12} onClick={() => {
          if (placement && add(placement.responsibility, placement.parentId, 'child')) setPlacement(undefined)
        }}>{t('localAdd')}</Button></div>}>
      {placement && <section className="dt-composer-brief"><MemberPlacementFields parents={parents}
        value={placement} onChange={setPlacement} /></section>}
    </Modal>
  </div>
}

export function EditTeamWorkflow({ team, reload, select }: { team: TeamView; reload: () => Promise<void>; select: (id: string) => void }) {
  const { t, call } = usePanel(), form = useId(), draftKey = `dsh-superagent/workflow-draft/${team.id}`
  const [draft, setDraft] = useState(() => readDraft(draftKey)), [open, setOpen] = useState(false)
  useEffect(() => { try { if (draft) sessionStorage.setItem(draftKey, JSON.stringify(draft)); else sessionStorage.removeItem(draftKey) } catch { /* Preserve in-memory draft if storage is unavailable. */ } }, [draftKey, draft])
  const [failure, setFailure] = useState<string>()
  const [savedTeam, setSavedTeam] = useState<TeamView>()
  const save = useAction(async () => {
    try {
      const updated = await call('PUT local/teams/:id/plan', { id: team.id, body: draft! })
      setSavedTeam(updated); setDraft(undefined); setOpen(false); await reload()
    }
    catch (error) { setFailure(errorText(error)); throw error }
  })
  const stopped = team.state === 'stopped'
  // The workbench poll can still be showing the previous revision when the editor reopens.
  const latest = savedTeam && (savedTeam.planRevision ?? 0) > (team.planRevision ?? 0) ? savedTeam : team
  const members = latest.members.filter(member => member.role === 'member').map(({ plan, id, name, instructions, dependencies, parentId, responsibility, model }) => plan ?? ({ id, name, instructions, dependencies, parentId, responsibility, model: model ?? undefined }))
  const visibleMembers = stopped ? members : draft?.members
  return <><Button size="sm" variant="outline" icon={<Icon name="agent" />} onClick={() => {
    setFailure(!stopped && draft && draft.revision !== (latest.planRevision ?? 0) ? t('flowDraftStale') : undefined)
    if (!stopped) setDraft(current => current ?? { revision: latest.planRevision ?? 0, members })
    setOpen(true)
  }}>{t('flowEdit')}</Button>
    <Modal open={open} className="dt-workflow-modal" title={t('flowEdit')} closeLabel={t('close')} onClose={() => { if (!save.busy) setOpen(false) }}
      footer={stopped ? <div className="dt-flow-actions"><span>{t('flowStoppedView')}</span><Button onClick={() => setOpen(false)}>{t('close')}</Button></div> : <div className="dt-flow-actions"><span>{t('flowDraftKept')}</span><Button disabled={save.busy} onClick={() => { setDraft(undefined); setOpen(false) }}>{t('cancel')}</Button><Button type="submit" form={form} variant="primary" disabled={save.busy}>{t('save')}</Button></div>}>
      {visibleMembers && <ComposerForm id={form} disabled={save.busy} failure={failure} onSubmit={() => { if (!stopped && draft) void save.run() }}><WorkflowEditor storageKey={team.id} members={visibleMembers} onChange={members => { if (!stopped && draft) setDraft({ ...draft, members }) }} model={team.model} disabled={stopped || save.busy}
        onOpen={id => { select(id); setOpen(false) }} settings={<><p className="dt-hint">{team.name}</p>{!!team.retiredMembers?.length && <section><h4>{t('flowRetired')}</h4>{team.retiredMembers.map(member => <div className="dt-flow-retired" key={member.id}><span>{member.name}</span>
          {member.sessionId && <SessionButton sessionId={member.sessionId} label={t('teamOpenSession')} />}</div>)}</section>}</>} /></ComposerForm>}
    </Modal></>
}
