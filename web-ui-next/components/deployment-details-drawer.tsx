'use client'

import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  useNamespacePods,
  useDeploymentEvents,
  useNamespaceLogs,
  useDeploymentConfig,
  useSnapshots,
  useRestoreSnapshot,
} from '@/lib/grpc-hooks'
import type { PodStatus, ContainerStatus } from '@/lib/grpc-client'
import type { DeploymentDisplay } from '@/lib/types'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RefreshButton } from '@/components/refresh-button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Input } from '@/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  CheckCircleIcon,
  AlertCircleIcon,
  ClockIcon,
  BoxIcon,
  ScrollTextIcon,
  ActivityIcon,
  SettingsIcon,
  CopyIcon,
  DatabaseIcon,
  LoaderIcon,
  AlertTriangleIcon,
  SearchIcon,
  XIcon,
  PencilIcon,
  LayersIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { addActivity } from '@/lib/activity'

interface DeploymentDetailsDrawerProps {
  deployment: DeploymentDisplay | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatRelativeTime(timestamp: string | undefined): string {
  if (!timestamp) return '-'
  const date = new Date(timestamp)
  const now = new Date()
  const diffSecs = Math.floor((now.getTime() - date.getTime()) / 1000)
  const diffMins = Math.floor(diffSecs / 60)
  const diffHours = Math.floor(diffMins / 60)

  if (diffHours > 0) return `${diffHours}h ago`
  if (diffMins > 0) return `${diffMins}m ago`
  return `${diffSecs}s ago`
}

function StatusTab({ namespace, enabled }: { namespace: string; enabled: boolean }) {
  const [selectedSnapshot, setSelectedSnapshot] = useState<string>('')
  const [showRestoreWarning, setShowRestoreWarning] = useState(false)
  const queryClient = useQueryClient()

  const { data: pods, isLoading, refetch, isFetching } = useNamespacePods(namespace, {
    staleTime: 5_000,
    refetchInterval: enabled ? 5_000 : false,
    enabled,
  })

  // Snapshots are prefetched on page load, so no enabled check needed
  const { data: snapshots, isLoading: snapshotsLoading } = useSnapshots({
    staleTime: 30_000,
  })

  const { restore, isRestoring } = useRestoreSnapshot({
    onSuccess: () => {
      toast.success('Snapshot restored', {
        description: `Database restored to ${namespace}`,
      })
      addActivity('restored', `${selectedSnapshot} → ${namespace}`)
      queryClient.invalidateQueries({ queryKey: ['grpc', 'deployments'] })
      setSelectedSnapshot('')
      setShowRestoreWarning(false)
    },
    onError: (error: Error) => {
      toast.error('Restore failed', {
        description: error.message,
      })
    },
  })

  const handleRestore = () => {
    if (selectedSnapshot) {
      restore({ snapshotName: selectedSnapshot, targetNamespace: namespace })
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="border rounded-lg p-3">
            <Skeleton className="h-5 w-32 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
        ))}
      </div>
    )
  }

  const podList = pods || []
  const snapshotList = snapshots || []

  return (
    <div className="space-y-6">
      {/* Pods Section */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">
            {podList.length} pod{podList.length !== 1 ? 's' : ''}
          </span>
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
        </div>

        {podList.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No pods found
          </div>
        ) : (
          <div className="space-y-3">
            {podList.map((pod: PodStatus) => (
              <div key={pod.name} className="border rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <BoxIcon className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono text-sm font-medium">{pod.name}</span>
                </div>
                <Badge
                  variant={
                    pod.phase === 'Running'
                      ? 'default'
                      : pod.phase === 'Failed'
                      ? 'destructive'
                      : 'secondary'
                  }
                >
                  {pod.phase}
                </Badge>
              </div>
              {pod.containers.map((container: ContainerStatus) => (
                <div
                  key={container.name}
                  className="ml-6 flex items-center gap-2 text-sm text-muted-foreground"
                >
                  {container.ready ? (
                    <CheckCircleIcon className="h-3 w-3 text-green-500" />
                  ) : (
                    <AlertCircleIcon className="h-3 w-3 text-yellow-500" />
                  )}
                  <span>{container.name}</span>
                  <span className="text-xs">
                    ({container.state}
                    {container.stateDetail && `: ${container.stateDetail}`})
                  </span>
                  {container.restartCount > 0 && (
                    <Badge variant="outline" className="text-xs">
                      {container.restartCount} restart{container.restartCount !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </div>
              ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Database Section */}
      <div className="border-t pt-4">
        <div className="flex items-center gap-2 mb-3">
          <DatabaseIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Database</span>
        </div>

        <div className="space-y-3">
          <div className="flex gap-2">
            {snapshotsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderIcon className="h-4 w-4 animate-spin" />
                Loading snapshots...
              </div>
            ) : snapshotList.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No snapshots available
              </div>
            ) : (
              <>
                <Select value={selectedSnapshot} onValueChange={(v) => {
                  setSelectedSnapshot(v)
                  setShowRestoreWarning(!!v)
                }}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select snapshot to restore..." />
                  </SelectTrigger>
                  <SelectContent>
                    {snapshotList.map((snapshot) => (
                      <SelectItem key={snapshot.name} value={snapshot.name}>
                        {snapshot.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  onClick={handleRestore}
                  disabled={!selectedSnapshot || isRestoring}
                  variant="destructive"
                  size="sm"
                >
                  {isRestoring ? (
                    <>
                      <LoaderIcon className="h-4 w-4 mr-1 animate-spin" />
                      Restoring...
                    </>
                  ) : (
                    'Restore'
                  )}
                </Button>
              </>
            )}
          </div>

          {showRestoreWarning && selectedSnapshot && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertTriangleIcon className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                This will <strong>overwrite</strong> the current database. This action cannot be undone.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EventsTab({ namespace, enabled }: { namespace: string; enabled: boolean }) {
  const { data: events, isLoading, refetch, isFetching } = useDeploymentEvents(namespace, 50, {
    staleTime: 5_000,
    refetchInterval: enabled ? 5_000 : false,
    enabled,
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    )
  }

  const eventList = events || []

  // Helper to format proto timestamp
  const formatEventTime = (event: typeof eventList[number]) => {
    if (event.lastTimestamp) {
      return formatRelativeTime(new Date(Number(event.lastTimestamp.seconds) * 1000).toISOString())
    }
    return '-'
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">
          {eventList.length} event{eventList.length !== 1 ? 's' : ''}
        </span>
        <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
      </div>

      {eventList.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No events found
        </div>
      ) : (
        <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
          {eventList.map((event, i: number) => (
            <div
              key={`${event.reason}-${i}`}
              className="flex items-start gap-2 text-sm border-l-2 pl-2 py-1"
              style={{
                borderColor: event.type === 'Warning' ? 'rgb(234, 179, 8)' : 'rgb(34, 197, 94)',
              }}
            >
              <div className="flex items-center gap-1 text-muted-foreground min-w-[60px]">
                <ClockIcon className="h-3 w-3" />
                <span className="text-xs">{formatEventTime(event)}</span>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={event.type === 'Warning' ? 'destructive' : 'secondary'}
                    className="text-xs"
                  >
                    {event.reason}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {event.object}
                  </span>
                  {event.count > 1 && (
                    <span className="text-xs text-muted-foreground">
                      (x{event.count})
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1 break-words">
                  {event.message}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const ALL_PODS = '__all_pods__'
const ALL_CONTAINERS = '__all_containers__'

function LogsTab({ namespace, enabled }: { namespace: string; enabled: boolean }) {
  const [selectedPod, setSelectedPod] = useState<string>(ALL_PODS)
  const [selectedContainer, setSelectedContainer] = useState<string>(ALL_CONTAINERS)

  const { data: pods } = useNamespacePods(namespace, {
    enabled, // Reuse pods data from StatusTab if already fetched
  })

  const actualPod = selectedPod === ALL_PODS ? undefined : selectedPod
  const actualContainer = selectedContainer === ALL_CONTAINERS ? undefined : selectedContainer

  const { data: logs, isLoading, refetch, isFetching } = useNamespaceLogs(namespace, {
    podName: actualPod,
    container: actualContainer,
    staleTime: 5_000,
    refetchInterval: enabled ? 5_000 : false,
    enabled,
  })

  const podList = pods || []
  const logList = logs || []

  const selectedPodData = podList.find((p) => p.name === selectedPod)
  const containers = selectedPodData?.containers || []

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <Select value={selectedPod} onValueChange={(v) => {
          setSelectedPod(v)
          setSelectedContainer(ALL_CONTAINERS)
        }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All pods" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_PODS}>All pods</SelectItem>
            {podList.map((pod) => (
              <SelectItem key={pod.name} value={pod.name}>
                {pod.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedPod !== ALL_PODS && containers.length > 1 && (
          <Select value={selectedContainer} onValueChange={setSelectedContainer}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All containers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CONTAINERS}>All containers</SelectItem>
              {containers.map((c) => (
                <SelectItem key={c.name} value={c.name}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <RefreshButton onClick={() => refetch()} isLoading={isFetching} className="ml-auto" />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : logList.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No logs available
        </div>
      ) : (
        <div className="space-y-4">
          {logList.map((log) => (
            <div key={log.pod} className="space-y-1">
              {logList.length > 1 && (
                <div className="text-xs font-medium text-muted-foreground">
                  {log.pod}
                  {log.container && ` / ${log.container}`}
                </div>
              )}
              {log.error ? (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                  {log.error}
                </div>
              ) : (
                <pre className="text-xs bg-muted p-4 rounded-lg overflow-x-auto max-h-[300px] overflow-y-auto font-mono whitespace-pre-wrap break-words">
                  {log.logs || 'No logs'}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Category configuration for grouping environment variables
const CATEGORY_CONFIG = {
  database: { label: 'Database', icon: DatabaseIcon, order: 1 },
  queue: { label: 'Queue', icon: LayersIcon, order: 2 },
  n8n: { label: 'n8n Core', icon: SettingsIcon, order: 3 },
  diagnostics: { label: 'Diagnostics', icon: ActivityIcon, order: 4 },
  extra: { label: 'Extra', icon: BoxIcon, order: 5 },
} as const

type CategoryKey = keyof typeof CATEGORY_CONFIG

// Determine category for an environment variable key
function getEnvCategory(key: string): CategoryKey {
  const upperKey = key.toUpperCase()
  if (upperKey.startsWith('DB_') || upperKey.startsWith('DATABASE_') || upperKey.includes('POSTGRES')) {
    return 'database'
  }
  if (upperKey.startsWith('QUEUE_') || upperKey.startsWith('REDIS_') || upperKey.startsWith('BULL_') || upperKey === 'EXECUTIONS_MODE') {
    return 'queue'
  }
  if (upperKey.includes('DIAGNOSTICS') || upperKey.includes('LOG_LEVEL')) {
    return 'diagnostics'
  }
  if (upperKey.startsWith('N8N_') || upperKey === 'WEBHOOK_URL' || upperKey === 'GENERIC_TIMEZONE' || upperKey === 'TZ') {
    return 'n8n'
  }
  return 'extra'
}

function ConfigRow({ envKey, value }: { envKey: string; value: string }) {
  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  const handleEditClick = () => {
    toast.info('Coming soon', {
      description: 'Environment variable editing will be available in a future update.',
    })
  }

  return (
    <div className="flex items-start gap-2 py-2 border-b last:border-b-0 group">
      <div className="min-w-[140px] text-sm font-medium text-muted-foreground truncate">
        {envKey}
      </div>
      <div className="flex-1 flex items-center gap-2">
        <code className="text-sm font-mono bg-muted px-2 py-0.5 rounded break-all flex-1">
          {value}
        </code>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => copyToClipboard(value)}
              >
                <CopyIcon className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy value</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={handleEditClick}
              >
                <PencilIcon className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Edit (coming soon)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

function ConfigTab({ namespace, enabled }: { namespace: string; enabled: boolean }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [openCategories, setOpenCategories] = useState<string[]>(['database', 'n8n'])

  const { data, isLoading, refetch, isFetching } = useDeploymentConfig(namespace, {
    staleTime: 30_000,
    enabled,
  })

  // Group and filter entries by category
  const { categorizedEntries, totalFiltered, totalCount } = useMemo(() => {
    const config = data?.config || {}
    const entries = Object.entries(config)
    const totalCount = entries.length

    // Filter by search query
    const filtered = searchQuery
      ? entries.filter(([key, value]) =>
          key.toLowerCase().includes(searchQuery.toLowerCase()) ||
          value.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : entries

    // Group by category
    const categories: Record<CategoryKey, [string, string][]> = {
      database: [],
      queue: [],
      n8n: [],
      diagnostics: [],
      extra: [],
    }

    filtered.forEach(([key, value]) => {
      const category = getEnvCategory(key)
      categories[category].push([key, value])
    })

    // Sort entries within each category
    Object.values(categories).forEach(arr => arr.sort(([a], [b]) => a.localeCompare(b)))

    return { categorizedEntries: categories, totalFiltered: filtered.length, totalCount }
  }, [data, searchQuery])

  const allCategoryKeys = Object.keys(CATEGORY_CONFIG)
  const nonEmptyCategories = allCategoryKeys.filter(key => categorizedEntries[key as CategoryKey].length > 0)

  const handleToggleAll = () => {
    if (openCategories.length === nonEmptyCategories.length) {
      setOpenCategories([])
    } else {
      setOpenCategories(nonEmptyCategories)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header with count and refresh */}
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">
          {searchQuery ? `${totalFiltered} of ${totalCount}` : totalCount} variable{totalCount !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleToggleAll}>
            {openCategories.length === nonEmptyCategories.length ? 'Collapse all' : 'Expand all'}
          </Button>
          <RefreshButton onClick={() => refetch()} isLoading={isFetching} />
        </div>
      </div>

      {/* Search input */}
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter variables..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9 pr-8"
        />
        {searchQuery && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
            onClick={() => setSearchQuery('')}
          >
            <XIcon className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Empty states */}
      {totalCount === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No configuration found
        </div>
      ) : totalFiltered === 0 && searchQuery ? (
        <div className="text-center py-8 text-muted-foreground">
          No variables match &quot;{searchQuery}&quot;
        </div>
      ) : (
        /* Accordion categories */
        <Accordion
          type="multiple"
          value={openCategories}
          onValueChange={setOpenCategories}
          className="space-y-2"
        >
          {(Object.entries(CATEGORY_CONFIG) as [CategoryKey, typeof CATEGORY_CONFIG[CategoryKey]][])
            .sort(([, a], [, b]) => a.order - b.order)
            .map(([categoryKey, { label, icon: Icon }]) => {
              const entries = categorizedEntries[categoryKey]
              if (entries.length === 0) return null

              return (
                <AccordionItem key={categoryKey} value={categoryKey} className="border rounded-lg px-4">
                  <AccordionTrigger className="py-3 hover:no-underline">
                    <div className="flex items-center gap-2 flex-1">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{label}</span>
                      <Badge variant="secondary" className="ml-auto mr-2">
                        {entries.length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pb-3">
                    <div className="space-y-0">
                      {entries.map(([key, value]) => (
                        <ConfigRow key={key} envKey={key} value={value} />
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )
            })}
        </Accordion>
      )}
    </div>
  )
}

export function DeploymentDetailsDrawer({
  deployment,
  open,
  onOpenChange,
}: DeploymentDetailsDrawerProps) {
  const [activeTab, setActiveTab] = useState('status')

  // Reset to status tab when drawer closes or deployment changes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setActiveTab('status')
    }
    onOpenChange(newOpen)
  }

  if (!deployment) return null

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            n8n v{deployment.version}
            {deployment.name && (
              <span className="text-muted-foreground font-normal">
                - {deployment.name}
              </span>
            )}
          </SheetTitle>
          <SheetDescription>
            {deployment.namespace} • {deployment.mode} mode
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
            <TabsList className="w-full">
              <TabsTrigger value="status" className="flex-1">
                <BoxIcon className="h-4 w-4 mr-1" />
                Status
              </TabsTrigger>
              <TabsTrigger value="events" className="flex-1">
                <ActivityIcon className="h-4 w-4 mr-1" />
                Events
              </TabsTrigger>
              <TabsTrigger value="logs" className="flex-1">
                <ScrollTextIcon className="h-4 w-4 mr-1" />
                Logs
              </TabsTrigger>
              <TabsTrigger value="config" className="flex-1">
                <SettingsIcon className="h-4 w-4 mr-1" />
                Config
              </TabsTrigger>
            </TabsList>

            <TabsContent value="status" className="mt-4">
              <StatusTab namespace={deployment.namespace} enabled={activeTab === 'status'} />
            </TabsContent>

            <TabsContent value="events" className="mt-4">
              <EventsTab namespace={deployment.namespace} enabled={activeTab === 'events'} />
            </TabsContent>

            <TabsContent value="logs" className="mt-4">
              <LogsTab namespace={deployment.namespace} enabled={activeTab === 'logs'} />
            </TabsContent>

            <TabsContent value="config" className="mt-4">
              <ConfigTab namespace={deployment.namespace} enabled={activeTab === 'config'} />
            </TabsContent>
          </Tabs>
        </div>
      </SheetContent>
    </Sheet>
  )
}
