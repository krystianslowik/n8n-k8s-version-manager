'use client'

import { useClusterResources } from '@/lib/grpc-hooks'
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

/**
 * Parse Kubernetes memory string (e.g., "1234Mi", "2Gi", "1234") to Mebibytes
 */
function parseMemoryToMi(memoryStr: string | undefined): number {
  if (!memoryStr) return 0
  const match = memoryStr.match(/^(\d+(?:\.\d+)?)\s*(Ki|Mi|Gi|Ti|K|M|G|T)?$/i)
  if (!match) return 0
  const value = parseFloat(match[1])
  const unit = (match[2] || '').toLowerCase()
  switch (unit) {
    case 'ki': return value / 1024
    case 'mi': return value
    case 'gi': return value * 1024
    case 'ti': return value * 1024 * 1024
    case 'k': return value / 1024
    case 'm': return value
    case 'g': return value * 1024
    case 't': return value * 1024 * 1024
    default: return value / (1024 * 1024) // bytes to Mi
  }
}

export function MemoryStatCard() {
  const { data: resources, isLoading } = useClusterResources({
    staleTime: 30000, // Memory data valid for 30s
    refetchInterval: 30000, // Poll every 30s
  })

  const summary = resources?.summary

  if (isLoading || !summary) {
    return (
      <Card>
        <CardContent className="py-4 px-6">
          <div className="flex items-center justify-between mb-2">
            <Skeleton className="h-4 w-24" />
            <ServerIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <Skeleton className="h-7 w-16" />
        </CardContent>
      </Card>
    )
  }

  // Parse memory strings to Mi for display
  const usedMi = parseMemoryToMi(summary.usedMemory)
  const totalMi = parseMemoryToMi(summary.totalMemory)
  const availableMi = totalMi - usedMi
  const utilizationPercent = Math.round(summary.memoryUtilizationPercent)

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Card className="cursor-help">
            <CardContent className="py-4 px-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Cluster Memory</p>
                  <p className="text-2xl font-bold mt-1">
                    {utilizationPercent}%
                  </p>
                  <div className="flex items-center gap-1 mt-1">
                {utilizationPercent >= 85 ? (
                  <AlertTriangleIcon className="h-3 w-3 text-red-600" />
                ) : utilizationPercent >= 70 ? (
                  <AlertTriangleIcon className="h-3 w-3 text-yellow-600" />
                ) : (
                  <CheckCircleIcon className="h-3 w-3 text-green-600" />
                )}
                    <p className="text-xs text-muted-foreground">
                      {formatMemory(usedMi)} / {formatMemory(totalMi)}
                    </p>
                  </div>
                </div>
                <ServerIcon className="h-8 w-8 text-muted-foreground" />
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
                <span className="font-mono">{formatMemory(usedMi)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Available:</span>
                <span className="font-mono">{formatMemory(availableMi)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">Total:</span>
                <span className="font-mono">{formatMemory(totalMi)}</span>
              </div>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
