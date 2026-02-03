'use client'

import { useState } from 'react'
import {
  ChevronLeftIcon,
  ServerIcon,
  DatabaseIcon,
  PackageIcon,
  PlusIcon,
  RocketIcon,
  Trash2Icon,
  CameraIcon,
  RotateCcwIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { QUERY_CONFIG } from '@/lib/query-config'
import { useActivity } from '@/lib/hooks'
import { cn } from '@/lib/utils'
import type { ActivityType } from '@/lib/activity'

interface SidebarProps {
  onDeployClick?: () => void
}

const activityConfig: Record<ActivityType, { icon: typeof RocketIcon; color: string; label: string }> = {
  deployed: { icon: RocketIcon, color: 'text-green-600', label: 'Deployed' },
  deleted: { icon: Trash2Icon, color: 'text-red-600', label: 'Deleted' },
  snapshot: { icon: CameraIcon, color: 'text-blue-600', label: 'Snapshot' },
  restored: { icon: RotateCcwIcon, color: 'text-yellow-600', label: 'Restored' },
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return '1d ago'
}

export function Sidebar({ onDeployClick }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  const { data: infrastructure, isLoading: isLoadingInfra } = useQuery({
    queryKey: ['infrastructure'],
    queryFn: api.getInfrastructureStatus,
    staleTime: QUERY_CONFIG.infrastructure.staleTime,
    refetchInterval: QUERY_CONFIG.infrastructure.refetchInterval,
  })

  const { data: deployments, isLoading: isLoadingDeployments } = useQuery({
    queryKey: ['deployments'],
    queryFn: api.getDeployments,
    staleTime: QUERY_CONFIG.deployments.staleTime,
  })

  const { data: snapshots, isLoading: isLoadingSnapshots } = useQuery({
    queryKey: ['snapshots'],
    queryFn: api.getSnapshots,
    staleTime: QUERY_CONFIG.snapshots.staleTime,
  })

  const { data: clusterResources, isLoading: isLoadingResources } = useQuery({
    queryKey: ['cluster-resources'],
    queryFn: api.getClusterResources,
    staleTime: QUERY_CONFIG.clusterResources.staleTime,
  })

  const activities = useActivity()
  const memory = clusterResources?.memory

  return (
    <aside
      className={cn(
        'sticky top-0 h-screen flex flex-col border-r bg-card transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        {!collapsed && (
          <div>
            <h2 className="text-lg font-bold">n8n Manager</h2>
            <p className="text-xs text-muted-foreground">Version 1.1</p>
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

      {/* Quick Stats */}
      <div className="p-4 border-b">
        {!collapsed && (
          <p className="text-xs font-medium text-muted-foreground mb-3">Quick Stats</p>
        )}
        <div className={cn('space-y-3', collapsed && 'flex flex-col items-center space-y-4')}>
          {/* Deployments */}
          <div className={cn('flex items-center gap-2', collapsed && 'flex-col gap-1')}>
            <PackageIcon className="h-4 w-4 text-muted-foreground" />
            {isLoadingDeployments ? (
              <Skeleton className="h-4 w-20 " />
            ) : !collapsed ? (
              <span className="text-sm">{deployments?.length || 0} deployments</span>
            ) : (
              <span className="text-xs font-medium">{deployments?.length || 0}</span>
            )}
          </div>

          {/* Memory Bar */}
          {!collapsed && (
            isLoadingResources ? (
              <div className="space-y-1">
                <Skeleton className="h-2 w-full rounded-full " />
                <Skeleton className="h-3 w-16 " />
              </div>
            ) : memory && (
              <div className="space-y-1">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full transition-all',
                      memory.utilization_percent >= 85 ? 'bg-red-500' :
                      memory.utilization_percent >= 70 ? 'bg-yellow-500' : 'bg-green-500'
                    )}
                    style={{ width: `${memory.utilization_percent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">{memory.utilization_percent}% memory</p>
              </div>
            )
          )}

          {/* Snapshots */}
          <div className={cn('flex items-center gap-2', collapsed && 'flex-col gap-1')}>
            <DatabaseIcon className="h-4 w-4 text-muted-foreground" />
            {isLoadingSnapshots ? (
              <Skeleton className="h-4 w-16 " />
            ) : !collapsed ? (
              <span className="text-sm">{snapshots?.length || 0} snapshots</span>
            ) : (
              <span className="text-xs font-medium">{snapshots?.length || 0}</span>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity - only show when expanded */}
      {!collapsed && (
        <div className="flex-1 overflow-y-auto p-4 border-b">
          <p className="text-xs font-medium text-muted-foreground mb-3">Recent Activity</p>
          {activities.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No recent activity</p>
          ) : (
            <div className="space-y-3">
              {activities.slice(0, 5).map((activity) => {
                const config = activityConfig[activity.type]
                const Icon = config.icon
                return (
                  <div key={activity.id} className="flex items-start gap-2">
                    <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', config.color)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{activity.target}</p>
                      <p className="text-xs text-muted-foreground">{formatTimeAgo(activity.timestamp)}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Spacer when collapsed */}
      {collapsed && <div className="flex-1" />}

      {/* Infrastructure Status */}
      <div className={cn('p-4 border-t', collapsed && 'flex flex-col items-center gap-2')}>
        {!collapsed && (
          <p className="text-xs font-medium text-muted-foreground mb-2">Infrastructure</p>
        )}
        {isLoadingInfra ? (
          <div className={cn('space-y-2', collapsed && 'flex flex-col items-center gap-2')}>
            <Skeleton className="h-4 w-4 rounded-full " />
            <Skeleton className="h-4 w-4 rounded-full " />
          </div>
        ) : collapsed ? (
          <>
            <div
              className={cn(
                'h-3 w-3 rounded-full',
                infrastructure?.redis.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
              )}
              title={`Redis: ${infrastructure?.redis.status || 'unknown'}`}
            />
            <div
              className={cn(
                'h-3 w-3 rounded-full',
                infrastructure?.backup?.status === 'healthy' ? 'bg-green-500' : 'bg-red-500'
              )}
              title={`Backups: ${infrastructure?.backup?.status || 'unknown'}`}
            />
          </>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ServerIcon className="h-3 w-3" />
                <span className="text-xs">Redis</span>
              </div>
              <Badge
                variant={infrastructure?.redis.status === 'healthy' ? 'default' : 'destructive'}
                className="text-xs"
              >
                {infrastructure?.redis.status || 'unknown'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DatabaseIcon className="h-3 w-3" />
                <span className="text-xs">Backups</span>
              </div>
              <Badge
                variant={infrastructure?.backup?.status === 'healthy' ? 'default' : 'destructive'}
                className="text-xs"
              >
                {infrastructure?.backup?.status || 'unknown'}
              </Badge>
            </div>
          </div>
        )}
      </div>

      {/* Deploy Button */}
      <div className="p-4 border-t">
        <Button
          className="w-full"
          onClick={onDeployClick}
          title="Press N"
        >
          {collapsed ? (
            <PlusIcon className="h-4 w-4" />
          ) : (
            <>
              <PlusIcon className="h-4 w-4 mr-2" />
              Deploy
              <kbd className="ml-auto text-xs bg-primary-foreground/20 px-1.5 py-0.5 rounded">N</kbd>
            </>
          )}
        </Button>
      </div>
    </aside>
  )
}
