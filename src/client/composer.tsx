/** Shared C2 writing surface, compact properties, and inline validation for real operations. */
import { cloneElement, createContext, useContext, useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { Button, Icon, Modal, type IconName } from './controls.tsx'
import { usePanel } from './provider.tsx'

const Errors = createContext<Record<string, string>>({})

export function ComposerModal({ open, title, kind, busy, close, form, action, note, children }: {
  open: boolean; title: string; kind: 'task' | 'member' | 'workspace'; busy: boolean; close: () => void
  form: string; action: string; note?: string; children: ReactNode
}) {
  const { t } = usePanel(), icons: Record<typeof kind, IconName> = { task: 'message', member: 'user', workspace: 'folder' }
  return <Modal open={open} onClose={() => { if (!busy) close() }} title={title} closeLabel={t('close')}
    icon={<Icon name={icons[kind]} size={17} />} className={`dt-composer-modal dt-composer-${kind}`}
    footer={<div className="dt-composer-actions"><span title={note}>{note}</span><div>
      <Button variant="ghost" disabled={busy} onClick={close}>{t('cancel')}</Button>
      <Button variant="primary" type="submit" form={form} disabled={busy}>{busy ? t('localSubmitting') : action}</Button>
    </div></div>}>{children}</Modal>
}

export function ComposerForm({ id, disabled, onSubmit, failure, children }: {
  id: string; disabled: boolean; onSubmit: () => void; failure?: string; children: ReactNode
}) {
  const { t } = usePanel(), [errors, setErrors] = useState<Record<string, string>>({}), focus = useRef<HTMLElement>(), form = useRef<HTMLFormElement>(null)
  useLayoutEffect(() => { const body = form.current?.closest('.dt-modal-body'); if (body) body.scrollTop = 0 }, [])
  useLayoutEffect(() => {
    const field = focus.current
    if (field?.isConnected) {
      for (let detail = field.closest('details'); detail; detail = detail.parentElement?.closest('details') ?? null) detail.open = true
      field.focus({ preventScroll: true }); field.closest('.dt-composer-field')?.scrollIntoView?.({ block: 'nearest' }); focus.current = undefined
    }
    // Native directory pickers update controlled values without dispatching a text-input event.
    const resolved = Object.keys(errors).filter(id => {
      const control = form.current?.elements.namedItem(id)
      return (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)
        && control.validity.valid && (!control.required || !!control.value.trim())
    })
    if (resolved.length) setErrors(current => Object.fromEntries(Object.entries(current).filter(([id]) => !resolved.includes(id))))
  })
  return <Errors.Provider value={errors}><form ref={form} id={id} className="dt-composer-form" noValidate onSubmit={event => {
    event.preventDefault(); if (disabled) return
    const invalid = [...event.currentTarget.elements].filter((field): field is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement =>
      (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement)
      && field.willValidate && (!field.validity.valid || field.required && !field.value.trim()))
    if (invalid.length) {
      focus.current = invalid[0]
      setErrors(Object.fromEntries(invalid.map(field => [field.id, field.validity.valueMissing || !field.value.trim()
        ? t('studioRequired', { name: field.getAttribute('aria-label') || field.labels?.[0]?.textContent || t('teamMemberWork') }) : field.validationMessage])))
      return
    }
    setErrors({}); onSubmit()
  }} onInputCapture={event => {
    const id = (event.target as HTMLElement).id
    if (errors[id]) setErrors(current => { const next = { ...current }; delete next[id]; return next })
  }}><fieldset className="dt-composer-fields" disabled={disabled}>{failure && <p className="dt-error dt-composer-failure" role="alert">{failure}</p>}{children}</fieldset></form></Errors.Provider>
}

export function ComposerField({ label, required, note, children }: {
  label: string; required?: boolean; note?: ReactNode
  children: ReactElement<{ id?: string; 'aria-label'?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>
}) {
  const generated = useId(), id = children.props.id ?? generated, errors = useContext(Errors), error = errors[id]
  return <div className="dt-composer-field"><div className="dt-composer-field-heading"><label htmlFor={id}>{label}{required && <span aria-hidden="true">*</span>}</label>
    <small id={`${id}-error`} className="dt-composer-field-error" aria-live="polite" title={error}>{error}</small></div>
    {cloneElement(children, { id, 'aria-label': children.props['aria-label'] ?? label, 'aria-invalid': !!error || undefined,
      'aria-describedby': [children.props['aria-describedby'], `${id}-error`, note ? `${id}-note` : undefined].filter(Boolean).join(' ') })}
    {note && <small className="dt-hint" id={`${id}-note`}>{note}</small>}</div>
}

export function WritingArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const field = useRef<HTMLTextAreaElement>(null)
  const grow = () => { if (field.current) { field.current.style.height = 'auto'; field.current.style.height = `${Math.max(128, field.current.scrollHeight)}px` } }
  useLayoutEffect(grow, [props.value])
  useLayoutEffect(() => {
    const parent = field.current?.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return
    let width = parent.clientWidth
    const observer = new ResizeObserver(() => { if (width !== parent.clientWidth) { width = parent.clientWidth; grow() } })
    observer.observe(parent); return () => observer.disconnect()
  }, [])
  return <textarea {...props} ref={field} className="dt-textarea dt-composer-writing" rows={4} />
}
