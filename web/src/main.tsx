import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { H5Shell } from './components/H5Shell'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <H5Shell>
        <App />
      </H5Shell>
    </BrowserRouter>
  </StrictMode>,
)
