import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import Admin from './routes/Admin'
import { BarberSelectionProvider } from './context/BarberContext'
import './index.css'

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/admin', element: <Admin /> },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BarberSelectionProvider>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </BarberSelectionProvider>
  </React.StrictMode>,
)
