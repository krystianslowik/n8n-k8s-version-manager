'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query'
import {
  versionClient,
  snapshotClient,
  infrastructureClient,
  type Deployment,
  type DeployRequest,
  type DeploymentProgress,
  type Snapshot,
  type InfrastructureStatus,
  type ClusterResources,
  type K8sEvent,
  type LogEntry,
} from './grpc-client'

/**
 * Query keys for React Query cache management
 */
export const grpcQueryKeys = {
  deployments: ['grpc', 'deployments'] as const,
  deployment: (namespace: string) => ['grpc', 'deployment', namespace] as const,
  deploymentLogs: (namespace: string) => ['grpc', 'deployment', namespace, 'logs'] as const,
  deploymentEvents: (namespace: string) => ['grpc', 'deployment', namespace, 'events'] as const,
  deploymentConfig: (namespace: string) => ['grpc', 'deployment', namespace, 'config'] as const,
  snapshots: ['grpc', 'snapshots'] as const,
  namedSnapshots: ['grpc', 'snapshots', 'named'] as const,
  infrastructure: ['grpc', 'infrastructure'] as const,
  clusterResources: ['grpc', 'cluster', 'resources'] as const,
  availableVersions: ['grpc', 'versions', 'available'] as const,
}

// ============================================================================
// Deployment Hooks
// ============================================================================

/**
 * Fetch all deployments
 */
export function useDeployments(
  options?: Omit<UseQueryOptions<Deployment[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.deployments,
    queryFn: async () => {
      const response = await versionClient.listDeployments({})
      return response.deployments
    },
    staleTime: 10_000, // 10 seconds
    ...options,
  })
}

/**
 * Fetch a single deployment by namespace
 */
export function useDeployment(
  namespace: string,
  options?: Omit<UseQueryOptions<Deployment, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.deployment(namespace),
    queryFn: async () => {
      return versionClient.getDeployment({ namespace })
    },
    enabled: !!namespace,
    staleTime: 5_000,
    ...options,
  })
}

/**
 * Deploy a new version with streaming progress updates
 */
export function useDeployVersion(
  options?: {
    onProgress?: (progress: DeploymentProgress) => void
    onSuccess?: (namespace: string) => void
    onError?: (error: Error) => void
  }
) {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<DeploymentProgress | null>(null)
  const [isDeploying, setIsDeploying] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const deploy = useCallback(
    async (request: DeployRequest) => {
      setIsDeploying(true)
      setProgress(null)
      abortControllerRef.current = new AbortController()

      try {
        const stream = versionClient.deployVersion(request)

        // Handle streaming response
        for await (const progressUpdate of stream as AsyncIterable<DeploymentProgress>) {
          setProgress(progressUpdate)
          options?.onProgress?.(progressUpdate)

          if (progressUpdate.complete) {
            // Invalidate queries on completion
            queryClient.invalidateQueries({ queryKey: grpcQueryKeys.deployments })

            if (progressUpdate.error) {
              const error = new Error(progressUpdate.error)
              options?.onError?.(error)
              throw error
            } else {
              // Extract namespace from request
              const namespace = `n8n-v${request.version.replace(/\./g, '-')}`
              options?.onSuccess?.(namespace)
            }
          }
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error))
        options?.onError?.(err)
        throw err
      } finally {
        setIsDeploying(false)
        abortControllerRef.current = null
      }
    },
    [queryClient, options]
  )

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsDeploying(false)
    setProgress(null)
  }, [])

  return {
    deploy,
    cancel,
    progress,
    isDeploying,
  }
}

/**
 * Delete a deployment
 */
export function useDeleteDeployment(
  options?: UseMutationOptions<{ success: boolean; message?: string }, Error, string>
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (namespace: string) => {
      return versionClient.deleteDeployment({ namespace })
    },
    onSuccess: (data, namespace) => {
      // Remove from cache immediately
      queryClient.setQueryData<Deployment[]>(
        grpcQueryKeys.deployments,
        (old) => old?.filter((d) => d.namespace !== namespace) ?? []
      )
      // Invalidate to refetch
      queryClient.invalidateQueries({ queryKey: grpcQueryKeys.deployments })
      queryClient.removeQueries({ queryKey: grpcQueryKeys.deployment(namespace) })
    },
    ...options,
  })
}

/**
 * Stream deployment logs in real-time
 */
export function useDeploymentLogs(
  namespace: string,
  options?: {
    pod?: string
    container?: string
    tail?: number
    enabled?: boolean
    onLog?: (log: LogEntry) => void
  }
) {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const startStreaming = useCallback(async () => {
    if (!namespace) return

    setIsStreaming(true)
    setError(null)
    abortControllerRef.current = new AbortController()

    try {
      const stream = versionClient.getDeploymentLogs({
        namespace,
        pod: options?.pod,
        container: options?.container,
        tail: options?.tail ?? 100,
      })

      for await (const logEntry of stream as AsyncIterable<LogEntry>) {
        setLogs((prev) => [...prev, logEntry])
        options?.onLog?.(logEntry)
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err)
      }
    } finally {
      setIsStreaming(false)
      abortControllerRef.current = null
    }
  }, [namespace, options])

  const stopStreaming = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsStreaming(false)
  }, [])

  const clearLogs = useCallback(() => {
    setLogs([])
  }, [])

  // Auto-start streaming if enabled
  useEffect(() => {
    if (options?.enabled !== false && namespace) {
      startStreaming()
    }

    return () => {
      stopStreaming()
    }
  }, [namespace, options?.enabled, startStreaming, stopStreaming])

  return {
    logs,
    isStreaming,
    error,
    startStreaming,
    stopStreaming,
    clearLogs,
  }
}

/**
 * Fetch deployment events
 */
export function useDeploymentEvents(
  namespace: string,
  limit: number = 50,
  options?: Omit<UseQueryOptions<K8sEvent[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.deploymentEvents(namespace),
    queryFn: async () => {
      const response = await versionClient.getDeploymentEvents({ namespace, limit })
      return response.events
    },
    enabled: !!namespace,
    staleTime: 5_000,
    ...options,
  })
}

/**
 * Fetch deployment configuration
 */
export function useDeploymentConfig(
  namespace: string,
  options?: Omit<UseQueryOptions<Record<string, string>, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.deploymentConfig(namespace),
    queryFn: async () => {
      const response = await versionClient.getDeploymentConfig({ namespace })
      return response.config
    },
    enabled: !!namespace,
    staleTime: 30_000, // Config changes less frequently
    ...options,
  })
}

// ============================================================================
// Snapshot Hooks
// ============================================================================

/**
 * Fetch all snapshots
 */
export function useSnapshots(
  options?: Omit<UseQueryOptions<Snapshot[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.snapshots,
    queryFn: async () => {
      const response = await snapshotClient.listSnapshots({})
      return response.snapshots
    },
    staleTime: 30_000,
    ...options,
  })
}

/**
 * Fetch named snapshots only
 */
export function useNamedSnapshots(
  options?: Omit<UseQueryOptions<Snapshot[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.namedSnapshots,
    queryFn: async () => {
      const response = await snapshotClient.listNamedSnapshots({})
      return response.snapshots
    },
    staleTime: 30_000,
    ...options,
  })
}

/**
 * Create a new snapshot
 */
export function useCreateSnapshot(
  options?: UseMutationOptions<
    { success: boolean; message?: string; filename?: string },
    Error,
    { name?: string; source?: string }
  >
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (request: { name?: string; source?: string }) => {
      return snapshotClient.createSnapshot(request)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: grpcQueryKeys.snapshots })
      queryClient.invalidateQueries({ queryKey: grpcQueryKeys.namedSnapshots })
    },
    ...options,
  })
}

/**
 * Delete a snapshot
 */
export function useDeleteSnapshot(
  options?: UseMutationOptions<{ success: boolean; message?: string }, Error, string>
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (filename: string) => {
      return snapshotClient.deleteSnapshot({ filename })
    },
    onSuccess: (_, filename) => {
      // Optimistic update
      queryClient.setQueryData<Snapshot[]>(
        grpcQueryKeys.snapshots,
        (old) => old?.filter((s) => s.filename !== filename) ?? []
      )
      queryClient.setQueryData<Snapshot[]>(
        grpcQueryKeys.namedSnapshots,
        (old) => old?.filter((s) => s.filename !== filename) ?? []
      )
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: grpcQueryKeys.snapshots })
      queryClient.invalidateQueries({ queryKey: grpcQueryKeys.namedSnapshots })
    },
    ...options,
  })
}

/**
 * Restore a snapshot to a deployment
 */
export function useRestoreSnapshot(
  options?: UseMutationOptions<
    { success: boolean; message?: string },
    Error,
    { snapshot: string; namespace: string }
  >
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (request: { snapshot: string; namespace: string }) => {
      return snapshotClient.restoreSnapshot(request)
    },
    onSuccess: (_, variables) => {
      // Invalidate deployment queries since data changed
      queryClient.invalidateQueries({
        queryKey: grpcQueryKeys.deployment(variables.namespace),
      })
      queryClient.invalidateQueries({ queryKey: grpcQueryKeys.deployments })
    },
    ...options,
  })
}

// ============================================================================
// Infrastructure Hooks
// ============================================================================

/**
 * Fetch infrastructure status (Redis, backup storage health)
 */
export function useInfrastructureStatus(
  options?: Omit<UseQueryOptions<InfrastructureStatus, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.infrastructure,
    queryFn: async () => {
      return infrastructureClient.getStatus({})
    },
    staleTime: 30_000,
    refetchInterval: 60_000, // Auto-refresh every minute
    ...options,
  })
}

/**
 * Fetch cluster resources
 */
export function useClusterResources(
  options?: Omit<UseQueryOptions<ClusterResources, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.clusterResources,
    queryFn: async () => {
      return infrastructureClient.getClusterResources({})
    },
    staleTime: 15_000,
    ...options,
  })
}

// ============================================================================
// Available Versions Hook
// ============================================================================

/**
 * Fetch available n8n versions from GitHub
 */
export function useAvailableVersions(
  options?: Omit<UseQueryOptions<string[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.availableVersions,
    queryFn: async () => {
      const response = await versionClient.getAvailableVersions({})
      return response.versions
    },
    staleTime: 6 * 60 * 60 * 1000, // 6 hours (matches backend cache)
    ...options,
  })
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Prefetch deployment data for faster navigation
 */
export function usePrefetchDeployment() {
  const queryClient = useQueryClient()

  return useCallback(
    (namespace: string) => {
      queryClient.prefetchQuery({
        queryKey: grpcQueryKeys.deployment(namespace),
        queryFn: async () => versionClient.getDeployment({ namespace }),
        staleTime: 5_000,
      })
    },
    [queryClient]
  )
}

/**
 * Invalidate all deployment-related queries
 * Useful after operations that affect multiple deployments
 */
export function useInvalidateDeployments() {
  const queryClient = useQueryClient()

  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['grpc', 'deployment'] })
    queryClient.invalidateQueries({ queryKey: grpcQueryKeys.deployments })
  }, [queryClient])
}
