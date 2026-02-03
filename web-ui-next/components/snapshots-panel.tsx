'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { DatabaseIcon, RotateCcwIcon, UploadIcon, TagIcon, ClockIcon, TrashIcon, LoaderIcon, ChevronDownIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useState } from 'react'
import { RestoreSnapshotDialog } from './restore-snapshot-dialog'
import { UploadSnapshotDialog } from './upload-snapshot-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorState } from '@/components/error-boundary'
import { addActivity } from '@/lib/activity'
import type { Snapshot } from '@/lib/types'

interface SnapshotsPanelProps {
  snapshots: Snapshot[] | undefined
  isLoading: boolean
  isError?: boolean
  onRetry?: () => void
}

export function SnapshotsPanel({ snapshots, isLoading, isError, onRetry }: SnapshotsPanelProps) {
  const [restoreSnapshot, setRestoreSnapshot] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [deletingSnapshot, setDeletingSnapshot] = useState<string | null>(null)
  const queryClient = useQueryClient()

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => api.deleteSnapshot(filename),
    onSuccess: (data, filename) => {
      if (data.success) {
        toast.success('Snapshot deleted')
        queryClient.invalidateQueries({ queryKey: ['snapshots'] })
      } else {
        toast.error('Failed to delete snapshot', {
          description: data.error,
        })
      }
      setDeletingSnapshot(null)
    },
    onError: (error: Error) => {
      toast.error('Failed to delete snapshot', {
        description: error.message,
      })
      setDeletingSnapshot(null)
    },
  })

  const handleDelete = (filename: string) => {
    setDeletingSnapshot(filename)
    deleteMutation.mutate(filename)
  }

  const handleRestore = (filename: string) => {
    setRestoreSnapshot(filename)
  }

  const namedSnapshots = snapshots?.filter((s) => s.type === 'named') || []
  const autoSnapshots = snapshots?.filter((s) => s.type === 'auto') || []
  const allSnapshots = [...namedSnapshots, ...autoSnapshots]

  // Show 4 items by default, expand to show all
  const COLLAPSED_COUNT = 4
  const visibleSnapshots = expanded ? allSnapshots : allSnapshots.slice(0, COLLAPSED_COUNT)
  const hasMore = allSnapshots.length > COLLAPSED_COUNT

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <CardTitle>Snapshots</CardTitle>
              {snapshots && snapshots.length > 0 && (
                <Badge variant="secondary" className="font-normal">
                  {snapshots.length}
                </Badge>
              )}
            </div>
            <CardDescription>
              Backup and restore database states
            </CardDescription>
          </div>
          <Button
            onClick={() => setUploadOpen(true)}
            variant="outline"
            size="sm"
          >
            <UploadIcon className="h-4 w-4 mr-2" />
            Upload
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            // Loading skeleton with staggered animation
            <div className="space-y-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2.5 rounded-lg animate-row-enter"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <Skeleton className="h-8 w-8 rounded-md shrink-0 " />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-32 " />
                    <Skeleton className="h-3 w-24 " />
                  </div>
                </div>
              ))}
            </div>
          ) : isError ? (
            <QueryErrorState message="Failed to load snapshots" onRetry={onRetry} />
          ) : allSnapshots.length === 0 ? (
            // Empty state - compact
            <div className="flex items-center gap-4 p-4 rounded-lg border border-dashed">
              <div className="rounded-full bg-muted p-3">
                <DatabaseIcon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium text-sm">No snapshots yet</p>
                <p className="text-xs text-muted-foreground">
                  Create snapshots to backup database states
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {visibleSnapshots.map((snapshot, index) => {
                const isNamed = snapshot.type === 'named'
                const isDeleting = deletingSnapshot === snapshot.filename
                return (
                  <div
                    key={snapshot.filename}
                    className={`
                      group flex items-center gap-3 p-2.5 rounded-lg
                      hover:bg-accent/50 transition-all cursor-default
                      ${isDeleting ? 'opacity-50' : ''}
                    `}
                    style={{
                      animationDelay: `${index * 30}ms`
                    }}
                  >
                    {/* Icon */}
                    <div className={`
                      shrink-0 h-8 w-8 rounded-md flex items-center justify-center
                      ${isNamed ? 'bg-primary/10' : 'bg-muted'}
                    `}>
                      {isNamed ? (
                        <TagIcon className="h-4 w-4 text-primary" />
                      ) : (
                        <ClockIcon className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm truncate ${isNamed ? 'font-medium' : 'font-mono'}`}>
                        {isNamed ? snapshot.name : snapshot.filename}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {isNamed ? snapshot.filename : snapshot.timestamp}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => handleRestore(snapshot.filename)}
                              disabled={isDeleting}
                            >
                              <RotateCcwIcon className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="left">Restore</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      {isNamed && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => handleDelete(snapshot.filename)}
                                disabled={isDeleting}
                              >
                                {isDeleting ? (
                                  <LoaderIcon className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <TrashIcon className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="left">Delete</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Show more/less button */}
              {hasMore && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2 text-muted-foreground"
                  onClick={() => setExpanded(!expanded)}
                >
                  <ChevronDownIcon className={`h-4 w-4 mr-1 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                  {expanded ? 'Show less' : `Show ${allSnapshots.length - COLLAPSED_COUNT} more`}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Restore to Deployment Dialog */}
      <RestoreSnapshotDialog
        snapshot={restoreSnapshot}
        open={!!restoreSnapshot}
        onOpenChange={(open) => !open && setRestoreSnapshot(null)}
      />

      {/* Upload Snapshot Dialog */}
      <UploadSnapshotDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
      />
    </>
  )
}
