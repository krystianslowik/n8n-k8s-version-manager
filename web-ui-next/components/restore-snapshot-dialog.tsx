'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useDeployments, useRestoreSnapshot, grpcQueryKeys } from '@/lib/grpc-hooks'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { LoaderIcon, AlertTriangleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { addActivity } from '@/lib/activity'

interface RestoreSnapshotDialogProps {
  snapshot: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RestoreSnapshotDialog({
  snapshot,
  open,
  onOpenChange,
}: RestoreSnapshotDialogProps) {
  const [selectedNamespace, setSelectedNamespace] = useState<string>('')
  const queryClient = useQueryClient()

  const { data: deployments, isLoading: deploymentsLoading } = useDeployments({
    enabled: open,
  })

  const { restore, isRestoring, progress } = useRestoreSnapshot({
    onProgress: (p) => {
      if (p.message) {
        toast.loading(p.message, { id: 'restore-progress' })
      }
    },
    onSuccess: () => {
      toast.success('Snapshot restored', {
        id: 'restore-progress',
        description: `Database restored to ${selectedNamespace}`,
      })
      addActivity('restored', `${snapshot} → ${selectedNamespace}`)
      queryClient.invalidateQueries({ queryKey: grpcQueryKeys.deployments })
      onOpenChange(false)
      setSelectedNamespace('')
    },
    onError: (error: Error) => {
      toast.error('Restore failed', {
        id: 'restore-progress',
        description: error.message,
      })
    },
  })

  const handleRestore = () => {
    if (snapshot && selectedNamespace) {
      restore({ snapshotName: snapshot, targetNamespace: selectedNamespace })
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      setSelectedNamespace('')
    }
    onOpenChange(newOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore Snapshot</DialogTitle>
          <DialogDescription>
            Choose a deployment to restore this snapshot into.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Snapshot</label>
            <div className="font-mono text-sm bg-muted p-2 rounded">
              {snapshot}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Target Deployment</label>
            {deploymentsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderIcon className="h-4 w-4 animate-spin" />
                Loading deployments...
              </div>
            ) : deployments?.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No deployments available. Deploy a version first.
              </div>
            ) : (
              <Select value={selectedNamespace} onValueChange={setSelectedNamespace}>
                <SelectTrigger>
                  <SelectValue placeholder="Select deployment..." />
                </SelectTrigger>
                <SelectContent>
                  {deployments?.map((d) => (
                    <SelectItem key={d.namespace} value={d.namespace}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono">v{d.version}</span>
                        <span className="text-muted-foreground">
                          {d.namespace}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {selectedNamespace && (
            <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
              <AlertTriangleIcon className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">Warning</p>
                <p className="text-muted-foreground">
                  This will <strong>overwrite</strong> the database in{' '}
                  <span className="font-mono">{selectedNamespace}</span>. This action
                  cannot be undone.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isRestoring}
          >
            Cancel
          </Button>
          <Button
            onClick={handleRestore}
            disabled={!selectedNamespace || isRestoring}
            className="bg-destructive hover:bg-destructive/90"
          >
            {isRestoring ? (
              <>
                <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
                {progress?.message || 'Restoring...'}
              </>
            ) : (
              'Restore'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
