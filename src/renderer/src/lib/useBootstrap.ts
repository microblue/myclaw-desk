import { useEffect, useState } from 'react'
import type { BootstrapState } from '../../../shared/bootstrap'

const initial: BootstrapState = {
  phase: 'idle',
  progress: 0,
  message: 'Loading…'
}

export function useBootstrap(): {
  state: BootstrapState
  start: () => Promise<void>
} {
  const [state, setState] = useState<BootstrapState>(initial)

  useEffect(() => {
    let cancelled = false
    void window.api.bootstrap.getState().then((s) => {
      if (!cancelled) setState(s)
    })
    const unsubscribe = window.api.bootstrap.onStateChanged((s) => setState(s))
    // Kick off the install immediately on mount; the bootstrapper is idempotent.
    void window.api.bootstrap.start()
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return {
    state,
    start: async () => {
      await window.api.bootstrap.start()
    }
  }
}
