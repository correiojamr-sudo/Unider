import React from 'react'
import ReactDOM from 'react-dom/client'
import { PublicConfigError, getPublicConfig } from './lib/publicConfig'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root')!)
async function bootstrap() {
  try {
    getPublicConfig()
    const { default: App } = await import('./App.tsx')
    root.render(<React.StrictMode><App /></React.StrictMode>)
  } catch (error) {
    const message = error instanceof PublicConfigError ? error.message : 'Não foi possível iniciar a aplicação. Tenta recarregar.'
    root.render(<main className="min-h-screen bg-slate-900 text-slate-100 p-6 flex flex-col justify-center gap-4">
      <h1 className="text-xl font-bold">Aquecimento — aplicação indisponível</h1>
      <p role="alert">{message}</p>
      <button className="rounded-xl bg-slate-700 p-3" onClick={() => window.location.reload()}>Recarregar</button>
    </main>)
  }
}
void bootstrap()
