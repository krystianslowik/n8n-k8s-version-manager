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
  availableVersionsClient,
} from './grpc-client'

// Import types from generated protobuf files
import type {
  Deployment,
  Snapshot,
} from './generated/n8n_manager/v1/common_pb'

import type {
  DeployRequest,
  DeployResponse,
  LogEntry,
  Event,
  GetConfigResponse,
} from './generated/n8n_manager/v1/version_pb'

import type {
  CreateSnapshotRequest,
  CreateSnapshotResponse,
  RestoreSnapshotResponse,
} from './generated/n8n_manager/v1/snapshot_pb'

import type {
  GetInfrastructureStatusResponse,
  GetClusterResourcesResponse,
} from './generated/n8n_manager/v1/infrastructure_pb'

import type {
  AvailableVersion,
} from './generated/n8n_manager/v1/available_versions_pb'

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
      const response = await versionClient.list({})
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
  options?: Omit<UseQueryOptions<Deployment | undefined, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.deployment(namespace),
    queryFn: async () => {
      const response = await versionClient.get({ namespace })
      return response.deployment
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
    onProgress?: (progress: DeployResponse) => void
    onSuccess?: (namespace: string, deployment?: Deployment) => void
    onError?: (error: Error) => void
  }
) {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<DeployResponse | null>(null)
  const [isDeploying, setIsDeploying] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const deploy = useCallback(
    async (request: Pick<DeployRequest, 'version' | 'mode' | 'snapshot'>) => {
      setIsDeploying(true)
      setProgress(null)
      abortControllerRef.current = new AbortController()

      try {
        // Server streaming call - returns an AsyncIterable
        const stream = versionClient.deploy(request, {
          signal: abortControllerRef.current.signal,
        })

        for await (const progressUpdate of stream) {
          setProgress(progressUpdate)
          options?.onProgress?.(progressUpdate)

          if (progressUpdate.completed) {
            // Invalidate queries on completion
            queryClient.invalidateQueries({ queryKey: grpcQueryKeys.deployments })

            if (!progressUpdate.success || progressUpdate.error) {
              const error = new Error(progressUpdate.error || 'Deployment failed')
              options?.onError?.(error)
              throw error
            } else {
              // Extract namespace from request or response
              const namespace = progressUpdate.deployment?.namespace ||
                `n8n-v${request.version.replace(/\./g, '-')}`
              options?.onSuccess?.(namespace, progressUpdate.deployment)
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // User cancelled - not an error
          return
        }
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
  options?: UseMutationOptions<{ success: boolean; message: string }, Error, string>
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (namespace: string) => {
      const response = await versionClient.delete({ namespace })
      return { success: response.success, message: response.message }
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
 * Watch deployment status updates in real-time
 */
export function useWatchDeploymentStatus(
  namespace: string,
  options?: {
    enabled?: boolean
    onUpdate?: (deployment: Deployment) => void
  }
) {
  const [deployment, setDeployment] = useState<Deployment | null>(null)
  const [isWatching, setIsWatching] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const startWatching = useCallback(async () => {
    if (!namespace) return

    setIsWatching(true)
    setError(null)
    abortControllerRef.current = new AbortController()

    try {
      const stream = versionClient.watchStatus(
        { namespace },
        { signal: abortControllerRef.current.signal }
      )

      for await (const statusUpdate of stream) {
        if (statusUpdate.deployment) {
          setDeployment(statusUpdate.deployment)
          options?.onUpdate?.(statusUpdate.deployment)
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err)
      }
    } finally {
      setIsWatching(false)
      abortControllerRef.current = null
    }
  }, [namespace, options])

  const stopWatching = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsWatching(false)
  }, [])

  useEffect(() => {
    if (options?.enabled !== false && namespace) {
      startWatching()
    }

    return () => {
      stopWatching()
    }
  }, [namespace, options?.enabled, startWatching, stopWatching])

  return {
    deployment,
    isWatching,
    error,
    startWatching,
    stopWatching,
  }
}

/**
 * Stream deployment logs in real-time
 */
export function useDeploymentLogs(
  namespace: string,
  options?: {
    podName?: string
    container?: string
    tailLines?: number
    follow?: boolean
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
      const stream = versionClient.streamLogs(
        {
          namespace,
          podName: options?.podName,
          container: options?.container,
          tailLines: options?.tailLines ?? 100,
          follow: options?.follow ?? true,
        },
        { signal: abortControllerRef.current.signal }
      )

      for await (const logEntry of stream) {
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
  options?: Omit<UseQueryOptions<Event[], Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.deploymentEvents(namespace),
    queryFn: async () => {
      const response = await versionClient.getEvents({ namespace, limit })
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
  options?: Omit<UseQueryOptions<GetConfigResponse, Error>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: grpcQueryKeys.deploymentConfig(namespace),
    queryFn: async () => {
      return versionClient.getConfig({ namespace })
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
      const response = await snapshotClient.list({})
      return response.snapshots
    },
    staleTime: 30_000,
    ...options,
  })
}

/**
 * Create a new snapshot with streaming progress
 */
export function useCreateSnapshot(
  options?: {
    onProgress?: (progress: CreateSnapshotResponse) => void
    onSuccess?: (snapshot?: Snapshot) => void
    onError?: (error: Error) => void
  }
) {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<CreateSnapshotResponse | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const create = useCallback(
    async (request: Pick<CreateSnapshotRequest, 'name' | 'sourceNamespace'>) => {
      setIsCreating(true)
      setProgress(null)
      abortControllerRef.current = new AbortController()

      try {
        const stream = snapshotClient.create(request, {
          signal: abortControllerRef.current.signal,
        })

        for await (const progressUpdate of stream) {
          setProgress(progressUpdate)
          options?.onProgress?.(progressUpdate)

          if (progressUpdate.completed) {
            queryClient.invalidateQueries({ queryKey: grpcQueryKeys.snapshots })

            if (!progressUpdate.success || progressUpdate.error) {
              const error = new Error(progressUpdate.error || 'Snapshot creation failed')
              options?.onError?.(error)
              throw error
            } else {
              options?.onSuccess?.(progressUpdate.snapshot)
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        const err = error instanceof Error ? error : new Error(String(error))
        options?.onError?.(err)
        throw err
      } finally {
        setIsCreating(false)
        abortControllerRef.current = null
      }
    },
    [queryClient, options]
  )

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsCreating(false)
    setProgress(null)
  }, [])

  return {
    create,
    cancel,
    progress,
    isCreating,
  }
}

/**
 * Delete a snapshot
 */
export function useDeleteSnapshot(
  options?: UseMutationOptions<{ success: boolean; message: string }, Error, string>
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (name: string) => {
      const response = await snapshotClient.delete({ name })
      return { success: response.success, message: response.message }
    },
    onSuccess: (_, name) => {
      // Optimistic update
      queryClient.setQueryData<Snapshot[]>(
        grpcQueryKeys.snapshots,
        (old) => old?.filter((s) => s.name !== name) ?? []
      )
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: grpcQueryKeys.snapshots })
    },
    ...options,
  })
}

/**
 * Restore a snapshot to a deployment with streaming progress
 */
export function useRestoreSnapshot(
  options?: {
    onProgress?: (progress: RestoreSnapshotResponse) => void
    onSuccess?: () => void
    onError?: (error: Error) => void
  }
) {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<RestoreSnapshotResponse | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  const restore = useCallback(
    async (request: { snapshotName: string; targetNamespace: string }) => {
      setIsRestoring(true)
      setProgress(null)
      abortControllerRef.current = new AbortController()

      try {
        const stream = snapshotClient.restore(request, {
          signal: abortControllerRef.current.signal,
        })

        for await (const progressUpdate of stream) {
          setProgress(progressUpdate)
          options?.onProgress?.(progressUpdate)

          if (progressUpdate.completed) {
            // Invalidate deployment queries since data changed
            queryClient.invalidateQueries({
              queryKey: grpcQueryKeys.deployment(request.targetNamespace),
            })
            queryClient.invalidateQueries({ queryKey: grpcQueryKeys.deployments })

            if (!progressUpdate.success || progressUpdate.error) {
              const error = new Error(progressUpdate.error || 'Snapshot restore failed')
              options?.onError?.(error)
              throw error
            } else {
              options?.onSuccess?.()
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        const err = error instanceof Error ? error : new Error(String(error))
        options?.onError?.(err)
        throw err
      } finally {
        setIsRestoring(false)
        abortControllerRef.current = null
      }
    },
    [queryClient, options]
  )

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort()
    setIsRestoring(false)
    setProgress(null)
  }, [])

  return {
    restore,
    cancel,
    progress,
    isRestoring,
  }
}

// ============================================================================
// Infrastructure Hooks
// ============================================================================

/**
 * Fetch infrastructure status (Redis, backup storage health)
 */
export function useInfrastructureStatus(
  options?: Omit<UseQueryOptions<GetInfrastructureStatusResponse, Error>, 'queryKey' | 'queryFn'>
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
  options?: Omit<UseQueryOptions<GetClusterResourcesResponse, Error>, 'queryKey' | 'queryFn'>
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
  options?: {
    includePrereleases?: boolean
    limit?: number
  } & Omit<UseQueryOptions<AvailableVersion[], Error>, 'queryKey' | 'queryFn'>
) {
  const { includePrereleases, limit, ...queryOptions } = options ?? {}

  return useQuery({
    queryKey: [...grpcQueryKeys.availableVersions, { includePrereleases, limit }],
    queryFn: async () => {
      const response = await availableVersionsClient.listAvailableVersions({
        includePrereleases,
        limit,
      })
      return response.versions
    },
    staleTime: 6 * 60 * 60 * 1000, // 6 hours (matches backend cache)
    ...queryOptions,
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
        queryFn: async () => {
          const response = await versionClient.get({ namespace })
          return response.deployment
        },
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
