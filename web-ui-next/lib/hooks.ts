'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'

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
