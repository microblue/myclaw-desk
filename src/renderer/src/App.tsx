import { useBootstrap } from './lib/useBootstrap'
import { useStudio } from './lib/useStudio'
import { BootstrapView } from './views/BootstrapView'

function App(): React.JSX.Element {
  const bootstrap = useBootstrap()
  const studio = useStudio()
  return (
    <BootstrapView
      state={bootstrap.state}
      onRetry={() => {
        if (bootstrap.state.phase === 'error') void bootstrap.start()
        else if (studio.state.phase === 'error') void studio.start()
      }}
    />
  )
}

export default App
