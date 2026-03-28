'use client'

import { useState, useEffect, useMemo } from 'react'
import { Sidebar } from '@/components/sidebar'
import { DeploymentsTable } from '@/components/deployments-table'
import { DeployDrawer } from '@/components/deploy-drawer'
import { SnapshotsPanel } from '@/components/snapshots-panel'
import { ErrorBoundary } from '@/components/error-boundary'
import { InfrastructureStatus } from '@/components/infrastructure-status'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useDeployments, useSnapshots, useAvailableVersions } from '@/lib/grpc-hooks'
import { QUERY_CONFIG } from '@/lib/query-config'
import { timestampDate } from '@bufbuild/protobuf/wkt'
import type { Deployment as ProtoDeployment, Snapshot as ProtoSnapshot } from '@/lib/generated/n8n_manager/v1/common_pb'
import type { DeploymentDisplay, SnapshotDisplay } from '@/lib/types'

// Adapter: Convert proto Deployment to component display type
function mapProtoDeployment(proto: ProtoDeployment): DeploymentDisplay {
  return {
    namespace: proto.namespace,
    version: proto.version,
    status: proto.status || 'unknown',
    mode: proto.mode || '',
    url: proto.url || undefined,
    phase: proto.phase?.phase,
    phase_info: proto.phase ? {
      phase: proto.phase.phase || 'unknown',
      label: proto.phase.label,
      pods_ready: proto.phase.pods?.filter(p => p.ready).length,
      pods_total: proto.phase.pods?.length,
    } : undefined,
    created_at: proto.createdAt ? timestampDate(proto.createdAt).toISOString() : undefined,
  }
}

// Adapter: Convert proto Snapshot to component display type
function mapProtoSnapshot(proto: ProtoSnapshot): SnapshotDisplay {
  const createdIso = proto.createdAt ? timestampDate(proto.createdAt).toISOString() : undefined
  return {
    filename: proto.name, // Use name as filename
    name: proto.name,
    type: 'named', // gRPC snapshots are always named
    source: proto.sourceNamespace || undefined,
    size: proto.sizeBytes ? formatBytes(Number(proto.sizeBytes)) : undefined,
    created: createdIso,
    timestamp: createdIso,
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function LiveIndicator({ isConnected }: { isConnected: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? 'bg-emerald-500' : 'bg-red-500'}`} />
      </span>
      <span>{isConnected ? 'Live' : 'Disconnected'}</span>
    </div>
  )
}

export default function Home() {
  const [deployDrawerOpen, setDeployDrawerOpen] = useState(false)

  // Keyboard shortcut: N to open deploy drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input/textarea or if modifier keys pressed
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setDeployDrawerOpen(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const { data: protoDeployments, isLoading: isLoadingDeployments, isError: isErrorDeployments, refetch: refetchDeployments } = useDeployments({
    staleTime: QUERY_CONFIG.deployments.staleTime,
    // Smart polling: faster when pending deployments exist, slower when all stable
    refetchInterval: (query) => {
      const data = query.state.data
      const hasPending = data?.some((d) => d.status === 'pending')
      return hasPending
        ? QUERY_CONFIG.deployments.refetchIntervalPending
        : QUERY_CONFIG.deployments.refetchInterval
    },
  })

  const { data: protoSnapshots, isLoading: isLoadingSnapshots, isError: isErrorSnapshots, refetch: refetchSnapshots } = useSnapshots({
    staleTime: QUERY_CONFIG.snapshots.staleTime,
    refetchInterval: QUERY_CONFIG.snapshots.refetchInterval,
  })

  // Map proto types to component-expected types
  // TODO: Remove these adapters once components use proto types directly
  const deployments = useMemo(
    () => protoDeployments?.map(mapProtoDeployment),
    [protoDeployments]
  )

  const snapshots = useMemo(
    () => protoSnapshots?.map(mapProtoSnapshot),
    [protoSnapshots]
  )

  // Prefetch data needed for deploy drawer - loads in background on page load
  useAvailableVersions({
    staleTime: QUERY_CONFIG.availableVersions.staleTime,
  })

  // Named snapshots are filtered from all snapshots (no separate gRPC call needed)
  // The deploy drawer will filter: snapshots?.filter(s => s.name && s.name !== '')

  return (
    <div className="flex min-h-screen">
      <Sidebar onDeployClick={() => setDeployDrawerOpen(true)} />
      <div className="flex-1 flex flex-col">
        <InfrastructureStatus />
        <main className="flex-1 p-8 space-y-6 overflow-y-auto">
        {/* Deployments Table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <CardTitle>Deployments</CardTitle>
                {deployments && deployments.length > 0 && (
                  <Badge variant="secondary" className="font-normal">
                    {deployments.length}
                  </Badge>
                )}
              </div>
              <CardDescription>
                <LiveIndicator isConnected={!isErrorDeployments} />
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ErrorBoundary>
              <DeploymentsTable
                deployments={deployments}
                isLoading={isLoadingDeployments}
                isError={isErrorDeployments}
                onRetry={() => refetchDeployments()}
                onDeployClick={() => setDeployDrawerOpen(true)}
              />
            </ErrorBoundary>
          </CardContent>
        </Card>

        {/* Snapshots Panel */}
        <ErrorBoundary>
          <SnapshotsPanel
            snapshots={snapshots}
            isLoading={isLoadingSnapshots}
            isError={isErrorSnapshots}
            onRetry={() => refetchSnapshots()}
          />
        </ErrorBoundary>
        </main>
      </div>

      <DeployDrawer open={deployDrawerOpen} onOpenChange={setDeployDrawerOpen} />
    </div>
  )
}
