'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useCreateSnapshot, grpcQueryKeys } from '@/lib/grpc-hooks'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoaderIcon } from 'lucide-react'
import { toast } from 'sonner'
import { addActivity } from '@/lib/activity'
import type { Deployment } from '@/lib/types'

interface CreateSnapshotDialogProps {
  deployment: Deployment | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateSnapshotDialog({
  deployment,
  open,
  onOpenChange,
}: CreateSnapshotDialogProps) {
  const [name, setName] = useState('')
  const queryClient = useQueryClient()

  const { create, isCreating, progress } = useCreateSnapshot({
    onProgress: (p) => {
      if (p.message) {
        toast.loading(p.message, { id: 'snapshot-progress' })
      }
    },
    onSuccess: () => {
      toast.success('Snapshot created', {
        id: 'snapshot-progress',
        description: `Snapshot ${name || 'auto-named'} created from ${deployment?.namespace}`,
      })
      addActivity('snapshot', name || `from ${deployment?.namespace}`)
      queryClient.invalidateQueries({ queryKey: grpcQueryKeys.snapshots })
      onOpenChange(false)
      setName('')
    },
    onError: (error: Error) => {
      toast.error('Failed to create snapshot', {
        id: 'snapshot-progress',
        description: error.message,
      })
    },
  })

  const handleCreate = () => {
    if (!deployment) return
    create({
      name: name || `snapshot-${Date.now()}`,
      sourceNamespace: deployment.namespace,
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Create Snapshot</AlertDialogTitle>
          <AlertDialogDescription>
            Create a snapshot of the database from{' '}
            <span className="font-mono font-semibold">{deployment?.namespace}</span>.
            This can be used to restore data to new deployments.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="snapshot-name">Snapshot Name (optional)</Label>
            <Input
              id="snapshot-name"
              placeholder="my-snapshot"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to auto-generate: {new Date().toISOString().slice(0, 10)}-v
              {deployment?.version}-xxxx
            </p>
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isCreating}>
            Cancel
          </AlertDialogCancel>
          <Button
            onClick={handleCreate}
            disabled={isCreating}
          >
            {isCreating ? (
              <>
                <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
                {progress?.message || 'Creating...'}
              </>
            ) : (
              'Create Snapshot'
            )}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
