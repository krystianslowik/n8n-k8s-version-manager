'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ServerIcon, AlertTriangleIcon, CheckCircleIcon, InfoIcon } from 'lucide-react'
import { formatMemory } from '@/lib/format'

export function MemoryStatCard() {
  const { data: resources, isLoading } = useQuery({
    queryKey: ['cluster-resources'],
    queryFn: api.getClusterResources,
    refetchInterval: 10000, // Poll every 10s
  })

  if (isLoading || !resources?.memory) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Cluster Memory</CardTitle>
          <ServerIcon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-2 w-full mb-2" />
          <Skeleton className="h-4 w-32" />
        </CardContent>
      </Card>
    )
  }

  const { memory } = resources

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="cursor-help">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Cluster Memory</CardTitle>
              <ServerIcon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {memory.utilization_percent}%
              </div>
              <div className="flex items-center gap-1 mt-1">
                {memory.utilization_percent >= 85 ? (
                  <AlertTriangleIcon className="h-3 w-3 text-red-600" />
                ) : memory.utilization_percent >= 70 ? (
                  <AlertTriangleIcon className="h-3 w-3 text-yellow-600" />
                ) : (
                  <CheckCircleIcon className="h-3 w-3 text-green-600" />
                )}
                <p className="text-xs text-muted-foreground">
                  {formatMemory(memory.used_mi)} / {formatMemory(memory.allocatable_mi)}
                </p>
              </div>
            </CardContent>
          </Card>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <div className="space-y-2">
            <p className="font-semibold">Memory Details</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Used:</span>
                <span className="font-mono">{formatMemory(memory.used_mi)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Available:</span>
                <span className="font-mono">{formatMemory(memory.available_mi)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Total:</span>
                <span className="font-mono">{formatMemory(memory.allocatable_mi)}</span>
              </div>
              <div className="border-t pt-1 mt-1">
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Can deploy queue:</span>
                  <span>{resources.can_deploy.queue_mode ? '✓' : '✗'}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-muted-foreground">Can deploy regular:</span>
                  <span>{resources.can_deploy.regular_mode ? '✓' : '✗'}</span>
                </div>
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
