import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// Proxy target: if VITE_API_URL is an absolute URL, use that as the
// proxy target. Otherwise the default proxy target is the local FastAPI
// dev server (port 8000). The proxy is only effective when adminApi
// uses a relative baseURL like `/api/v1` — see `src/lib/api.ts`.
const DEFAULT_PROXY_TARGET = 'http://localhost:8000'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiUrl = env.VITE_API_URL
  const proxyTarget = apiUrl && /^https?:\/\//.test(apiUrl)
    ? new URL(apiUrl).origin
    : DEFAULT_PROXY_TARGET

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
          credentials: 'include', // Forward cookies from backend through proxy
        },
      },
    },
  }
})


//  am talking of something outside that will bring me revenue for both platform and user and you're
//   here telling me something stupid, where will i get or have money to pay users if i dont get
//   profit, i cant give users my personal money right? am talking of third party integrations. But
//   airtime/data, utitlity subscriptions, etc like opay and others do. please lest have a serious
//   discussion 

// what is the plan and how to make it happen? 

// give me a visual design let me first before code 

//  i see, but dont expose my secret to users, how will i get vtpass apikey? and where do you think
//   we can get apikey for aggregator that sell chip data? 

//   lets start with peyflex, we can implement them all, but let peyflex be the primary usage, what do   you think 

//   start while i check peyflex website, dont forget to follow the exiting pattern 