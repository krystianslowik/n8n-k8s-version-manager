import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Snapshot } from '@/lib/types'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion'
import { Button } from './ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'

export function SnapshotsSection() {
  const [restoreSnapshot, setRestoreSnapshot] = useState<string | null>(null)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: ['snapshots'],
    queryFn: api.listSnapshots,
    refetchInterval: 10000, // Poll every 10 seconds
  })

  const restoreMutation = useMutation({
    mutationFn: (snapshot: string) => api.restoreSnapshot(snapshot),
    onSuccess: (data, snapshot) => {
      if (data.success) {
        toast({
          title: 'Snapshot restored',
          description: `Database restored from ${snapshot}`,
        })
        queryClient.invalidateQueries({ queryKey: ['versions'] })
      } else {
        toast({
          variant: 'destructive',
          title: 'Restore failed',
          description: data.error || 'Unknown error',
        })
      }
      setRestoreSnapshot(null)
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Restore failed',
        description: error.message,
      })
      setRestoreSnapshot(null)
    },
  })

  const snapshotCount = data?.snapshots.length || 0

  return (
    <>
      <Accordion type="single" collapsible className="mt-8">
        <AccordionItem value="snapshots">
          <AccordionTrigger>
            Database Snapshots ({snapshotCount})
          </AccordionTrigger>
          <AccordionContent>
            {snapshotCount === 0 ? (
              <p className="text-gray-500 text-sm">No snapshots available</p>
            ) : (
              <div className="space-y-2">
                {data?.snapshots.map((snapshot: Snapshot) => (
                  <div
                    key={snapshot.filename}
                    className="flex items-center justify-between p-3 bg-white border rounded-md"
                  >
                    <div>
                      <p className="font-medium text-sm">{snapshot.filename}</p>
                      <p className="text-xs text-gray-500">{snapshot.timestamp}</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRestoreSnapshot(snapshot.filename)}
                      disabled={restoreMutation.isPending}
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <AlertDialog open={!!restoreSnapshot} onOpenChange={() => setRestoreSnapshot(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore snapshot?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will OVERWRITE the current database with:</p>
              <p className="font-mono text-sm bg-gray-100 p-2 rounded">{restoreSnapshot}</p>
              <p className="text-red-600 font-medium">
                All current data will be replaced. This cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => restoreSnapshot && restoreMutation.mutate(restoreSnapshot)}
              className="bg-red-600 hover:bg-red-700"
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
