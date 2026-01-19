# Next.js + shadcn/ui Web UI Rebuild Design

**Date:** 2026-01-19
**Goal:** Rebuild web UI with Next.js 15 and latest shadcn/ui for modern, polished user experience

---

## Overview

Complete frontend rewrite using Next.js App Router and shadcn/ui latest components, while keeping the working FastAPI backend intact. Focus on smooth interactions, beautiful loading states, and modern UX patterns.

**Key Drivers:**
- Use latest shadcn/ui components (Field, InputGroup, ButtonGroup, Item, Empty, Spinner)
- Next.js 15 features (App Router, Server Components, Server Actions)
- Better DX with TypeScript throughout
- Smooth, polished UI with proper loading states and micro-interactions

---

## Architecture

### Two-Container Setup

**FastAPI Backend** (existing, unchanged)
- Port 8000
- Handles all kubectl/helm operations via bash scripts
- All existing endpoints remain as-is

**Next.js Frontend** (new)
- Port 3000
- Server-Side Rendering with App Router
- Direct API calls to FastAPI from browser (`http://localhost:8000/api/*`)
- No API route proxy layer (YAGNI)

**Why This Works:**
- FastAPI backend stays 100% unchanged - proven, working code
- Next.js gets full SSR benefits - fast initial loads, modern routing
- Clean separation - can scale independently
- Simple docker-compose orchestration

---

## Technology Stack

**Frontend:**
- Next.js 15 (App Router, Server Components)
- TypeScript
- shadcn/ui latest (Field, InputGroup, ButtonGroup, Item, Empty, Spinner, Sonner)
- TanStack Query v5 (client-side polling and mutations)
- Tailwind CSS v4 (native CSS, no PostCSS)
- lucide-react icons

**Backend:**
- Python 3.11 (existing)
- FastAPI (existing)
- All bash scripts (existing)

**Container:**
- Separate Dockerfiles for frontend and backend
- docker-compose with service networking
- Next.js standalone build for production

---

## Frontend Structure

```
web-ui-next/
├── app/
│   ├── layout.tsx              # Root layout with QueryProvider + Sonner
│   ├── page.tsx                # Main dashboard (Server Component)
│   └── globals.css             # Tailwind + shadcn theme variables
├── components/
│   ├── ui/                     # shadcn components (40+ components)
│   ├── sidebar.tsx             # Collapsible navigation
│   ├── deploy-drawer.tsx       # Deploy form in drawer (slides from right)
│   ├── deployments-table.tsx   # Active versions table with polling
│   ├── snapshots-panel.tsx     # Collapsible snapshot management
│   ├── infrastructure-status.tsx  # Postgres/Redis health
│   └── stat-card.tsx           # Quick stats cards
├── lib/
│   ├── api.ts                  # Fetch wrappers for FastAPI
│   ├── types.ts                # TypeScript interfaces
│   └── utils.ts                # cn() helper
└── hooks/
    └── use-polling.ts          # Custom polling hook
```

---

## UI/UX Design - Smooth & Beautiful

### Layout Strategy

**Sidebar Navigation:**
- Collapsible sidebar (always visible)
- Logo + version at top
- Nav items: Dashboard, Deployments, Snapshots, Settings
- Infrastructure status badges at bottom (compact)
- Smooth collapse animation

**Main Content Area:**
- Header with page title + primary action
- Quick stats cards (4-column grid)
- Main content cards
- All sections have smooth height transitions

### Loading States - Everything Has a State

**1. Page Load (Server Component)**
- Fetch initial data server-side
- Hydrate with real data immediately
- No blank screen ever

**2. Skeleton Loaders**
```tsx
// While loading, show structure
<Card>
  <CardHeader>
    <Skeleton className="h-6 w-48" /> {/* Title */}
  </CardHeader>
  <CardContent>
    <Skeleton className="h-64 w-full" /> {/* Content */}
  </CardContent>
</Card>
```

**3. Optimistic Updates**
- Deploy → instantly add "Deploying..." row to table
- Delete → fade out row, show undo toast
- Snapshot create → "Creating..." item appears immediately

**4. Micro-interactions**
- Button states: idle → loading (spinner) → success (checkmark, 2s) → idle
- Smooth height transitions on Collapsible
- Pulse animation on status badges during polling
- Staggered fade-in for table rows (50ms delay each)

---

## Component Details

### Dashboard Page (`app/page.tsx`)

```tsx
<div className="flex min-h-screen">
  <Sidebar />

  <main className="flex-1 p-8 space-y-6">
    {/* Hero Section */}
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-3xl font-bold">n8n Version Manager</h1>
        <p className="text-muted-foreground">3 active deployments</p>
      </div>
      <Button onClick={openDeployDrawer}>
        <PlusIcon /> Deploy New Version
      </Button>
    </div>

    {/* Quick Stats */}
    <div className="grid grid-cols-4 gap-4">
      <StatCard label="Active" value="3" trend="+1" />
      <StatCard label="Snapshots" value="12" />
      <StatCard label="Disk Used" value="2.4 GB" />
      <StatCard label="Uptime" value="99.9%" />
    </div>

    {/* Deployments Table */}
    <Card>
      <CardHeader>
        <CardTitle>Active Deployments</CardTitle>
      </CardHeader>
      <CardContent>
        <DeploymentsTable />
      </CardContent>
    </Card>

    {/* Snapshots Panel (collapsible) */}
    <SnapshotsPanel />
  </main>
</div>
```

### Deploy Drawer (`components/deploy-drawer.tsx`)

**Features:**
- Slides from right (Sheet/Drawer component)
- GitHub version quick-select with skeleton loaders
- Version input with search icon (InputGroup)
- Collapsible "Advanced Options" for custom name
- Mode selection with ButtonGroup (Queue/Regular)
- Isolated DB checkbox
- Deploy button with loading state and spinner

```tsx
<Drawer open={isOpen} onOpenChange={setIsOpen}>
  <DrawerContent className="max-w-2xl">
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
            Array(6).fill(0).map((_, i) => (
              <Skeleton key={i} className="h-8 w-20" />
            ))
          ) : (
            versions.map(v => (
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
      <Field>
        <FieldLabel>Version</FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon className="h-4 w-4" />
          </InputGroupAddon>
          <Input
            placeholder="1.90.0"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
          />
        </InputGroup>
        <FieldDescription>
          Or select from recent releases above
        </FieldDescription>
      </Field>

      {/* Advanced Options (Collapsible) */}
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm">
          <ChevronRightIcon className="h-4 w-4 transition-transform data-[state=open]:rotate-90" />
          Advanced Options
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-4 space-y-4">
          <Field>
            <FieldLabel>Custom Name (optional)</FieldLabel>
            <Input
              placeholder="my-custom-deployment"
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
            />
            <FieldDescription>
              Leave blank for auto-generated name (n8n-v{version})
            </FieldDescription>
            {nameError && (
              <FieldError>{nameError}</FieldError>
            )}
          </Field>
        </CollapsibleContent>
      </Collapsible>

      {/* Mode Selection */}
      <Field>
        <FieldLabel>Mode</FieldLabel>
        <ButtonGroup className="w-full">
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
        </ButtonGroup>
        <FieldDescription>
          Queue mode runs separate worker processes
        </FieldDescription>
      </Field>

      {/* Isolated DB Checkbox */}
      <div className="flex items-center space-x-2">
        <Checkbox
          id="isolatedDb"
          checked={isolatedDb}
          onCheckedChange={setIsolatedDb}
        />
        <Label htmlFor="isolatedDb" className="cursor-pointer">
          Use isolated database (experimental)
        </Label>
      </div>
    </div>

    <DrawerFooter>
      <Button
        onClick={handleDeploy}
        disabled={isDeploying || !version}
        className="w-full"
      >
        {isDeploying ? (
          <>
            <Spinner className="mr-2" />
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
```

### Deployments Table (`components/deployments-table.tsx`)

**Features:**
- Server Component initial render with data
- Client Component for polling and mutations
- Skeleton rows while loading (3-4 shimmer rows)
- Empty state with call-to-action
- Staggered fade-in animation for rows
- Status badges with pulse animation during polling
- Dropdown menu for actions (Open, Logs, Delete)

```tsx
'use client'

export function DeploymentsTable() {
  const { data: deployments, isLoading } = useQuery({
    queryKey: ['deployments'],
    queryFn: api.getDeployments,
    refetchInterval: 5000, // Poll every 5s
  })

  return (
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
          Array(3).fill(0).map((_, i) => (
            <TableRow key={i}>
              <TableCell><Skeleton className="h-5 w-24" /></TableCell>
              <TableCell><Skeleton className="h-5 w-32" /></TableCell>
              <TableCell><Skeleton className="h-6 w-20" /></TableCell>
              <TableCell><Skeleton className="h-5 w-16" /></TableCell>
              <TableCell><Skeleton className="h-5 w-48" /></TableCell>
              <TableCell><Skeleton className="h-8 w-10 ml-auto" /></TableCell>
            </TableRow>
          ))
        ) : deployments?.length === 0 ? (
          // Empty state
          <TableRow>
            <TableCell colSpan={6} className="h-64">
              <Empty>
                <EmptyIcon>
                  <PackageIcon className="h-12 w-12" />
                </EmptyIcon>
                <EmptyTitle>No Deployments</EmptyTitle>
                <EmptyDescription>
                  Deploy your first n8n version to get started
                </EmptyDescription>
                <Button onClick={openDeployDrawer}>
                  <PlusIcon className="h-4 w-4 mr-2" />
                  Deploy Version
                </Button>
              </Empty>
            </TableCell>
          </TableRow>
        ) : (
          // Real data with stagger animation
          deployments.map((d, i) => (
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
                    d.status === 'running' ? 'success' :
                    d.status === 'pending' ? 'warning' :
                    'destructive'
                  }
                  className={d.status === 'pending' ? 'animate-pulse' : ''}
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
                    <DropdownMenuItem onClick={() => viewLogs(d)}>
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
  )
}
```

### Snapshots Panel (`components/snapshots-panel.tsx`)

**Features:**
- Collapsible accordion (shows count in header)
- "Create Snapshot Now" button with loading state
- Item component for each snapshot
- Restore confirmation dialog
- Empty state when no snapshots

```tsx
'use client'

export function SnapshotsPanel() {
  const { data: snapshots } = useQuery({
    queryKey: ['snapshots'],
    queryFn: api.getSnapshots,
    refetchInterval: 10000, // Poll every 10s
  })

  const createMutation = useMutation({
    mutationFn: api.createSnapshot,
    onSuccess: () => {
      toast.success('Snapshot creation started')
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
    },
  })

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
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
            <><Spinner className="mr-2" /> Creating...</>
          ) : (
            <><CameraIcon className="h-4 w-4 mr-2" /> Create Snapshot</>
          )}
        </Button>
      </CardHeader>
      <CardContent>
        <Accordion type="single" collapsible>
          <AccordionItem value="snapshots">
            <AccordionTrigger>
              View Snapshots ({snapshots?.length || 0})
            </AccordionTrigger>
            <AccordionContent>
              {snapshots?.length === 0 ? (
                <Empty className="py-8">
                  <EmptyIcon>
                    <DatabaseIcon className="h-8 w-8" />
                  </EmptyIcon>
                  <EmptyTitle>No Snapshots</EmptyTitle>
                  <EmptyDescription>
                    Create your first database snapshot
                  </EmptyDescription>
                </Empty>
              ) : (
                <div className="space-y-2">
                  {snapshots.map((snapshot) => (
                    <Item key={snapshot.filename}>
                      <ItemHeader>
                        <DatabaseIcon className="h-4 w-4" />
                        <ItemTitle className="font-mono">
                          {snapshot.filename}
                        </ItemTitle>
                      </ItemHeader>
                      <ItemDescription>
                        {snapshot.timestamp}
                      </ItemDescription>
                      <ItemActions>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(snapshot)}
                        >
                          <RotateCcwIcon className="h-4 w-4 mr-2" />
                          Restore
                        </Button>
                      </ItemActions>
                    </Item>
                  ))}
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  )
}
```

---

## Docker Setup

### docker-compose.yml

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
    container_name: n8n-ui
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:8000
    depends_on:
      - backend
    networks:
      - n8n-network

networks:
  n8n-network:
    driver: bridge
```

### Frontend Dockerfile (Next.js Standalone)

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

### next.config.js

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone', // For Docker deployment
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
}

module.exports = nextConfig
```

---

## Migration Strategy

### Phase 1: Parallel Development (Week 1)
- Create `web-ui-next/` folder
- Initialize Next.js with shadcn/ui
- Old UI continues running on `:8080`
- New UI runs on `:3000`
- Both talk to same FastAPI backend on `:8000`

### Phase 2: Feature Parity (Week 2)
- Port deploy form with all 3 features
- Port deployments table
- Port snapshots panel
- Port infrastructure status
- Add new polish (skeletons, animations, empty states)
- Side-by-side testing

### Phase 3: Switchover (Week 3)
- Update docker-compose to expose new UI on `:8080`
- Old UI accessible on `:8081` as backup
- Monitor for issues
- Gather feedback

### Phase 4: Cleanup (Week 4)
- Remove `web-ui/frontend/` Vite app
- Keep `web-ui/api/` FastAPI backend unchanged
- Update README with new setup instructions
- Archive old UI code in git history

---

## shadcn/ui Components Needed

Install these components:
```bash
npx shadcn@latest add button card input label badge
npx shadcn@latest add table skeleton dropdown-menu
npx shadcn@latest add dialog drawer sheet accordion
npx shadcn@latest add checkbox radio-group
npx shadcn@latest add field input-group button-group
npx shadcn@latest add item empty spinner
npx shadcn@latest add sonner  # Toast notifications
```

---

## Development Setup

### Prerequisites
- Node.js 20+
- Python 3.11+
- Docker Desktop with Kubernetes

### Local Development

**Terminal 1: Backend**
```bash
cd web-ui
python -m uvicorn main:app --reload --port 8000
```

**Terminal 2: Frontend**
```bash
cd web-ui-next
npm install
npm run dev  # Runs on port 3000
```

**Terminal 3: Docker (Optional)**
```bash
docker-compose up
```

### Environment Variables

**`.env.local` (frontend):**
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

**Production (docker-compose):**
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

## Testing Checklist

### Functionality
- [ ] Deploy new version (all modes and options)
- [ ] View active deployments
- [ ] Delete deployment with confirmation
- [ ] Create manual snapshot
- [ ] Restore from snapshot
- [ ] GitHub version discovery
- [ ] Infrastructure status monitoring

### UX/Performance
- [ ] Initial page load < 1s
- [ ] Skeleton loaders show immediately
- [ ] Smooth animations (60fps)
- [ ] Responsive on mobile/tablet
- [ ] Keyboard navigation works
- [ ] Toast notifications appear correctly
- [ ] Empty states are helpful
- [ ] Error states are clear

### Browser Compatibility
- [ ] Chrome/Edge (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)

---

## Future Enhancements (Out of Scope)

- Dark mode toggle
- Deployment logs viewer in UI
- Real-time WebSocket updates
- Resource usage charts
- Deployment history timeline
- Scheduled snapshots
- Snapshot size/cleanup management
- Multiple cluster support
- User authentication
