// Activity storage module for tracking recent user actions
// Persists to localStorage with 24-hour retention

export type ActivityType = 'deployed' | 'deleted' | 'restored' | 'snapshot'

export interface ActivityItem {
  id: string
  type: ActivityType
  target: string
  timestamp: number
  details?: string
}

const STORAGE_KEY = 'n8n-activity'
const MAX_ITEMS = 20
const MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 hours

let listeners: Array<() => void> = []
let cachedActivities: ActivityItem[] = []
let cacheValid = false

function emitChange() {
  cacheValid = false
  listeners.forEach(listener => listener())
}

function loadActivities(): ActivityItem[] {
  if (typeof window === 'undefined') return []
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return []
    const items: ActivityItem[] = JSON.parse(data)
    const cutoff = Date.now() - MAX_AGE_MS
    return items.filter(item => item.timestamp > cutoff)
  } catch {
    return []
  }
}

export function getActivities(): ActivityItem[] {
  if (!cacheValid) {
    cachedActivities = loadActivities()
    cacheValid = true
  }
  return cachedActivities
}

export function addActivity(type: ActivityType, target: string, details?: string): void {
  if (typeof window === 'undefined') return
  const item: ActivityItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    target,
    timestamp: Date.now(),
    details,
  }
  const current = getActivities()
  const updated = [item, ...current].slice(0, MAX_ITEMS)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  emitChange()
}

export function clearActivities(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
  emitChange()
}

export function subscribeToActivities(callback: () => void): () => void {
  listeners.push(callback)
  return () => {
    listeners = listeners.filter(l => l !== callback)
  }
}
