import { useBootstrap } from './lib/useBootstrap'
import { useStudio } from './lib/useStudio'
import { SplashView } from './views/SplashView'

function App(): React.JSX.Element {
  const bootstrap = useBootstrap()
  const studio = useStudio()
  return (
    <SplashView
      bootstrap={bootstrap.state}
      studio={studio.state}
      onRetry={() => {
        if (bootstrap.state.phase === 'error') void bootstrap.start()
        else if (studio.state.phase === 'error') void studio.start()
      }}
    />
  )
}

export default App
