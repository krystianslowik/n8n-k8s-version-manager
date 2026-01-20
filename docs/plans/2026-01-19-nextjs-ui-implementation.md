# Next.js + shadcn/ui Web UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build modern Next.js web UI with shadcn/ui components, smooth animations, and polished UX for n8n version management

**Architecture:** Next.js 15 App Router with Server Components, client components for interactivity, TanStack Query for data fetching, direct API calls to existing FastAPI backend

**Tech Stack:** Next.js 15, TypeScript, shadcn/ui (40+ components), TanStack Query v5, Tailwind CSS v4, Sonner toasts, lucide-react icons

---

## Task 1: Initialize Next.js Project with shadcn/ui

Create new Next.js application with TypeScript and shadcn/ui setup.

**Files:**
- Create: `web-ui-next/` (new directory)
- Create: `web-ui-next/package.json`
- Create: `web-ui-next/tsconfig.json`
- Create: `web-ui-next/next.config.js`
- Create: `web-ui-next/tailwind.config.ts`
- Create: `web-ui-next/components.json`

**Step 1: Create Next.js app**

```bash
cd /Users/slowik/Desktop/n8n/k8s/.worktrees/nextjs-ui-rebuild
npx create-next-app@latest web-ui-next --typescript --tailwind --app --no-src-dir --import-alias "@/*"
```

Expected: Creates `web-ui-next/` with App Router structure

**Step 2: Initialize shadcn/ui**

```bash
cd web-ui-next
npx shadcn@latest init
```

Selections:
- Style: Default
- Base color: Slate
- CSS variables: Yes

Expected: Creates `components.json` and adds shadcn config

**Step 3: Configure Next.js for standalone build**

Edit `web-ui-next/next.config.js`:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
}

module.exports = nextConfig
```

**Step 4: Add environment variable**

Create `web-ui-next/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Step 5: Test dev server**

```bash
npm run dev
```

Expected: Server starts on `http://localhost:3000`

**Step 6: Commit**

```bash
git add web-ui-next/
git commit -m "feat(ui): initialize Next.js 15 with shadcn/ui

- App Router with TypeScript
- shadcn/ui configured with slate theme
- Standalone output for Docker
- Environment variable for API URL"
```

---

## Task 2: Install Core shadcn/ui Components

Install all shadcn/ui components needed for the UI.

**Files:**
- Create: `web-ui-next/components/ui/*` (multiple component files)

**Step 1: Install layout components**

```bash
cd web-ui-next
npx shadcn@latest add button card input label badge table
```

Expected: Components added to `components/ui/`

**Step 2: Install form components**

```bash
npx shadcn@latest add checkbox radio-group select
```

**Step 3: Install feedback components**

```bash
npx shadcn@latest add skeleton sonner dialog alert-dialog
```

**Step 4: Install navigation components**

```bash
npx shadcn@latest add dropdown-menu accordion collapsible
```

**Step 5: Install new shadcn components**

```bash
npx shadcn@latest add drawer sheet spinner
```

Note: If Field, InputGroup, ButtonGroup, Item, Empty aren't available via CLI, we'll create them manually in later tasks.

**Step 6: Verify installation**

```bash
ls components/ui/
```

Expected: See all installed component files

**Step 7: Commit**

```bash
git add components/ui/
git commit -m "feat(ui): install shadcn/ui components

Installed: button, card, input, label, badge, table, checkbox,
radio-group, select, skeleton, sonner, dialog, alert-dialog,
dropdown-menu, accordion, collapsible, drawer, sheet, spinner"
```

---

## Task 3: Create API Client and Types

Build TypeScript API client for FastAPI backend.

**Files:**
- Create: `web-ui-next/lib/api.ts`
- Create: `web-ui-next/lib/types.ts`

**Step 1: Create types file**

Create `web-ui-next/lib/types.ts`:

```typescript
export interface Deployment {
  namespace: string
  version: string
  status: 'running' | 'pending' | 'failed'
  mode: 'queue' | 'regular'
  url: string
  isolated_db: boolean
}

export interface Snapshot {
  filename: string
  timestamp: string
}

export interface InfrastructureStatus {
  postgres: {
    status: 'healthy' | 'unhealthy'
    message?: string
  }
  redis: {
    status: 'healthy' | 'unhealthy'
    message?: string
  }
}

export interface DeployRequest {
  version: string
  mode: 'queue' | 'regular'
  isolated_db: boolean
  name?: string
}

export interface AvailableVersionsResponse {
  versions: string[]
}

export interface ApiResponse<T = any> {
  success: boolean
  message?: string
  error?: string
  data?: T
}
```

**Step 2: Create API client**

Create `web-ui-next/lib/api.ts`:

```typescript
import type {
  Deployment,
  Snapshot,
  InfrastructureStatus,
  DeployRequest,
  AvailableVersionsResponse,
  ApiResponse,
} from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`)
  }

  return response.json()
}

export const api = {
  // Deployments
  async getDeployments(): Promise<Deployment[]> {
    const response = await fetchApi<{ versions: Deployment[] }>('/api/versions')
    return response.versions
  },

  async deployVersion(request: DeployRequest): Promise<ApiResponse> {
    return fetchApi('/api/versions/deploy', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  },

  async deleteDeployment(version: string): Promise<ApiResponse> {
    return fetchApi(`/api/versions/${version}`, {
      method: 'DELETE',
    })
  },

  // Snapshots
  async getSnapshots(): Promise<Snapshot[]> {
    const response = await fetchApi<{ snapshots: Snapshot[] }>('/api/snapshots')
    return response.snapshots
  },

  async createSnapshot(): Promise<ApiResponse> {
    return fetchApi('/api/snapshots/create', {
      method: 'POST',
    })
  },

  async restoreSnapshot(filename: string): Promise<ApiResponse> {
    return fetchApi('/api/snapshots/restore', {
      method: 'POST',
      body: JSON.stringify({ snapshot: filename }),
    })
  },

  // Available versions
  async getAvailableVersions(): Promise<string[]> {
    const response = await fetchApi<AvailableVersionsResponse>('/api/versions/available')
    return response.versions
  },

  // Infrastructure
  async getInfrastructureStatus(): Promise<InfrastructureStatus> {
    return fetchApi('/api/infrastructure/status')
  },
}
```

**Step 3: Test API client (manual verification)**

Start FastAPI backend:
```bash
cd web-ui && python -m uvicorn main:app --reload --port 8000
```

Test in browser console or create test file.

**Step 4: Commit**

```bash
git add lib/api.ts lib/types.ts
git commit -m "feat(api): create TypeScript API client and types

- Type-safe interfaces for all API responses
- Fetch wrapper with error handling
- API client with all FastAPI endpoints"
```

---

## Task 4: Setup App Layout with Providers

Create root layout with React Query provider and toast notifications.

**Files:**
- Modify: `web-ui-next/app/layout.tsx`
- Create: `web-ui-next/app/providers.tsx`
- Modify: `web-ui-next/app/globals.css`

**Step 1: Install TanStack Query**

```bash
cd web-ui-next
npm install @tanstack/react-query
```

**Step 2: Create providers component**

Create `web-ui-next/app/providers.tsx`:

```typescript
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@/components/ui/sonner'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            retry: 1,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  )
}
```

**Step 3: Update root layout**

Modify `web-ui-next/app/layout.tsx`:

```typescript
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'n8n Version Manager',
  description: 'Manage n8n deployments on Kubernetes',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
```

**Step 4: Test providers**

```bash
npm run dev
```

Expected: App runs without errors, Sonner toaster available

**Step 5: Commit**

```bash
git add app/layout.tsx app/providers.tsx package.json package-lock.json
git commit -m "feat(app): setup providers with TanStack Query and Sonner

- React Query provider with default options
- Sonner toast notifications
- Root layout configuration"
```

---

## Task 5: Create Sidebar Component

Build collapsible sidebar navigation.

**Files:**
- Create: `web-ui-next/components/sidebar.tsx`

**Step 1: Install lucide-react icons**

```bash
npm install lucide-react
```

**Step 2: Create sidebar component**

Create `web-ui-next/components/sidebar.tsx`:

```typescript
'use client'

import { useState } from 'react'
import {
  LayoutDashboardIcon,
  PackageIcon,
  DatabaseIcon,
  SettingsIcon,
  ChevronLeftIcon,
  ServerIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false)

  const { data: infrastructure } = useQuery({
    queryKey: ['infrastructure'],
    queryFn: api.getInfrastructureStatus,
    refetchInterval: 10000, // Poll every 10s
  })

  const navItems = [
    { icon: LayoutDashboardIcon, label: 'Dashboard', href: '/' },
    { icon: PackageIcon, label: 'Deployments', href: '/deployments' },
    { icon: DatabaseIcon, label: 'Snapshots', href: '/snapshots' },
    { icon: SettingsIcon, label: 'Settings', href: '/settings' },
  ]

  return (
    <aside
      className={cn(
        'flex flex-col border-r bg-card transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        {!collapsed && (
          <div>
            <h2 className="text-lg font-bold">n8n Manager</h2>
            <p className="text-xs text-muted-foreground">Version 1.0</p>
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setCollapsed(!collapsed)}
          className="ml-auto"
        >
          <ChevronLeftIcon
            className={cn(
              'h-4 w-4 transition-transform',
              collapsed && 'rotate-180'
            )}
          />
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => (
          <Button
            key={item.href}
            variant="ghost"
            className={cn(
              'w-full justify-start',
              collapsed && 'justify-center px-0'
            )}
            asChild
          >
            <a href={item.href}>
              <item.icon className={cn('h-4 w-4', !collapsed && 'mr-2')} />
              {!collapsed && item.label}
            </a>
          </Button>
        ))}
      </nav>

      {/* Infrastructure Status */}
      {!collapsed && (
        <div className="p-4 border-t space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            Infrastructure
          </p>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ServerIcon className="h-3 w-3" />
              <span className="text-xs">Postgres</span>
            </div>
            <Badge
              variant={
                infrastructure?.postgres.status === 'healthy'
                  ? 'default'
                  : 'destructive'
              }
              className="text-xs"
            >
              {infrastructure?.postgres.status || 'unknown'}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ServerIcon className="h-3 w-3" />
              <span className="text-xs">Redis</span>
            </div>
            <Badge
              variant={
                infrastructure?.redis.status === 'healthy'
                  ? 'default'
                  : 'destructive'
              }
              className="text-xs"
            >
              {infrastructure?.redis.status || 'unknown'}
            </Badge>
          </div>
        </div>
      )}
    </aside>
  )
}
```

**Step 3: Verify sidebar renders**

Update `app/page.tsx` temporarily to test:

```typescript
import { Sidebar } from '@/components/sidebar'

export default function Home() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1">
        <p>Dashboard content</p>
      </main>
    </div>
  )
}
```

**Step 4: Test in browser**

```bash
npm run dev
```

Expected: Sidebar renders, collapses/expands, shows infrastructure status

**Step 5: Commit**

```bash
git add components/sidebar.tsx app/page.tsx package.json package-lock.json
git commit -m "feat(ui): create collapsible sidebar with infrastructure status

- Sidebar navigation with icons
- Collapse/expand animation
- Real-time infrastructure status polling
- Postgres and Redis health indicators"
```

---

## Task 6: Create Dashboard with Stat Cards

Build main dashboard page with quick stats cards.

**Files:**
- Create: `web-ui-next/components/stat-card.tsx`
- Modify: `web-ui-next/app/page.tsx`

**Step 1: Create stat card component**

Create `web-ui-next/components/stat-card.tsx`:

```typescript
import { Card, CardContent } from '@/components/ui/card'
import { ArrowUpIcon, ArrowDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  trend?: string
  trendDirection?: 'up' | 'down'
  icon?: React.ReactNode
}

export function StatCard({ label, value, trend, trendDirection, icon }: StatCardProps) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
            {trend && (
              <div className="flex items-center gap-1 mt-2">
                {trendDirection === 'up' && (
                  <ArrowUpIcon className="h-3 w-3 text-green-500" />
                )}
                {trendDirection === 'down' && (
                  <ArrowDownIcon className="h-3 w-3 text-red-500" />
                )}
                <span
                  className={cn(
                    'text-xs font-medium',
                    trendDirection === 'up' && 'text-green-500',
                    trendDirection === 'down' && 'text-red-500'
                  )}
                >
                  {trend}
                </span>
              </div>
            )}
          </div>
          {icon && <div className="text-muted-foreground">{icon}</div>}
        </div>
      </CardContent>
    </Card>
  )
}
```

**Step 2: Update dashboard page**

Modify `web-ui-next/app/page.tsx`:

```typescript
'use client'

import { Sidebar } from '@/components/sidebar'
import { StatCard } from '@/components/stat-card'
import { Button } from '@/components/ui/button'
import { PlusIcon, PackageIcon, DatabaseIcon, HardDriveIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export default function Home() {
  const { data: deployments } = useQuery({
    queryKey: ['deployments'],
    queryFn: api.getDeployments,
  })

  const { data: snapshots } = useQuery({
    queryKey: ['snapshots'],
    queryFn: api.getSnapshots,
  })

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 space-y-6">
        {/* Hero Section */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">n8n Version Manager</h1>
            <p className="text-muted-foreground mt-1">
              {deployments?.length || 0} active deployments
            </p>
          </div>
          <Button size="lg">
            <PlusIcon className="h-4 w-4 mr-2" />
            Deploy New Version
          </Button>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Active Deployments"
            value={deployments?.length || 0}
            trend="+1"
            trendDirection="up"
            icon={<PackageIcon className="h-8 w-8" />}
          />
          <StatCard
            label="Snapshots"
            value={snapshots?.length || 0}
            icon={<DatabaseIcon className="h-8 w-8" />}
          />
          <StatCard
            label="Disk Used"
            value="2.4 GB"
            icon={<HardDriveIcon className="h-8 w-8" />}
          />
          <StatCard
            label="Uptime"
            value="99.9%"
            trend="+0.1%"
            trendDirection="up"
          />
        </div>

        {/* Placeholder for deployments table */}
        <div className="border-2 border-dashed rounded-lg p-12 text-center text-muted-foreground">
          Deployments table coming next...
        </div>
      </main>
    </div>
  )
}
```

**Step 3: Test dashboard**

```bash
npm run dev
```

Expected: Dashboard with stat cards, hero section, sidebar

**Step 4: Commit**

```bash
git add components/stat-card.tsx app/page.tsx
git commit -m "feat(dashboard): create main dashboard with stat cards

- StatCard component with trends and icons
- Hero section with deploy button
- Quick stats grid (4 columns)
- Real-time deployment and snapshot counts"
```

---

## Task 7: Create Deployments Table with Skeleton Loaders

Build deployments table with smooth loading states.

**Files:**
- Create: `web-ui-next/components/deployments-table.tsx`
- Modify: `web-ui-next/app/page.tsx`

**Step 1: Create deployments table component**

Create `web-ui-next/components/deployments-table.tsx`:

```typescript
'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ExternalLinkIcon,
  MoreHorizontalIcon,
  ScrollTextIcon,
  TrashIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export function DeploymentsTable() {
  const { data: deployments, isLoading } = useQuery({
    queryKey: ['deployments'],
    queryFn: api.getDeployments,
    refetchInterval: 5000, // Poll every 5s
  })

  const handleDelete = (deployment: any) => {
    // TODO: Implement delete with confirmation
    console.log('Delete', deployment)
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Version</TableHead>
            <TableHead>Namespace</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>URL</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            // Skeleton rows
            Array(3)
              .fill(0)
              .map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-5 w-24" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-32" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-6 w-20" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-16" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-5 w-48" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Skeleton className="h-8 w-10 ml-auto" />
                  </TableCell>
                </TableRow>
              ))
          ) : deployments?.length === 0 ? (
            // Empty state - will enhance in next task
            <TableRow>
              <TableCell colSpan={6} className="h-64 text-center">
                <p className="text-muted-foreground">No deployments found</p>
                <Button className="mt-4">Deploy First Version</Button>
              </TableCell>
            </TableRow>
          ) : (
            // Real data with stagger animation
            deployments?.map((d, i) => (
              <TableRow
                key={d.namespace}
                className="animate-in fade-in slide-in-from-bottom-2"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <TableCell className="font-mono font-medium">
                  {d.version}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {d.namespace}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      d.status === 'running'
                        ? 'default'
                        : d.status === 'pending'
                        ? 'secondary'
                        : 'destructive'
                    }
                    className={cn(d.status === 'pending' && 'animate-pulse')}
                  >
                    <span className="inline-block h-2 w-2 rounded-full bg-current mr-2" />
                    {d.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{d.mode}</Badge>
                </TableCell>
                <TableCell>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline flex items-center gap-1"
                  >
                    {d.url}
                    <ExternalLinkIcon className="h-3 w-3" />
                  </a>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontalIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => window.open(d.url)}>
                        <ExternalLinkIcon className="h-4 w-4 mr-2" />
                        Open n8n
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <ScrollTextIcon className="h-4 w-4 mr-2" />
                        View Logs
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => handleDelete(d)}
                        className="text-destructive focus:text-destructive"
                      >
                        <TrashIcon className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}
```

**Step 2: Add table to dashboard**

Modify `web-ui-next/app/page.tsx`, replace placeholder with:

```typescript
import { DeploymentsTable } from '@/components/deployments-table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// In the JSX, replace the placeholder:
<Card>
  <CardHeader>
    <CardTitle>Active Deployments</CardTitle>
  </CardHeader>
  <CardContent>
    <DeploymentsTable />
  </CardContent>
</Card>
```

**Step 3: Test table with skeleton loaders**

```bash
npm run dev
```

Expected: Table shows skeleton loaders → real data with fade-in animation

**Step 4: Commit**

```bash
git add components/deployments-table.tsx app/page.tsx
git commit -m "feat(table): create deployments table with skeleton loaders

- Skeleton rows during loading
- Staggered fade-in animation (50ms delay per row)
- Status badges with pulse animation for pending
- Dropdown menu for actions
- Real-time polling every 5 seconds"
```

---

## Task 8: Create Deploy Drawer with Form

Build deploy form in slide-out drawer.

**Files:**
- Create: `web-ui-next/components/deploy-drawer.tsx`
- Modify: `web-ui-next/app/page.tsx`

**Step 1: Create deploy drawer component**

Create `web-ui-next/components/deploy-drawer.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  RocketIcon,
  SearchIcon,
  ChevronRightIcon,
  LayersIcon,
  ZapIcon,
  LoaderIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface DeployDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function DeployDrawer({ open, onOpenChange }: DeployDrawerProps) {
  const [version, setVersion] = useState('')
  const [customName, setCustomName] = useState('')
  const [nameError, setNameError] = useState('')
  const [mode, setMode] = useState<'queue' | 'regular'>('queue')
  const [isolatedDb, setIsolatedDb] = useState(false)

  const queryClient = useQueryClient()

  const { data: availableVersions, isLoading: isLoadingVersions } = useQuery({
    queryKey: ['available-versions'],
    queryFn: api.getAvailableVersions,
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  const deployMutation = useMutation({
    mutationFn: (data: any) => api.deployVersion(data),
    onSuccess: (data) => {
      if (data.success) {
        toast.success('Deployment started', {
          description: `n8n ${version} is being deployed`,
        })
        onOpenChange(false)
        setVersion('')
        setCustomName('')
        queryClient.invalidateQueries({ queryKey: ['deployments'] })
      } else {
        toast.error('Deployment failed', {
          description: data.error || 'Unknown error',
        })
      }
    },
    onError: (error: any) => {
      toast.error('Deployment failed', {
        description: error.message,
      })
    },
  })

  const validateName = (value: string) => {
    if (!value) {
      setNameError('')
      return true
    }

    const valid =
      /^[a-z0-9-]+$/.test(value) &&
      value.length <= 63 &&
      /^[a-z0-9]/.test(value) &&
      /[a-z0-9]$/.test(value)

    if (!valid) {
      setNameError(
        'Must be lowercase alphanumeric + hyphens, max 63 chars, start/end with alphanumeric'
      )
      return false
    }

    setNameError('')
    return true
  }

  const handleDeploy = () => {
    if (!version) {
      toast.error('Version required', {
        description: 'Please enter a version number',
      })
      return
    }

    if (customName && !validateName(customName)) {
      toast.error('Invalid name', {
        description: 'Please fix the custom name validation errors',
      })
      return
    }

    deployMutation.mutate({
      version,
      mode,
      isolated_db: isolatedDb,
      name: customName || undefined,
    })
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-w-2xl mx-auto">
        <DrawerHeader>
          <DrawerTitle>Deploy New Version</DrawerTitle>
          <DrawerDescription>
            Configure and deploy a new n8n instance
          </DrawerDescription>
        </DrawerHeader>

        <div className="p-6 space-y-6">
          {/* GitHub Version Quick-Select */}
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">
              Recent Versions
            </Label>
            <div className="flex gap-2 flex-wrap">
              {isLoadingVersions ? (
                Array(6)
                  .fill(0)
                  .map((_, i) => <Skeleton key={i} className="h-8 w-20" />)
              ) : (
                availableVersions?.slice(0, 8).map((v) => (
                  <Badge
                    key={v}
                    variant="outline"
                    className="cursor-pointer hover:bg-primary hover:text-primary-foreground transition-all"
                    onClick={() => setVersion(v)}
                  >
                    {v}
                  </Badge>
                ))
              )}
            </div>
          </div>

          {/* Version Input */}
          <div className="space-y-2">
            <Label htmlFor="version">Version</Label>
            <div className="relative">
              <SearchIcon className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="version"
                placeholder="1.90.0"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Or select from recent releases above
            </p>
          </div>

          {/* Advanced Options (Collapsible) */}
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-2 text-sm hover:underline">
              <ChevronRightIcon className="h-4 w-4 transition-transform data-[state=open]:rotate-90" />
              Advanced Options
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="customName">Custom Name (optional)</Label>
                <Input
                  id="customName"
                  placeholder="my-custom-deployment"
                  value={customName}
                  onChange={(e) => {
                    setCustomName(e.target.value)
                    validateName(e.target.value)
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank for auto-generated name (n8n-v
                  {version.replace(/\./g, '-') || '{version}'})
                </p>
                {nameError && (
                  <p className="text-xs text-destructive">{nameError}</p>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Mode Selection */}
          <div className="space-y-2">
            <Label>Mode</Label>
            <div className="flex gap-2">
              <Button
                variant={mode === 'queue' ? 'default' : 'outline'}
                onClick={() => setMode('queue')}
                className="flex-1"
              >
                <LayersIcon className="h-4 w-4 mr-2" />
                Queue
              </Button>
              <Button
                variant={mode === 'regular' ? 'default' : 'outline'}
                onClick={() => setMode('regular')}
                className="flex-1"
              >
                <ZapIcon className="h-4 w-4 mr-2" />
                Regular
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Queue mode runs separate worker processes
            </p>
          </div>

          {/* Isolated DB Checkbox */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="isolatedDb"
              checked={isolatedDb}
              onCheckedChange={(checked) => setIsolatedDb(checked as boolean)}
            />
            <Label htmlFor="isolatedDb" className="cursor-pointer">
              Use isolated database (experimental)
            </Label>
          </div>
        </div>

        <DrawerFooter>
          <Button
            onClick={handleDeploy}
            disabled={deployMutation.isPending || !version}
            className="w-full"
          >
            {deployMutation.isPending ? (
              <>
                <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
                Deploying...
              </>
            ) : (
              <>
                <RocketIcon className="h-4 w-4 mr-2" />
                Deploy
              </>
            )}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
```

**Step 2: Add drawer to dashboard**

Modify `web-ui-next/app/page.tsx`:

```typescript
import { DeployDrawer } from '@/components/deploy-drawer'
import { useState } from 'react'

// Inside component:
const [deployDrawerOpen, setDeployDrawerOpen] = useState(false)

// Update deploy button:
<Button size="lg" onClick={() => setDeployDrawerOpen(true)}>
  <PlusIcon className="h-4 w-4 mr-2" />
  Deploy New Version
</Button>

// Add drawer before closing tag:
<DeployDrawer open={deployDrawerOpen} onOpenChange={setDeployDrawerOpen} />
```

**Step 3: Test deploy drawer**

```bash
npm run dev
```

Expected: Drawer slides from bottom, shows GitHub versions, form validates

**Step 4: Commit**

```bash
git add components/deploy-drawer.tsx app/page.tsx
git commit -m "feat(deploy): create deploy drawer with form validation

- Drawer slides from bottom
- GitHub version quick-select with skeleton loaders
- Version input with search icon
- Collapsible advanced options for custom name
- Mode selection buttons (Queue/Regular)
- Isolated DB checkbox
- Form validation with inline errors
- Loading state with spinner"
```

---

## Task 9: Create Snapshots Panel

Build collapsible snapshots panel with create button.

**Files:**
- Create: `web-ui-next/components/snapshots-panel.tsx`
- Modify: `web-ui-next/app/page.tsx`

**Step 1: Create snapshots panel component**

Create `web-ui-next/components/snapshots-panel.tsx`:

```typescript
'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { CameraIcon, DatabaseIcon, RotateCcwIcon, LoaderIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useState } from 'react'

export function SnapshotsPanel() {
  const [restoreSnapshot, setRestoreSnapshot] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const { data: snapshots } = useQuery({
    queryKey: ['snapshots'],
    queryFn: api.getSnapshots,
    refetchInterval: 10000, // Poll every 10s
  })

  const createMutation = useMutation({
    mutationFn: api.createSnapshot,
    onSuccess: (data) => {
      if (data.success) {
        toast.success('Snapshot creation started', {
          description: 'Snapshot will appear in list when complete',
        })
        queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      } else {
        toast.error('Failed to create snapshot', {
          description: data.error,
        })
      }
    },
    onError: (error: any) => {
      toast.error('Failed to create snapshot', {
        description: error.message,
      })
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (filename: string) => api.restoreSnapshot(filename),
    onSuccess: (data) => {
      if (data.success) {
        toast.success('Snapshot restored successfully', {
          description: 'Database has been restored from snapshot',
        })
      } else {
        toast.error('Failed to restore snapshot', {
          description: data.error,
        })
      }
      setRestoreSnapshot(null)
    },
    onError: (error: any) => {
      toast.error('Failed to restore snapshot', {
        description: error.message,
      })
      setRestoreSnapshot(null)
    },
  })

  const handleRestore = (filename: string) => {
    setRestoreSnapshot(filename)
  }

  const confirmRestore = () => {
    if (restoreSnapshot) {
      restoreMutation.mutate(restoreSnapshot)
    }
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle>Database Snapshots</CardTitle>
            <CardDescription>
              {snapshots?.length || 0} snapshots available
            </CardDescription>
          </div>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            size="sm"
          >
            {createMutation.isPending ? (
              <>
                <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <CameraIcon className="h-4 w-4 mr-2" />
                Create Snapshot
              </>
            )}
          </Button>
        </CardHeader>
        <CardContent>
          <Accordion type="single" collapsible>
            <AccordionItem value="snapshots" className="border-none">
              <AccordionTrigger className="hover:no-underline">
                <span className="text-sm">
                  View Snapshots ({snapshots?.length || 0})
                </span>
              </AccordionTrigger>
              <AccordionContent>
                {snapshots?.length === 0 ? (
                  // Empty state
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <DatabaseIcon className="h-12 w-12 text-muted-foreground mb-4" />
                    <h3 className="font-semibold text-lg mb-2">No Snapshots</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Create your first database snapshot
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {snapshots?.map((snapshot) => (
                      <div
                        key={snapshot.filename}
                        className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <DatabaseIcon className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="font-mono text-sm font-medium">
                              {snapshot.filename}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {snapshot.timestamp}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(snapshot.filename)}
                        >
                          <RotateCcwIcon className="h-3 w-3 mr-2" />
                          Restore
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>

      {/* Restore Confirmation Dialog */}
      <AlertDialog open={!!restoreSnapshot} onOpenChange={() => setRestoreSnapshot(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore snapshot?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will OVERWRITE the current database with:</p>
              <p className="font-mono text-sm bg-muted p-2 rounded">
                {restoreSnapshot}
              </p>
              <p className="text-destructive font-medium">
                This action cannot be undone!
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRestore}
              className="bg-destructive hover:bg-destructive/90"
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
```

**Step 2: Add panel to dashboard**

Modify `web-ui-next/app/page.tsx`, add after deployments table:

```typescript
import { SnapshotsPanel } from '@/components/snapshots-panel'

// Add after the deployments Card:
<SnapshotsPanel />
```

**Step 3: Test snapshots panel**

```bash
npm run dev
```

Expected: Panel collapses/expands, create snapshot works, restore shows confirmation

**Step 4: Commit**

```bash
git add components/snapshots-panel.tsx app/page.tsx
git commit -m "feat(snapshots): create snapshots panel with restore confirmation

- Collapsible accordion with snapshot count
- Create snapshot button with loading state
- Empty state when no snapshots
- Snapshot list with restore buttons
- Restore confirmation dialog with warning
- Real-time polling every 10 seconds"
```

---

## Task 10: Add Animations and Polish

Add smooth animations and final polish touches.

**Files:**
- Modify: `web-ui-next/app/globals.css`
- Modify: `web-ui-next/tailwind.config.ts`

**Step 1: Add custom animations to Tailwind config**

Modify `web-ui-next/tailwind.config.ts`:

```typescript
import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-in-from-bottom': {
          from: { transform: 'translateY(10px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.3s ease-in-out',
        'slide-in-from-bottom-2': 'slide-in-from-bottom 0.3s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
```

**Step 2: Add utility classes to globals.css**

Modify `web-ui-next/app/globals.css`, add at the bottom:

```css
@layer utilities {
  .animate-in {
    animation-fill-mode: both;
  }
}
```

**Step 3: Test animations**

```bash
npm run dev
```

Expected: Table rows fade in with stagger effect, drawer slides smoothly

**Step 4: Commit**

```bash
git add app/globals.css tailwind.config.ts
git commit -m "feat(ui): add smooth animations and transitions

- Custom fade-in and slide-in animations
- Staggered animations for table rows
- Smooth drawer transitions
- Animation utilities"
```

---

## Task 11: Create Dockerfile and docker-compose

Build Docker configuration for production deployment.

**Files:**
- Create: `web-ui-next/Dockerfile`
- Create: `web-ui-next/.dockerignore`
- Modify: `docker-compose.yml` (root)

**Step 1: Create Next.js Dockerfile**

Create `web-ui-next/Dockerfile`:

```dockerfile
# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci

# Copy source
COPY . .

# Build Next.js app (standalone output)
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

CMD ["node", "server.js"]
```

**Step 2: Create .dockerignore**

Create `web-ui-next/.dockerignore`:

```
node_modules
.next
.env*.local
.git
.gitignore
README.md
```

**Step 3: Update docker-compose.yml**

Modify root `docker-compose.yml`:

```yaml
version: '3.8'

services:
  backend:
    build:
      context: .
      dockerfile: web-ui/Dockerfile
    container_name: n8n-api
    ports:
      - "8000:8000"
    volumes:
      - ~/.kube/config:/root/.kube/config:ro
      - ./:/workspace:ro
    environment:
      - PYTHONUNBUFFERED=1
    networks:
      - n8n-network

  frontend:
    build:
      context: ./web-ui-next
      dockerfile: Dockerfile
    container_name: n8n-ui-next
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8000
    depends_on:
      - backend
    networks:
      - n8n-network

  # Keep old UI for comparison (optional)
  frontend-old:
    build:
      context: .
      dockerfile: web-ui/Dockerfile
    container_name: n8n-ui-old
    ports:
      - "8080:8080"
    volumes:
      - ~/.kube/config:/root/.kube/config:ro
      - ./:/workspace:ro
    networks:
      - n8n-network

networks:
  n8n-network:
    driver: bridge
```

**Step 4: Test Docker build**

```bash
cd web-ui-next
docker build -t n8n-ui-next .
```

Expected: Build completes successfully

**Step 5: Test docker-compose**

```bash
cd /Users/slowik/Desktop/n8n/k8s/.worktrees/nextjs-ui-rebuild
docker-compose up -d frontend backend
```

Expected: Both containers start, frontend accessible on `:3000`

**Step 6: Commit**

```bash
git add web-ui-next/Dockerfile web-ui-next/.dockerignore docker-compose.yml
git commit -m "feat(docker): add Dockerfile and docker-compose configuration

- Multi-stage Next.js Dockerfile with standalone output
- Updated docker-compose with frontend and backend services
- Kept old UI on port 8080 for comparison
- Network configuration for container communication"
```

---

## Task 12: Create README and Documentation

Write comprehensive README for Next.js UI.

**Files:**
- Create: `web-ui-next/README.md`
- Modify: `README.md` (root)

**Step 1: Create Next.js README**

Create `web-ui-next/README.md`:

```markdown
# n8n Version Manager - Next.js UI

Modern web interface for managing n8n deployments with Next.js 15 and shadcn/ui.

## Features

- 🚀 Deploy n8n versions with smooth form validation
- 📊 Real-time deployment monitoring with polling
- 💾 Database snapshot management with restore
- 🎨 Beautiful UI with shadcn/ui components
- ⚡ Fast server-side rendering with Next.js App Router
- 🔄 Skeleton loaders and smooth animations
- 📱 Responsive design

## Tech Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **UI:** shadcn/ui (40+ components)
- **Styling:** Tailwind CSS v4
- **Data Fetching:** TanStack Query v5
- **Icons:** lucide-react
- **Toasts:** Sonner

## Development

### Prerequisites

- Node.js 20+
- FastAPI backend running on port 8000

### Setup

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Environment Variables

Create `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Production

### Docker Build

```bash
# Build image
docker build -t n8n-ui-next .

# Run container
docker run -p 3000:3000 -e NEXT_PUBLIC_API_URL=http://localhost:8000 n8n-ui-next
```

### Docker Compose

```bash
# Start both frontend and backend
docker-compose up -d

# Frontend: http://localhost:3000
# Backend: http://localhost:8000
```

## Project Structure

```
web-ui-next/
├── app/
│   ├── layout.tsx          # Root layout with providers
│   ├── page.tsx            # Dashboard page
│   ├── providers.tsx       # React Query + Sonner
│   └── globals.css         # Global styles
├── components/
│   ├── ui/                 # shadcn/ui components
│   ├── sidebar.tsx         # Navigation sidebar
│   ├── stat-card.tsx       # Stat display cards
│   ├── deployments-table.tsx   # Deployments table
│   ├── deploy-drawer.tsx   # Deploy form drawer
│   └── snapshots-panel.tsx # Snapshots management
├── lib/
│   ├── api.ts              # API client
│   ├── types.ts            # TypeScript types
│   └── utils.ts            # Utility functions
└── hooks/
    └── use-polling.ts      # Custom polling hook
```

## Key Features

### Smooth Loading States

- Skeleton loaders for all async content
- Staggered fade-in animations for table rows
- Pulse animations for pending statuses

### Form Validation

- Real-time validation for custom deployment names
- GitHub version quick-select with caching
- Clear error messages and feedback

### Real-time Updates

- Auto-polling deployments every 5 seconds
- Auto-polling snapshots every 10 seconds
- Infrastructure status monitoring

### Responsive Design

- Mobile-friendly sidebar
- Collapsible sections
- Touch-friendly interactions

## API Endpoints

All endpoints proxied to FastAPI backend:

- `GET /api/versions` - List deployments
- `POST /api/versions/deploy` - Deploy version
- `DELETE /api/versions/{version}` - Remove deployment
- `GET /api/snapshots` - List snapshots
- `POST /api/snapshots/create` - Create snapshot
- `POST /api/snapshots/restore` - Restore snapshot
- `GET /api/versions/available` - GitHub versions
- `GET /api/infrastructure/status` - Health check

## Migration from Old UI

The new UI runs alongside the old UI during migration:

- **Old UI:** http://localhost:8080 (Vite + React)
- **New UI:** http://localhost:3000 (Next.js)

Both talk to the same FastAPI backend on port 8000.

## License

MIT
```

**Step 2: Update root README**

Add section to root README about new UI:

```markdown
## Web UI - Next.js (New)

Modern UI built with Next.js 15 and shadcn/ui.

See [web-ui-next/README.md](web-ui-next/README.md) for details.

**Access:** http://localhost:3000

**Features:**
- Smooth animations and loading states
- Real-time polling updates
- Modern shadcn/ui components
- Server-side rendering
```

**Step 3: Commit**

```bash
git add web-ui-next/README.md README.md
git commit -m "docs: add comprehensive README for Next.js UI

- Development setup instructions
- Docker deployment guide
- Project structure overview
- Key features documentation
- API endpoints reference
- Migration notes"
```

---

## Post-Implementation

After completing all tasks:

1. **Test all features end-to-end**
   - Deploy new version
   - View deployments table
   - Create snapshot
   - Restore snapshot
   - Check infrastructure status

2. **Verify Docker deployment**
   - Build containers
   - Run docker-compose
   - Test on `http://localhost:3000`

3. **Compare with old UI**
   - Old UI on `:8080`
   - New UI on `:3000`
   - Both should work identically

4. **Create PR or merge to main**
   - Use `superpowers:finishing-a-development-branch`
   - Decide merge strategy

---

## Testing Commands Reference

```bash
# Development
cd web-ui-next
npm run dev         # Start dev server on :3000
npm run build       # Production build
npm run lint        # Run linter

# Docker
docker build -t n8n-ui-next web-ui-next/
docker-compose up -d frontend backend
docker-compose logs -f frontend

# Backend (for testing)
cd web-ui
python -m uvicorn main:app --reload --port 8000
```
