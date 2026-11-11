// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { Select } from '../src/client/select.tsx'
import { Modal } from '../src/client/controls.tsx'
import { effortLabel } from '../src/client/model-labels.ts'
import { zh } from '../src/client/locales.ts'
import type { T } from '../src/client/text.ts'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
it('localizes standard effort names, including Off, while keeping provider descriptions', () => {
  const t: T = key => zh[key]
  expect(effortLabel('none', 'Off', t)).toBe('关闭')
  expect(effortLabel('off', 'Off', t)).toBe('关闭')
  expect(effortLabel('high', 'High', t)).toBe('高')
  expect(effortLabel('high', 'High (32K budget)', t)).toBe('High (32K budget)')
})
const key = (name: string) => act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) })
async function mount(content: React.ReactNode) {
  const container = document.createElement('div'); document.body.append(container)
  const root = createRoot(container)
  onTestFinished(() => { act(() => root.unmount()); container.remove() })
  await act(async () => { root.render(content) })
  return container
}

it('shows readable labels, skips disabled choices, and commits only the selected ID to the form', async () => {
  const seen: string[] = []
  function Form() {
    const [value, setValue] = useState('provider-a')
    return <form><Select aria-label="服务商" name="provider" value={value} onChange={event => { seen.push(event.target.value); setValue(event.target.value) }}>
      <option value="provider-a">服务商 A</option><optgroup label="不可用" disabled><option value="disabled">不可用</option></optgroup>
      <option value="provider-b">服务商 B</option></Select></form>
  }
  const container = await mount(<Form />), trigger = container.querySelector('button')!
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ width: 240 } as DOMRect)
  const resized = vi.fn()
  window.addEventListener('resize', resized)
  onTestFinished(() => window.removeEventListener('resize', resized))
  expect(trigger.textContent).toBe('服务商 A')
  trigger.focus(); await key('ArrowDown')
  expect(document.querySelector<HTMLElement>('[role="menu"]')?.style.width).toBe('240px')
  expect(resized).not.toHaveBeenCalled()
  expect(document.activeElement?.textContent).toBe('服务商 A')
  await key('ArrowDown')
  expect(document.activeElement?.textContent).toBe('服务商 B')
  await act(async () => { (document.activeElement as HTMLButtonElement).click() })
  expect(seen).toEqual(['provider-b'])
  expect(new FormData(container.querySelector('form')!).get('provider')).toBe('provider-b')
  expect(trigger.textContent).toBe('服务商 B')
  expect(document.activeElement).toBe(trigger)
  expect(document.querySelector('[role="menu"]')).toBeNull()
})

it('dismisses the menu with Escape without dismissing its dialog, and preserves native required validation', async () => {
  function Form() {
    const [open, setOpen] = useState(true), [value, setValue] = useState('')
    return <Modal open={open} title="设置" closeLabel="关闭" onClose={() => setOpen(false)}><form>
      <Select aria-label="选择模型" required value={value} onChange={event => setValue(event.target.value)}>
        <option value="">请选择</option><option value="model-a">模型 A</option>
      </Select></form></Modal>
  }
  await mount(<Form />)
  const trigger = document.querySelector<HTMLButtonElement>('[aria-label="选择模型"]:not(select)')!
  const form = document.querySelector('form')!
  await act(async () => { expect(form.reportValidity()).toBe(false) })
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  await key('Escape')
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(document.activeElement).toBe(trigger)
  await act(async () => trigger.click())
  await key('End')
  expect(document.activeElement?.textContent).toBe('模型 A')
  await act(async () => { (document.activeElement as HTMLButtonElement).click() })
  expect(form.reportValidity()).toBe(true)
})

it('does not open or mutate values inside a disabled settings group', async () => {
  const container = await mount(<fieldset disabled><Select value="a" onChange={() => { throw new Error('Disabled control changed') }}>
    <option value="a">A</option><option value="b">B</option></Select></fieldset>)
  await act(async () => container.querySelector('button')!.click())
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(container.querySelector('select')!.value).toBe('a')
})

it('handles host-level Escape for a focused menu before dismissing its task dialog', async () => {
  function Form() {
    const [open, setOpen] = useState(true), [value, setValue] = useState('high')
    return <Modal open={open} title="新建任务" closeLabel="关闭" onClose={() => setOpen(false)}>
      <Select aria-label="推理强度" value={value} onChange={event => setValue(event.target.value)}><option value="high">高</option></Select>
    </Modal>
  }
  await mount(<Form />)
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label="推理强度"]')!
  await act(async () => trigger.click())
  expect(document.activeElement?.getAttribute('role')).toBe('menuitem')
  // Host overlays can route keys at document level rather than through the plugin's React parent.
  const escape = () => act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
  await escape()
  expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(trigger)
  await escape()
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})

it.each([[390, 240], [220, 196]])('gives narrow model choices room while staying within a %i px viewport', async (viewport, width) => {
  vi.stubGlobal('innerWidth', viewport)
  onTestFinished(() => { vi.unstubAllGlobals() })
  const container = await mount(<Select aria-label="任务模型" value="a"><option value="a">DeepSeek Account · DeepSeek-V4.1-Flash</option></Select>)
  const trigger = container.querySelector('button')!
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({ width: 140 } as DOMRect)
  trigger.focus(); await key('ArrowDown')
  expect(document.querySelector<HTMLElement>('[role="menu"]')?.style.width).toBe(`${width}px`)
  expect(document.activeElement?.textContent).toBe('DeepSeek Account · DeepSeek-V4.1-Flash')
  await key('Escape')
  expect(document.activeElement).toBe(trigger)
})
