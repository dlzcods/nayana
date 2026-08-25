import React from 'react'
import ReactDOM from 'react-dom/client'
import {
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { LandingPage } from './pages/LandingPage'
import { LegalPage } from './pages/LegalPage'
import { EvidencePage } from './pages/EvidencePage'
import './styles.css'

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => <LegalPage kind="not-found" />,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LandingPage,
})

const evidenceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/model-evidence',
  component: EvidencePage,
})

const termsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/terms',
  component: () => <LegalPage kind="terms" />,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  evidenceRoute,
  termsRoute,
])

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
)
