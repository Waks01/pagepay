import { QueryClient } from '@tanstack/react-query'
import { Toaster } from 'sonner'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 60_000,
    },
  },
})

export function AppToaster() {
  return <Toaster position="bottom-right" richColors />
}
