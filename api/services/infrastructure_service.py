"""
gRPC Infrastructure Service implementation.
Handles health checks for shared infrastructure components.
"""
import logging
from typing import Dict, Any

from grpclib import GRPCError, Status

import k8s

# Placeholder imports - will be generated from protos
# from generated.n8n_manager.v1 import infrastructure_pb2
# from generated.n8n_manager.v1.infrastructure_grpc import InfrastructureServiceBase

logger = logging.getLogger(__name__)


class InfrastructureServiceBase:
    """Placeholder base class - will be replaced by generated code."""
    pass


class InfrastructureService(InfrastructureServiceBase):
    """
    gRPC service for infrastructure health monitoring.

    Provides:
    - GetStatus: Check Redis and backup storage health
    - GetClusterResources: Get cluster memory/CPU usage
    - CheckHealth: Simple health check endpoint
    """

    async def GetStatus(self, stream) -> None:
        """Check Redis and backup storage health."""
        try:
            # Check Redis pod status
            redis_phase = await k8s.get_pod_phase(
                namespace="n8n-system",
                label_selector="app=redis"
            )

            # Check backup storage pod status
            backup_phase = await k8s.get_pod_phase(
                namespace="n8n-system",
                label_selector="app=backup-storage"
            )

            status = {
                "redis": {
                    "status": "healthy" if redis_phase == "Running" else "unavailable",
                    "phase": redis_phase or "unknown"
                },
                "backup": {
                    "status": "healthy" if backup_phase == "Running" else "unavailable",
                    "phase": backup_phase or "unknown"
                }
            }

            return status

        except Exception as e:
            logger.error(f"GetStatus error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def GetClusterResources(self, stream) -> None:
        """Get cluster resource usage information."""
        try:
            # Get allocatable memory
            allocatable_memory = await k8s.get_cluster_allocatable_memory()

            # Get total memory requests
            total_requests = await k8s.get_total_memory_requests()

            # Calculate usage percentage
            usage_percent = 0
            if allocatable_memory and allocatable_memory > 0:
                usage_percent = (total_requests / allocatable_memory) * 100

            resources = {
                "allocatable_memory_bytes": allocatable_memory or 0,
                "requested_memory_bytes": total_requests,
                "memory_usage_percent": round(usage_percent, 2),
                "allocatable_memory_human": _format_bytes(allocatable_memory) if allocatable_memory else "unknown",
                "requested_memory_human": _format_bytes(total_requests),
            }

            return resources

        except Exception as e:
            logger.error(f"GetClusterResources error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def CheckHealth(self, stream) -> None:
        """Simple health check - verifies K8s API connectivity."""
        try:
            healthy = await k8s.check_cluster_health()

            if not healthy:
                raise GRPCError(Status.UNAVAILABLE, "Cannot connect to Kubernetes API")

            return {
                "healthy": True,
                "message": "Kubernetes API is reachable"
            }

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"CheckHealth error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))


def _format_bytes(bytes_value: int) -> str:
    """Format bytes to human-readable string."""
    if bytes_value is None:
        return "unknown"

    for unit in ['B', 'Ki', 'Mi', 'Gi', 'Ti']:
        if abs(bytes_value) < 1024.0:
            return f"{bytes_value:.1f}{unit}"
        bytes_value /= 1024.0
    return f"{bytes_value:.1f}Pi"
