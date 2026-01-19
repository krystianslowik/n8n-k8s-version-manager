'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ServerIcon, AlertTriangleIcon, CheckCircleIcon } from 'lucide-react'
import { formatMemory, getMemoryUtilizationColor } from '@/lib/format'

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
  const colors = getMemoryUtilizationColor(memory.utilization_percent)

  return (
    <Card className={`border-2 ${colors.border}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Cluster Memory</CardTitle>
        <ServerIcon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2 mb-2">
          <div className="text-2xl font-bold">
            {formatMemory(memory.used_mi)}
          </div>
          <span className="text-sm text-muted-foreground">
            / {formatMemory(memory.allocatable_mi)}
          </span>
        </div>

        <Progress
          value={memory.utilization_percent}
          className="h-2 mb-3"
        />

        <div className="flex items-center gap-2">
          {memory.utilization_percent >= 85 ? (
            <>
              <AlertTriangleIcon className="h-4 w-4 text-red-600" />
              <Badge variant="destructive" className="text-xs">
                {memory.utilization_percent}% - Low capacity
              </Badge>
            </>
          ) : memory.utilization_percent >= 70 ? (
            <>
              <AlertTriangleIcon className="h-4 w-4 text-yellow-600" />
              <Badge variant="secondary" className="text-xs">
                {memory.utilization_percent}% - Moderate usage
              </Badge>
            </>
          ) : (
            <>
              <CheckCircleIcon className="h-4 w-4 text-green-600" />
              <Badge variant="outline" className="text-xs">
                {memory.utilization_percent}% - Healthy
              </Badge>
            </>
          )}
        </div>

        <p className="text-xs text-muted-foreground mt-2">
          {formatMemory(memory.available_mi)} available
        </p>
      </CardContent>
    </Card>
  )
}
