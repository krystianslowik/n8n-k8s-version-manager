'use client'

import { useState, useEffect, useSyncExternalStore, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import type { DeploymentPhaseInfo } from './types'

/**
 * Debounce a value by the specified delay
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => clearTimeout(handler)
  }, [value, delay])

  return debouncedValue
}

import { getActivities, subscribeToActivities, type ActivityItem } from './activity'

/**
 * Subscribe to activity feed with localStorage persistence
 */
export function useActivity(): ActivityItem[] {
  return useSyncExternalStore(
    subscribeToActivities,
    getActivities,
    () => [] // Server snapshot
  )
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

interface UseDeploymentStreamOptions {
  namespace: string
  enabled: boolean
  onPhaseChange?: (phase: DeploymentPhaseInfo) => void
  onComplete?: () => void
  onError?: (error: string) => void
}

/**
 * Subscribe to deployment events via Server-Sent Events (SSE)
 * Provides real-time phase updates during deployment
 */
export function useDeploymentStream({
  namespace,
  enabled,
  onPhaseChange,
  onComplete,
  onError,
}: UseDeploymentStreamOptions) {
  const [phase, setPhase] = useState<DeploymentPhaseInfo | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const toastIdRef = useRef<string | number | null>(null)
  const connectRef = useRef<() => void>(() => {})

  // Store callbacks in refs to avoid stale closures
  const callbacksRef = useRef({ onPhaseChange, onComplete, onError })
  useEffect(() => {
    callbacksRef.current = { onPhaseChange, onComplete, onError }
  })

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const eventSource = new EventSource(
      `${API_URL}/api/versions/${namespace}/events/stream`
    )
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      setIsConnected(true)
      reconnectAttemptsRef.current = 0
    }

    eventSource.addEventListener('connected', () => {
      // Initial connection established
      toastIdRef.current = toast.loading('Deploying...', {
        description: 'Connecting to deployment stream...',
      })
    })

    eventSource.addEventListener('phase', (e) => {
      const data: DeploymentPhaseInfo = JSON.parse(e.data)
      setPhase(data)
      callbacksRef.current.onPhaseChange?.(data)

      // Update toast with phase info
      if (data.phase === 'running') {
        toast.success('Deployment complete', {
          id: toastIdRef.current ?? undefined,
          description: `All pods running (${data.pods_ready}/${data.pods_total})`,
        })
        callbacksRef.current.onComplete?.()
        // Close connection on success
        eventSource.close()
        setIsConnected(false)
      } else if (data.phase === 'failed') {
        toast.error('Deployment failed', {
          id: toastIdRef.current ?? undefined,
          description: data.reason || data.failed_pod || 'Check logs for details',
        })
        callbacksRef.current.onError?.(data.reason || 'Deployment failed')
        // Close connection on failure
        eventSource.close()
        setIsConnected(false)
      } else {
        toast.loading(data.label, {
          id: toastIdRef.current ?? undefined,
          description: data.message || `Phase: ${data.phase}`,
        })
      }
    })

    eventSource.addEventListener('pod_update', () => {
      // Pod updates are informational, phase event handles the important changes
    })

    eventSource.addEventListener('complete', () => {
      eventSource.close()
      setIsConnected(false)
    })

    eventSource.addEventListener('error', (e) => {
      const data = e instanceof MessageEvent ? JSON.parse(e.data) : null
      if (data?.error) {
        toast.error('Stream error', {
          id: toastIdRef.current ?? undefined,
          description: data.error,
        })
      }
    })

    eventSource.onerror = () => {
      setIsConnected(false)
      eventSource.close()

      // Exponential backoff reconnection
      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000)
      reconnectAttemptsRef.current++

      if (reconnectAttemptsRef.current <= 5 && enabled) {
        reconnectTimeoutRef.current = setTimeout(() => {
          connectRef.current()
        }, delay)
      } else if (reconnectAttemptsRef.current > 5) {
        toast.error('Lost connection', {
          id: toastIdRef.current ?? undefined,
          description: 'Falling back to polling. Check deployment status manually.',
        })
        callbacksRef.current.onError?.('Connection lost')
      }
    }
  }, [namespace, enabled])

  // Keep connectRef in sync
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  useEffect(() => {
    if (enabled && namespace) {
      connect()
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      setIsConnected(false)
    }
  }, [enabled, namespace, connect])

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    setIsConnected(false)
  }, [])

  return {
    phase,
    isConnected,
    disconnect,
    reconnect: connect,
  }
}
