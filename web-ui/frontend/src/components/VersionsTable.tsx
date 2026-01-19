import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Version } from '@/lib/types'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/table'
import { Badge } from './ui/badge'
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
import { Skeleton } from './ui/skeleton'
import { useToast } from '@/hooks/use-toast'

export function VersionsTable() {
  const [deleteVersion, setDeleteVersion] = useState<string | null>(null)
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['versions'],
    queryFn: api.listVersions,
    refetchInterval: 5000, // Poll every 5 seconds
  })

  const removeMutation = useMutation({
    mutationFn: (version: string) => api.removeVersion(version),
    onSuccess: (data, version) => {
      if (data.success) {
        toast({
          title: 'Version removed',
          description: `n8n ${version} has been removed`,
        })
        queryClient.invalidateQueries({ queryKey: ['versions'] })
      } else {
        toast({
          variant: 'destructive',
          title: 'Removal failed',
          description: data.error || 'Unknown error',
        })
      }
      setDeleteVersion(null)
    },
    onError: (error) => {
      toast({
        variant: 'destructive',
        title: 'Removal failed',
        description: error.message,
      })
      setDeleteVersion(null)
    },
  })

  const getStatusVariant = (status: string) => {
    if (status === 'running') return 'default'
    if (status === 'pending') return 'secondary'
    return 'destructive'
  }

  const getModeVariant = (mode: string) => {
    return mode === 'queue' ? 'default' : 'secondary'
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Active Versions</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Version</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pods</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.versions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-gray-500">
                      No versions deployed
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.versions.map((version: Version) => (
                    <TableRow key={version.namespace}>
                      <TableCell className="font-medium">{version.version}</TableCell>
                      <TableCell>
                        <Badge variant={getModeVariant(version.mode)}>
                          {version.mode}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(version.status)}>
                          {version.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {version.pods.ready}/{version.pods.total}
                      </TableCell>
                      <TableCell>
                        {version.url && (
                          <a
                            href={version.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            →
                          </a>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleteVersion(version.version)}
                          disabled={removeMutation.isPending}
                        >
                          Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteVersion} onOpenChange={() => setDeleteVersion(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete n8n version {deleteVersion}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the namespace and all pods. Database data will remain.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteVersion && removeMutation.mutate(deleteVersion)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
