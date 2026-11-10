/** Native form values with the host's themed, portalled Menu presentation. */
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type SelectHTMLAttributes } from 'react'
import { Menu, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { Icon } from './controls.tsx'

export function Select({ id, className = '', value, children, disabled, title, onChange, ...props }:
  Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'>) {
  const owner = useId(), native = useRef<HTMLSelectElement>(null), trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false), [caption, setCaption] = useState(''), [items, setItems] = useState<MenuEntry[]>([])
  const [, resizeMenu] = useState(0)
  const menu = () => document.querySelector<HTMLElement>(`[data-choice-owner=${JSON.stringify(owner)}]`)?.closest<HTMLElement>('[role="menu"]')
  const close = (focus = false) => { setOpen(false); if (focus) trigger.current?.focus({ preventScroll: true }) }
  useLayoutEffect(() => {
    const select = native.current
    if (!select) return
    setCaption(select.selectedOptions[0]?.label ?? String(value ?? ''))
    setItems([...select.options].map(option => ({ id: option.value, disabled: option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
      label: <span className="dt-choice-option" data-choice-owner={owner}>{option.label}</span> })))
  }, [children, value, owner])
  useLayoutEffect(() => {
    if (!open) return
    if (trigger.current?.matches(':disabled')) { setOpen(false); return }
    const panel = menu()
    if (!panel) return
    const size = () => {
      const width = Math.min(Math.max(trigger.current?.getBoundingClientRect().width ?? 0, 240), window.innerWidth - 24)
      if (width > 0 && panel.style.width !== `${width}px`) {
        panel.style.width = `${width}px`; panel.style.minWidth = `${width}px`; panel.style.maxWidth = `${width}px`
        resizeMenu(revision => revision + 1)
      }
    }
    size()
    const rows = [...panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
    const enabled = items.filter(item => 'label' in item && !item.disabled)
    const index = enabled.findIndex(item => item.id === String(value ?? ''))
    let disposed = false
    queueMicrotask(() => { if (!disposed) (rows[index] ?? rows[0])?.focus({ preventScroll: true }) })
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(size)
    if (trigger.current) observer?.observe(trigger.current)
    return () => { disposed = true; observer?.disconnect() }
  }, [open])
  const choose = (next: string) => {
    if (!native.current || trigger.current?.matches(':disabled')) { close(); return }
    native.current.value = next
    native.current.dispatchEvent(new Event('change', { bubbles: true }))
    close(true)
  }
  const keys = (event: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); setOpen(true) }
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return }
    if (event.key === 'Tab') { close(true); return }
    const rows = [...(menu()?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])]
    const current = rows.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : event.key === 'ArrowDown' ? (current + 1) % rows.length
      : event.key === 'ArrowUp' ? (current + rows.length - 1) % rows.length : -1
    if (next >= 0) { event.preventDefault(); rows[next]?.focus(); rows[next]?.scrollIntoView?.({ block: 'nearest' }) }
  }
  return <span className={`dt-select dt-choice ${className}`} data-open={open || undefined} onKeyDown={keys}>
    <select {...props} ref={native} className="dt-choice-native" value={value} disabled={disabled} onChange={onChange} hidden tabIndex={-1} aria-hidden="true"
      onInvalid={event => { event.preventDefault(); trigger.current?.focus(); setOpen(true) }}>{children}</select>
    <Menu open={open} selectedId={String(value ?? '')} items={items} onSelect={choose} onClose={() => close()} portal compact align="start" side="bottom"
      className="dt-choice-anchor" getAnchorRect={() => trigger.current?.getBoundingClientRect() ?? null}
      anchor={<button id={id} ref={trigger} type="button" className="dt-choice-trigger" disabled={disabled} aria-label={props['aria-label']}
        aria-labelledby={props['aria-labelledby']} aria-haspopup="menu" aria-expanded={open} title={title ?? caption} onClick={() => setOpen(value => !value)}>
        <span>{caption}</span><Icon name="chevron-down" size={14} />
      </button>} />
  </span>
}
