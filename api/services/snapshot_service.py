"""
gRPC Snapshot Service implementation.
Handles snapshot listing, creation, deletion, and restore operations.
"""
import logging
import os
import re
import subprocess
import sys
import tempfile
from typing import List, Dict, Any, AsyncIterator

# Add generated directory to Python path for proto imports
_generated_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'generated')
if _generated_dir not in sys.path:
    sys.path.insert(0, _generated_dir)

import grpc
from google.protobuf import timestamp_pb2

import k8s
from n8n_manager.v1 import snapshot_pb2
from n8n_manager.v1 import snapshot_pb2_grpc
from n8n_manager.v1 import common_pb2

logger = logging.getLogger(__name__)


def parse_snapshots_output(output: str, snapshot_type: str = "all") -> List[Dict[str, Any]]:
    """Parse list-snapshots.sh output into structured data."""
    snapshots = []
    lines = output.strip().split('\n')

    for line in lines:
        if not line.strip() or not line.endswith('.sql'):
            continue

        filename = line.strip()

        # Determine if named or timestamped
        is_named = not filename.startswith('n8n-')

        if not is_named:
            # Auto snapshot with timestamp
            timestamp_match = re.search(r'n8n-(\d{8})-(\d{6})', filename)
            if timestamp_match:
                date_str = timestamp_match.group(1)
                time_str = timestamp_match.group(2)
                timestamp = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]} {time_str[:2]}:{time_str[2:4]}:{time_str[4:6]}"
            else:
                timestamp = "Unknown"

            snapshots.append({
                "filename": filename,
                "timestamp": timestamp,
                "type": "auto",
                "name": filename.replace('.sql', '')
            })
        else:
            # Named snapshot
            name = filename.replace('.sql', '')
            snapshots.append({
                "filename": filename,
                "name": name,
                "type": "named",
                "timestamp": None
            })

    # Filter by type if requested
    if snapshot_type == "named":
        snapshots = [s for s in snapshots if s["type"] == "named"]
    elif snapshot_type == "auto":
        snapshots = [s for s in snapshots if s["type"] == "auto"]

    return snapshots


def _create_snapshot(snapshot_data: Dict) -> common_pb2.Snapshot:
    """Create a Snapshot proto message from dict."""
    return common_pb2.Snapshot(
        name=snapshot_data.get("name", ""),
        source_namespace=snapshot_data.get("source_namespace", ""),
        size_bytes=snapshot_data.get("size_bytes", 0)
    )


class SnapshotServicer(snapshot_pb2_grpc.SnapshotServiceServicer):
    """
    gRPC service for database snapshot management.

    Provides:
    - List: List all or filtered snapshots
    - Create: Create named snapshot (streaming progress)
    - Delete: Delete a snapshot by name
    - Restore: Restore snapshot to deployment (streaming progress)
    """

    async def List(
        self,
        request: snapshot_pb2.ListSnapshotsRequest,
        context: grpc.aio.ServicerContext
    ) -> snapshot_pb2.ListSnapshotsResponse:
        """List all database snapshots."""
        try:
            cmd = ["/workspace/scripts/list-snapshots.sh"]

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd="/workspace"
            )

            if result.returncode != 0:
                # Infrastructure not ready, return empty list
                return snapshot_pb2.ListSnapshotsResponse(snapshots=[])

            snapshots_data = parse_snapshots_output(result.stdout)

            snapshots = []
            for s in snapshots_data:
                snapshot = common_pb2.Snapshot(
                    name=s.get("name", ""),
                    source_namespace="",  # Not available from list output
                    size_bytes=0  # Not available from list output
                )
                snapshots.append(snapshot)

            return snapshot_pb2.ListSnapshotsResponse(snapshots=snapshots)

        except FileNotFoundError:
            await context.abort(grpc.StatusCode.INTERNAL, "list-snapshots.sh script not found")
        except Exception as e:
            logger.error(f"List error: {e}")
            await context.abort(grpc.StatusCode.INTERNAL, str(e))

    async def Create(
        self,
        request: snapshot_pb2.CreateSnapshotRequest,
        context: grpc.aio.ServicerContext
    ) -> AsyncIterator[snapshot_pb2.CreateSnapshotResponse]:
        """Create a named database snapshot with progress streaming."""
        name = request.name
        source_namespace = request.source_namespace

        # Validate name
        if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9_-]*$', name):
            yield snapshot_pb2.CreateSnapshotResponse(
                phase="failed",
                message="Invalid snapshot name format",
                completed=True,
                success=False,
                error="Invalid snapshot name format"
            )
            return

        # Validate source if specified
        if source_namespace and not re.match(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$', source_namespace):
            yield snapshot_pb2.CreateSnapshotResponse(
                phase="failed",
                message="Invalid namespace format",
                completed=True,
                success=False,
                error="Invalid namespace format"
            )
            return

        try:
            yield snapshot_pb2.CreateSnapshotResponse(
                phase="starting",
                message=f"Creating snapshot '{name}'...",
                completed=False,
                success=False
            )

            cmd = ["/workspace/scripts/create-named-snapshot.sh", name]
            if source_namespace:
                cmd.extend(["--source", source_namespace])

            yield snapshot_pb2.CreateSnapshotResponse(
                phase="creating",
                message="Running pg_dump...",
                completed=False,
                success=False
            )

            result = subprocess.run(cmd, capture_output=True, text=True, cwd="/workspace")

            if result.returncode != 0:
                error_msg = result.stderr.strip() or result.stdout.strip() or "Snapshot creation failed"
                yield snapshot_pb2.CreateSnapshotResponse(
                    phase="failed",
                    message=error_msg,
                    completed=True,
                    success=False,
                    error=error_msg
                )
                return

            snapshot = common_pb2.Snapshot(
                name=name,
                source_namespace=source_namespace or "shared",
                size_bytes=0
            )

            yield snapshot_pb2.CreateSnapshotResponse(
                phase="completed",
                message=f"Snapshot '{name}' created successfully",
                completed=True,
                success=True,
                snapshot=snapshot
            )

        except Exception as e:
            logger.error(f"Create error: {e}")
            yield snapshot_pb2.CreateSnapshotResponse(
                phase="failed",
                message=str(e),
                completed=True,
                success=False,
                error=str(e)
            )

    async def Delete(
        self,
        request: snapshot_pb2.DeleteSnapshotRequest,
        context: grpc.aio.ServicerContext
    ) -> snapshot_pb2.DeleteSnapshotResponse:
        """Delete a snapshot by name."""
        name = request.name

        # Validate name
        if not name:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Snapshot name is required")

        # Build filename
        filename = name if name.endswith('.sql') else f"{name}.sql"

        # Validate filename
        if '..' in filename or '/' in filename:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "Invalid filename")

        try:
            result = subprocess.run(
                ["/workspace/scripts/delete-snapshot.sh", filename],
                capture_output=True,
                text=True,
                cwd="/workspace",
                input="yes\n"
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() or result.stdout.strip() or "Delete failed"
                await context.abort(grpc.StatusCode.INTERNAL, error_msg)

            return snapshot_pb2.DeleteSnapshotResponse(
                success=True,
                message=f"Snapshot {name} deleted"
            )

        except grpc.aio.AbortError:
            raise
        except Exception as e:
            logger.error(f"Delete error: {e}")
            await context.abort(grpc.StatusCode.INTERNAL, str(e))

    async def Restore(
        self,
        request: snapshot_pb2.RestoreSnapshotRequest,
        context: grpc.aio.ServicerContext
    ) -> AsyncIterator[snapshot_pb2.RestoreSnapshotResponse]:
        """Restore snapshot to a deployment with progress streaming."""
        snapshot_name = request.snapshot_name
        target_namespace = request.target_namespace

        # Validate namespace
        if target_namespace and not re.match(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$', target_namespace):
            yield snapshot_pb2.RestoreSnapshotResponse(
                phase="failed",
                message="Invalid namespace format",
                completed=True,
                success=False,
                error="Invalid namespace format"
            )
            return

        try:
            yield snapshot_pb2.RestoreSnapshotResponse(
                phase="starting",
                message=f"Restoring snapshot '{snapshot_name}'...",
                completed=False,
                success=False
            )

            if target_namespace:
                # Restore to specific deployment
                cmd = ["/workspace/scripts/restore-to-deployment.sh", snapshot_name, target_namespace]
            else:
                # Restore to shared database
                cmd = ["/workspace/scripts/restore-snapshot.sh", snapshot_name]

            yield snapshot_pb2.RestoreSnapshotResponse(
                phase="restoring",
                message="Running pg_restore...",
                completed=False,
                success=False
            )

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd="/workspace",
                input="yes\n" if not target_namespace else None
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() or result.stdout.strip() or "Restore failed"
                yield snapshot_pb2.RestoreSnapshotResponse(
                    phase="failed",
                    message=error_msg,
                    completed=True,
                    success=False,
                    error=error_msg
                )
                return

            target = target_namespace if target_namespace else "shared database"
            yield snapshot_pb2.RestoreSnapshotResponse(
                phase="completed",
                message=f"Snapshot '{snapshot_name}' restored to {target}",
                completed=True,
                success=True
            )

        except Exception as e:
            logger.error(f"Restore error: {e}")
            yield snapshot_pb2.RestoreSnapshotResponse(
                phase="failed",
                message=str(e),
                completed=True,
                success=False,
                error=str(e)
            )
