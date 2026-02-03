import { createChannel, createClient } from 'nice-grpc-web'

// Import generated service definitions (will exist after protoc codegen)
// These imports will be resolved once you run buf generate or protoc
// import { VersionServiceDefinition } from './generated/version_pb'
// import { SnapshotServiceDefinition } from './generated/snapshot_pb'
// import { InfrastructureServiceDefinition } from './generated/infrastructure_pb'

/**
 * gRPC channel configuration
 * Uses NEXT_PUBLIC_GRPC_URL environment variable or defaults to localhost:8080
 */
const GRPC_URL = process.env.NEXT_PUBLIC_GRPC_URL || 'http://localhost:8080'

/**
 * Create the gRPC-Web channel
 * This channel is shared across all service clients
 */
export const channel = createChannel(GRPC_URL)

/**
 * Type placeholders for generated service definitions
 * Replace these with actual imports once protoc generates the TypeScript files
 */

// Version Service - manages n8n deployments
export interface VersionServiceDefinition {
  listDeployments: {
    request: Record<string, never>
    response: { deployments: Deployment[] }
  }
  getDeployment: {
    request: { namespace: string }
    response: Deployment
  }
  deployVersion: {
    request: DeployRequest
    response: AsyncIterable<DeploymentProgress>
  }
  deleteDeployment: {
    request: { namespace: string }
    response: { success: boolean; message?: string }
  }
  getDeploymentLogs: {
    request: { namespace: string; pod?: string; container?: string; tail?: number }
    response: AsyncIterable<LogEntry>
  }
  getDeploymentEvents: {
    request: { namespace: string; limit?: number }
    response: { events: K8sEvent[] }
  }
  getDeploymentConfig: {
    request: { namespace: string }
    response: { config: Record<string, string> }
  }
  getAvailableVersions: {
    request: Record<string, never>
    response: { versions: string[] }
  }
}

// Snapshot Service - manages database snapshots
export interface SnapshotServiceDefinition {
  listSnapshots: {
    request: Record<string, never>
    response: { snapshots: Snapshot[] }
  }
  listNamedSnapshots: {
    request: Record<string, never>
    response: { snapshots: Snapshot[] }
  }
  createSnapshot: {
    request: { name?: string; source?: string }
    response: { success: boolean; message?: string; filename?: string }
  }
  deleteSnapshot: {
    request: { filename: string }
    response: { success: boolean; message?: string }
  }
  restoreSnapshot: {
    request: { snapshot: string; namespace: string }
    response: { success: boolean; message?: string }
  }
}

// Infrastructure Service - health checks and cluster status
export interface InfrastructureServiceDefinition {
  getStatus: {
    request: Record<string, never>
    response: InfrastructureStatus
  }
  getClusterResources: {
    request: Record<string, never>
    response: ClusterResources
  }
}

/**
 * Shared types used by gRPC services
 * These mirror the REST API types but are defined here for gRPC responses
 */
export interface Deployment {
  namespace: string
  name?: string
  version: string
  status: 'running' | 'pending' | 'failed' | 'unknown'
  phase?: DeploymentPhase
  phaseInfo?: DeploymentPhaseInfo
  mode: 'queue' | 'regular' | ''
  url?: string
  isolatedDb: boolean
  snapshot?: string
  createdAt?: string
}

export type DeploymentPhase =
  | 'db-starting'
  | 'n8n-starting'
  | 'workers-starting'
  | 'running'
  | 'failed'
  | 'unknown'

export interface DeploymentPhaseInfo {
  phase: DeploymentPhase
  label: string
  message?: string
  failedPod?: string
  reason?: string
  podsReady?: number
  podsTotal?: number
}

export interface DeployRequest {
  version: string
  mode: 'queue' | 'regular'
  name?: string
  snapshot?: string
  helmValues?: HelmValues
}

export interface HelmValues {
  database?: {
    isolated?: {
      image?: string
      storage?: { size?: string }
    }
  }
  redis?: { host?: string; port?: number }
  n8nConfig?: {
    encryptionKey?: string
    timezone?: string
    webhookUrl?: string
  }
  resources?: {
    main?: ResourceSpec
    worker?: ResourceSpec
    webhook?: ResourceSpec
  }
  replicas?: { workers?: number }
  service?: { type?: 'NodePort' | 'LoadBalancer' | 'ClusterIP' }
  extraEnv?: Record<string, string>
  rawYaml?: string
}

export interface ResourceSpec {
  requests?: { cpu?: string; memory?: string }
  limits?: { cpu?: string; memory?: string }
}

export interface DeploymentProgress {
  phase: DeploymentPhase
  label: string
  message?: string
  progress?: number
  complete: boolean
  error?: string
}

export interface LogEntry {
  timestamp: string
  pod: string
  container?: string
  message: string
}

export interface K8sEvent {
  type: 'Normal' | 'Warning'
  reason: string
  message: string
  timestamp: string
  count: number
  object: { kind: string; name: string }
}

export interface Snapshot {
  filename: string
  name?: string
  type: 'named' | 'auto'
  timestamp?: string
  created?: string
  size?: string
  source?: string
}

export interface InfrastructureStatus {
  redis: { status: 'healthy' | 'unavailable'; message?: string }
  backup: { status: 'healthy' | 'unavailable'; message?: string }
}

export interface ClusterResources {
  error?: string
  memory: {
    allocatableMi: number
    usedMi: number
    availableMi: number
    utilizationPercent: number
  } | null
  canDeploy: { queueMode: boolean; regularMode: boolean }
  deployments: Array<{
    namespace: string
    memoryMi: number
    mode: 'queue' | 'regular'
    ageSeconds: number
  }>
}

/**
 * Service client instances
 *
 * Usage:
 * ```typescript
 * import { versionClient, snapshotClient, infrastructureClient } from './grpc-client'
 *
 * // List deployments
 * const { deployments } = await versionClient.listDeployments({})
 *
 * // Stream deployment progress
 * for await (const progress of versionClient.deployVersion(request)) {
 *   console.log(progress.phase, progress.message)
 * }
 * ```
 *
 * NOTE: Uncomment these exports once the service definitions are generated
 */

// export const versionClient = createClient(VersionServiceDefinition, channel)
// export const snapshotClient = createClient(SnapshotServiceDefinition, channel)
// export const infrastructureClient = createClient(InfrastructureServiceDefinition, channel)

/**
 * Placeholder clients that throw errors until protoc generates the service definitions
 * Remove these once you have the actual generated code
 */
const notImplementedError = () => {
  throw new Error(
    'gRPC client not configured. Run protoc to generate service definitions, ' +
    'then uncomment the client exports in grpc-client.ts'
  )
}

export const versionClient = {
  listDeployments: notImplementedError,
  getDeployment: notImplementedError,
  deployVersion: notImplementedError,
  deleteDeployment: notImplementedError,
  getDeploymentLogs: notImplementedError,
  getDeploymentEvents: notImplementedError,
  getDeploymentConfig: notImplementedError,
  getAvailableVersions: notImplementedError,
} as const

export const snapshotClient = {
  listSnapshots: notImplementedError,
  listNamedSnapshots: notImplementedError,
  createSnapshot: notImplementedError,
  deleteSnapshot: notImplementedError,
  restoreSnapshot: notImplementedError,
} as const

export const infrastructureClient = {
  getStatus: notImplementedError,
  getClusterResources: notImplementedError,
} as const
