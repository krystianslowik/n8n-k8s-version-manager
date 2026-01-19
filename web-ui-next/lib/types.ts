export interface Deployment {
  namespace: string
  version: string
  status: 'running' | 'pending' | 'failed'
  mode: 'queue' | 'regular'
  url: string
  isolated_db: boolean
}

export interface Snapshot {
  filename: string
  timestamp: string
}

export interface InfrastructureStatus {
  postgres: {
    status: 'healthy' | 'unhealthy'
    message?: string
  }
  redis: {
    status: 'healthy' | 'unhealthy'
    message?: string
  }
}

export interface DeployRequest {
  version: string
  mode: 'queue' | 'regular'
  isolated_db: boolean
  name?: string
}

export interface AvailableVersionsResponse {
  versions: string[]
}

export interface ApiResponse<T = unknown> {
  success: boolean
  message?: string
  error?: string
  data?: T
}
