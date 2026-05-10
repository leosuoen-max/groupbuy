import { AppRoutes } from './appRoutes'
import { useDeployVersionReload } from './hooks/useDeployVersionReload'

function App() {
  useDeployVersionReload()
  return <AppRoutes />
}

export default App
