/** Local UI preference, separate from session drafts and executor configuration. */
import { createContext, useContext } from 'react'

export const DENSITIES = ['compact', 'standard', 'comfortable'] as const
export type Density = typeof DENSITIES[number]
export const DENSITY_KEY = 'dsh-superagent/ui-density'
export const DensityContext = createContext<{ density: Density; setDensity: (value: Density) => void } | undefined>(undefined)
export function useDensity() {
  const value = useContext(DensityContext)
  if (!value) throw new Error('Density settings rendered outside local pages')
  return value
}
export function readDensity(): Density {
  try { const stored = localStorage.getItem(DENSITY_KEY); return DENSITIES.find(value => value === stored) ?? 'compact' }
  catch { return 'compact' }
}
