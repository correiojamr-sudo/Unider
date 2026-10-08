import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { readPublicConfig } from './src/lib/publicConfig.ts'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  try { readPublicConfig(env) } catch (error) {
    if (command === 'build') throw error
    // Dev shows a recoverable diagnostic without injecting an invalid key.
    return { plugins: [react()], define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(''),
    } }
  }
  return { plugins: [react()] }
})
