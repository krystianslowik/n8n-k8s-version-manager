"""
gRPC Infrastructure Service implementation.
Handles health checks for shared infrastructure components.
"""
import logging
import os
import sys
from typing import Dict, Any
from datetime import datetime

# Add generated directory to Python path for proto imports
_generated_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'generated')
if _generated_dir not in sys.path:
    sys.path.insert(0, _generated_dir)

import grpc
from google.protobuf import timestamp_pb2

import k8s
from n8n_manager.v1 import infrastructure_pb2
from n8n_manager.v1 import infrastructure_pb2_grpc
from n8n_manager.v1 import common_pb2

logger = logging.getLogger(__name__)


def _format_bytes(bytes_value: int) -> str:
    """Format bytes to human-readable string."""
    if bytes_value is None:
        return "unknown"

    for unit in ['B', 'Ki', 'Mi', 'Gi', 'Ti']:
        if abs(bytes_value) < 1024.0:
            return f"{bytes_value:.1f}{unit}"
        bytes_value /= 1024.0
    return f"{bytes_value:.1f}Pi"


class InfrastructureServicer(infrastructure_pb2_grpc.InfrastructureServiceServicer):
    """
    gRPC service for infrastructure health monitoring.

    Provides:
    - GetStatus: Check Redis and backup storage health
    - GetClusterResources: Get cluster memory/CPU usage
    """

    async def GetStatus(
        self,
        request: infrastructure_pb2.GetInfrastructureStatusRequest,
        context: grpc.aio.ServicerContext
    ) -> infrastructure_pb2.GetInfrastructureStatusResponse:
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

            # Build Redis component status
            redis_healthy = redis_phase == "Running"
            redis_status = infrastructure_pb2.ComponentStatus(
                name="redis",
                healthy=redis_healthy,
                status="healthy" if redis_healthy else "unavailable",
                message=f"Pod phase: {redis_phase or 'unknown'}",
                details={"phase": redis_phase or "unknown"}
            )

            # Build backup storage component status
            backup_healthy = backup_phase == "Running"
            backup_status = infrastructure_pb2.ComponentStatus(
                name="backup-storage",
                healthy=backup_healthy,
                status="healthy" if backup_healthy else "unavailable",
                message=f"Pod phase: {backup_phase or 'unknown'}",
                details={"phase": backup_phase or "unknown"}
            )

            # Create response with timestamp
            response = infrastructure_pb2.GetInfrastructureStatusResponse(
                redis=redis_status,
                backup_storage=backup_status
            )
            response.checked_at.GetCurrentTime()

            return response

        except Exception as e:
            logger.error(f"GetStatus error: {e}")
            await context.abort(grpc.StatusCode.INTERNAL, str(e))

    async def GetClusterResources(
        self,
        request: infrastructure_pb2.GetClusterResourcesRequest,
        context: grpc.aio.ServicerContext
    ) -> infrastructure_pb2.GetClusterResourcesResponse:
        """Get cluster resource usage information."""
        try:
            # Get allocatable memory
            allocatable_memory = await k8s.get_cluster_allocatable_memory()

            # Get total memory requests
            total_requests = await k8s.get_total_memory_requests()

            # Calculate usage percentage
            memory_usage_percent = 0.0
            if allocatable_memory and allocatable_memory > 0:
                memory_usage_percent = (total_requests / allocatable_memory) * 100

            # Build cluster summary
            summary = infrastructure_pb2.ClusterSummary(
                total_nodes=1,  # Docker Desktop typically has 1 node
                ready_nodes=1,
                total_cpu="",  # Not implemented yet
                total_memory=_format_bytes(allocatable_memory) if allocatable_memory else "unknown",
                used_cpu="",  # Not implemented yet
                used_memory=_format_bytes(total_requests),
                cpu_utilization_percent=0.0,  # Not implemented yet
                memory_utilization_percent=round(memory_usage_percent, 2)
            )

            # For now, we return a simple summary without detailed node info
            # Node resources can be added later if needed
            return infrastructure_pb2.GetClusterResourcesResponse(
                nodes=[],  # Could be populated with detailed node info
                summary=summary
            )

        except Exception as e:
            logger.error(f"GetClusterResources error: {e}")
            await context.abort(grpc.StatusCode.INTERNAL, str(e))
