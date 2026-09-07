import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from "react-router";
import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { router } from './router';
import './index.css'
import { ToastProvider } from './components/Toast';
import { ThemeProvider } from './components/ThemeProvider'


const queryClient = new QueryClient()


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <RouterProvider router={router}></RouterProvider>
        </ ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
