import { defineConfig } from 'vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

import viteReact from '@vitejs/plugin-react'

const config = defineConfig({
  resolve: { tsconfigPaths: true, alias: { util: 'util/' } },
  plugins: [
    ...(process.env.CLOUDFLARE_BUILD === 'true' ? [cloudflare({ viteEnvironment: { name: 'ssr' } })] : []),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
