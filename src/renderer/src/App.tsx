import { useStudio } from './lib/useStudio'
import { SplashView } from './views/SplashView'

function App(): React.JSX.Element {
  const { state, start } = useStudio()
  return <SplashView studio={state} onRetry={() => void start()} />
}

export default App
