import { useEffect, useState } from 'react'
import type { StudioState } from '../../../shared/studio'

const initial: StudioState = { phase: 'idle' }

export function useStudio(): {
  state: StudioState
  start: () => Promise<void>
  stop: () => Promise<void>
} {
  const [state, setState] = useState<StudioState>(initial)

  useEffect(() => {
    let cancelled = false
    void window.api.studio.getState().then((s) => {
      if (!cancelled) setState(s)
    })
    const unsubscribe = window.api.studio.onStateChanged((s) => setState(s))
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return {
    state,
    start: async () => {
      await window.api.studio.start()
    },
    stop: async () => {
      await window.api.studio.stop()
    }
  }
}
