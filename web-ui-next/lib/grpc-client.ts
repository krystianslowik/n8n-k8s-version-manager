import { createClient, type Client } from '@connectrpc/connect'
import { createGrpcWebTransport } from '@connectrpc/connect-web'

// Import generated service definitions
import { VersionService } from './generated/n8n_manager/v1/version_pb'
import { SnapshotService } from './generated/n8n_manager/v1/snapshot_pb'
import { InfrastructureService } from './generated/n8n_manager/v1/infrastructure_pb'
import { AvailableVersionsService } from './generated/n8n_manager/v1/available_versions_pb'

// Re-export types from generated files for convenience
export type {
  Deployment,
  DeploymentPhase,
  PodStatus,
  Snapshot,
  ResourceUsage,
} from './generated/n8n_manager/v1/common_pb'

export type {
  ListDeploymentsRequest,
  ListDeploymentsResponse,
  GetDeploymentRequest,
  GetDeploymentResponse,
  DeployRequest,
  DeployResponse,
  DeleteDeploymentRequest,
  DeleteDeploymentResponse,
  WatchStatusRequest,
  WatchStatusResponse,
  StreamLogsRequest,
  LogEntry,
  GetConfigRequest,
  GetConfigResponse,
  GetEventsRequest,
  GetEventsResponse,
  Event,
} from './generated/n8n_manager/v1/version_pb'

export type {
  ListSnapshotsRequest,
  ListSnapshotsResponse,
  CreateSnapshotRequest,
  CreateSnapshotResponse,
  DeleteSnapshotRequest,
  DeleteSnapshotResponse,
  RestoreSnapshotRequest,
  RestoreSnapshotResponse,
} from './generated/n8n_manager/v1/snapshot_pb'

export type {
  GetInfrastructureStatusRequest,
  GetInfrastructureStatusResponse,
  ComponentStatus,
  GetClusterResourcesRequest,
  GetClusterResourcesResponse,
  NodeResources,
  ResourceCapacity,
  ClusterSummary,
} from './generated/n8n_manager/v1/infrastructure_pb'

export type {
  ListAvailableVersionsRequest,
  ListAvailableVersionsResponse,
  AvailableVersion,
} from './generated/n8n_manager/v1/available_versions_pb'

/**
 * gRPC-Web transport configuration
 * Uses NEXT_PUBLIC_GRPC_URL environment variable or defaults to localhost:8080
 */
const GRPC_URL = process.env.NEXT_PUBLIC_GRPC_URL || 'http://localhost:8080'

/**
 * Create the gRPC-Web transport
 * This transport is shared across all service clients
 */
export const transport = createGrpcWebTransport({
  baseUrl: GRPC_URL,
})

/**
 * Service client types for better type inference
 */
export type VersionClient = Client<typeof VersionService>
export type SnapshotClient = Client<typeof SnapshotService>
export type InfrastructureClient = Client<typeof InfrastructureService>
export type AvailableVersionsClient = Client<typeof AvailableVersionsService>

/**
 * Service client instances
 *
 * Usage:
 * ```typescript
 * import { versionClient, snapshotClient, infrastructureClient, availableVersionsClient } from './grpc-client'
 *
 * // List deployments (unary call)
 * const response = await versionClient.list({})
 * console.log(response.deployments)
 *
 * // Deploy with streaming progress (server streaming)
 * for await (const progress of versionClient.deploy({ version: '1.85.0', mode: 'regular' })) {
 *   console.log(progress.phase, progress.message)
 * }
 *
 * // Stream logs (server streaming)
 * for await (const entry of versionClient.streamLogs({ namespace: 'n8n-v1-85-0' })) {
 *   console.log(entry.message)
 * }
 * ```
 */
export const versionClient: VersionClient = createClient(VersionService, transport)
export const snapshotClient: SnapshotClient = createClient(SnapshotService, transport)
export const infrastructureClient: InfrastructureClient = createClient(InfrastructureService, transport)
export const availableVersionsClient: AvailableVersionsClient = createClient(AvailableVersionsService, transport)
