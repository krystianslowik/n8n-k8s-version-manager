import type {
  Deployment,
  Snapshot,
  InfrastructureStatus,
  DeployRequest,
  AvailableVersionsResponse,
  ApiResponse,
} from './types'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`API error: ${response.statusText}`)
  }

  return response.json()
}

export const api = {
  // Deployments
  async getDeployments(): Promise<Deployment[]> {
    const response = await fetchApi<{ versions: Deployment[] }>('/api/versions')
    return response.versions
  },

  async deployVersion(request: DeployRequest): Promise<ApiResponse> {
    return fetchApi('/api/versions/deploy', {
      method: 'POST',
      body: JSON.stringify(request),
    })
  },

  async deleteDeployment(version: string): Promise<ApiResponse> {
    return fetchApi(`/api/versions/${version}`, {
      method: 'DELETE',
    })
  },

  // Snapshots
  async getSnapshots(): Promise<Snapshot[]> {
    const response = await fetchApi<{ snapshots: Snapshot[] }>('/api/snapshots')
    return response.snapshots
  },

  async createSnapshot(): Promise<ApiResponse> {
    return fetchApi('/api/snapshots/create', {
      method: 'POST',
    })
  },

  async restoreSnapshot(filename: string): Promise<ApiResponse> {
    return fetchApi('/api/snapshots/restore', {
      method: 'POST',
      body: JSON.stringify({ snapshot: filename }),
    })
  },

  // Available versions
  async getAvailableVersions(): Promise<string[]> {
    const response = await fetchApi<AvailableVersionsResponse>('/api/versions/available')
    return response.versions
  },

  // Infrastructure
  async getInfrastructureStatus(): Promise<InfrastructureStatus> {
    return fetchApi('/api/infrastructure/status')
  },
}
