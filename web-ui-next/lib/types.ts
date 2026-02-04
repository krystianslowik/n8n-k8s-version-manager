/**
 * Frontend-only types for forms and REST upload
 *
 * Note: Most data types are now generated from protobuf definitions.
 * Import from '@/lib/generated/n8n_manager/v1/...' for:
 *   - Deployment, DeploymentPhase, PodStatus, ContainerStatus
 *   - Snapshot, Event (K8sEvent), PodLogs
 *   - ClusterSummary, NodeResources, ComponentStatus
 */

// ============================================================================
// Component UI types (used by UI components for display)
// ============================================================================

/**
 * Deployment phase values for UI status display
 */
export type DeploymentPhase =
  | 'db-starting'
  | 'n8n-starting'
  | 'workers-starting'
  | 'running'
  | 'failed'
  | 'deleting'
  | 'unknown'

/**
 * Deployment data for UI components
 * Adapters in page.tsx convert proto types to this interface
 */
export interface DeploymentDisplay {
  namespace: string
  name?: string
  version: string
  status: string
  phase?: string
  phase_info?: {
    phase: string
    label: string
    pods_ready?: number
    pods_total?: number
  }
  mode: string
  url?: string
  snapshot?: string
  created_at?: string
}

/**
 * Snapshot data for UI components
 * Adapters in page.tsx convert proto types to this interface
 */
export interface SnapshotDisplay {
  filename: string
  name?: string
  type: 'named' | 'auto'
  timestamp?: string
  created?: string
  size?: string
  source?: string
}

// ============================================================================
// REST upload types (file uploads require REST/multipart, not gRPC)
// ============================================================================

/**
 * Response from REST snapshot upload endpoint
 * (File uploads require REST/multipart, not gRPC)
 */
export interface SnapshotActionResponse {
  success: boolean
  message?: string
  error?: string
  output?: string
}

/**
 * Environment variable for deployment configuration
 */
export interface EnvVar {
  key: string
  value: string
}

/**
 * Resource requests and limits specification
 */
export interface ResourceSpec {
  requests?: { cpu?: string; memory?: string }
  limits?: { cpu?: string; memory?: string }
}

/**
 * Helm values for n8n deployment configuration
 * Used in the deploy drawer form
 */
export interface HelmValues {
  // Database settings
  database?: {
    isolated?: {
      image?: string
      storage?: {
        size?: string
      }
    }
  }

  // Redis settings (queue mode only)
  redis?: {
    host?: string
    port?: number
  }

  // n8n configuration
  n8nConfig?: {
    encryptionKey?: string
    timezone?: string
    webhookUrl?: string
  }

  // Resources for containers
  resources?: {
    main?: ResourceSpec
    worker?: ResourceSpec
    webhook?: ResourceSpec
  }

  // Replicas
  replicas?: {
    workers?: number
  }

  // Service configuration
  service?: {
    type?: 'NodePort' | 'LoadBalancer' | 'ClusterIP'
  }

  // Extra environment variables
  extraEnv?: Record<string, string>

  // Raw YAML override (merged last, takes precedence)
  rawYaml?: string
}
