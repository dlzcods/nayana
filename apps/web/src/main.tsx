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
import { ScreeningPage } from './pages/ScreeningPage'
import { ScreeningResultPage } from './pages/ScreeningResultPage'
import { LoginPage } from './pages/LoginPage'
import { AccountPage } from './pages/AccountPage'
import { ScreeningChatPage } from './pages/ScreeningChatPage'
import { HistoryChatPage } from './pages/HistoryChatPage'
import { ScreeningHistoryPage } from './pages/ScreeningHistoryPage'
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

const screeningRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/screening',
  component: ScreeningPage,
})

const screeningResultRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/screening/results/$screeningId',
  component: ScreeningResultPage,
})

const screeningChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/screening/results/$screeningId/chat',
  component: ScreeningChatPage,
})

const personalScreeningRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/screening/upload',
  component: ScreeningPage,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
})

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/account',
  component: AccountPage,
})

const historyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history',
  validateSearch: (search: Record<string, unknown>) => ({
    hasil: typeof search.hasil === 'string' && search.hasil.trim() ? search.hasil : undefined,
  }),
  component: ScreeningHistoryPage,
})

const historyChatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/history/$recordId/chat',
  component: HistoryChatPage,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  evidenceRoute,
  termsRoute,
  screeningRoute,
  personalScreeningRoute,
  loginRoute,
  accountRoute,
  historyRoute,
  historyChatRoute,
  screeningChatRoute,
  screeningResultRoute,
])

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  // Each workflow controls its own intentional anchor. Restoring a document
  // position for query-only workspace changes made history selection jump.
  scrollRestoration: false,
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
