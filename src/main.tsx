import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import App from './App'
import Admin from './routes/Admin'
import './index.css'

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/admin', element: <Admin /> },
])

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} future={{ v7_startTransition: true }} />
  </React.StrictMode>,
)
