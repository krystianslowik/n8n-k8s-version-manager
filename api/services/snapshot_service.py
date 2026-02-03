"""
gRPC Snapshot Service implementation.
Handles snapshot listing, creation, deletion, and restore operations.
"""
import logging
import os
import re
import subprocess
import tempfile
from typing import List, Dict, Any

from grpclib import GRPCError, Status

import k8s

# Placeholder imports - will be generated from protos
# from generated.n8n_manager.v1 import snapshot_pb2
# from generated.n8n_manager.v1.snapshot_grpc import SnapshotServiceBase

logger = logging.getLogger(__name__)


class SnapshotServiceBase:
    """Placeholder base class - will be replaced by generated code."""
    pass


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
                "name": None
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


class SnapshotService(SnapshotServiceBase):
    """
    gRPC service for database snapshot management.

    Provides:
    - ListSnapshots: List all or filtered snapshots
    - CreateSnapshot: Create auto timestamped snapshot
    - CreateNamedSnapshot: Create named snapshot
    - DeleteSnapshot: Delete a snapshot by filename
    - RestoreSnapshot: Restore to shared database
    - RestoreToDeployment: Restore to specific deployment's isolated DB
    - UploadSnapshot: Upload SQL file as snapshot
    """

    async def ListSnapshots(self, stream) -> None:
        """List all database snapshots."""
        request = await stream.recv_message()
        snapshot_type = getattr(request, 'type', 'all')  # all, named, auto

        try:
            cmd = ["/workspace/scripts/list-snapshots.sh"]
            if snapshot_type == "named":
                cmd.append("--named-only")

            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd="/workspace"
            )

            if result.returncode != 0:
                # Infrastructure not ready, return empty list
                return {"snapshots": []}

            snapshots = parse_snapshots_output(result.stdout, snapshot_type)
            return {"snapshots": snapshots}

        except FileNotFoundError:
            raise GRPCError(Status.INTERNAL, "list-snapshots.sh script not found")
        except Exception as e:
            logger.error(f"ListSnapshots error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def CreateSnapshot(self, stream) -> None:
        """Create an auto-timestamped database snapshot."""
        try:
            result = subprocess.run(
                ["/workspace/scripts/create-snapshot.sh"],
                capture_output=True,
                text=True,
                cwd="/workspace"
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() or result.stdout.strip() or "Snapshot creation failed"
                raise GRPCError(Status.INTERNAL, error_msg)

            return {
                "success": True,
                "message": "Snapshot creation started"
            }

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"CreateSnapshot error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def CreateNamedSnapshot(self, stream) -> None:
        """Create a named database snapshot."""
        request = await stream.recv_message()
        name = request.name
        source = getattr(request, 'source', 'shared')  # "shared" or namespace name

        # Validate name
        if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9_-]*$', name):
            raise GRPCError(Status.INVALID_ARGUMENT, "Invalid snapshot name format")

        # Validate source if not shared
        if source != "shared":
            if not re.match(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$', source):
                raise GRPCError(Status.INVALID_ARGUMENT, "Invalid namespace format")

        try:
            cmd = ["/workspace/scripts/create-named-snapshot.sh", name]
            if source != "shared":
                cmd.extend(["--source", source])

            result = subprocess.run(cmd, capture_output=True, text=True, cwd="/workspace")

            if result.returncode != 0:
                error_msg = result.stderr.strip() or result.stdout.strip() or "Snapshot creation failed"
                raise GRPCError(Status.INTERNAL, error_msg)

            return {
                "success": True,
                "message": f"Named snapshot '{name}' created"
            }

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"CreateNamedSnapshot error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def DeleteSnapshot(self, stream) -> None:
        """Delete a snapshot by filename."""
        request = await stream.recv_message()
        filename = request.filename

        # Validate filename
        if not filename.endswith('.sql'):
            raise GRPCError(Status.INVALID_ARGUMENT, "Filename must end with .sql")
        if '..' in filename or '/' in filename:
            raise GRPCError(Status.INVALID_ARGUMENT, "Invalid filename")

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
                raise GRPCError(Status.INTERNAL, error_msg)

            return {
                "success": True,
                "message": f"Snapshot {filename} deleted"
            }

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"DeleteSnapshot error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def RestoreSnapshot(self, stream) -> None:
        """Restore database from snapshot to shared database."""
        request = await stream.recv_message()
        snapshot = request.snapshot

        try:
            result = subprocess.run(
                ["/workspace/scripts/restore-snapshot.sh", snapshot],
                capture_output=True,
                text=True,
                cwd="/workspace",
                input="yes\n"
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() or result.stdout.strip() or "Restore failed"
                raise GRPCError(Status.INTERNAL, error_msg)

            return {
                "success": True,
                "message": f"Snapshot {snapshot} restored"
            }

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"RestoreSnapshot error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def RestoreToDeployment(self, stream) -> None:
        """Restore snapshot to a specific deployment's isolated database."""
        request = await stream.recv_message()
        snapshot = request.snapshot
        namespace = request.namespace

        # Validate namespace
        if not re.match(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$', namespace):
            raise GRPCError(Status.INVALID_ARGUMENT, "Invalid namespace format")

        try:
            result = subprocess.run(
                ["/workspace/scripts/restore-to-deployment.sh", snapshot, namespace],
                capture_output=True,
                text=True,
                cwd="/workspace"
            )

            if result.returncode != 0:
                error_msg = result.stderr.strip() or result.stdout.strip() or "Restore failed"
                raise GRPCError(Status.INTERNAL, error_msg)

            return {
                "success": True,
                "message": f"Snapshot {snapshot} restored to {namespace}"
            }

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"RestoreToDeployment error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def UploadSnapshot(self, stream) -> None:
        """Upload a SQL file as a snapshot."""
        request = await stream.recv_message()
        name = request.name
        content = request.content  # bytes

        # Validate name
        if not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9_-]*$', name):
            raise GRPCError(Status.INVALID_ARGUMENT, "Invalid snapshot name format")

        # Validate content
        max_size = 500 * 1024 * 1024  # 500MB
        if len(content) > max_size:
            raise GRPCError(Status.INVALID_ARGUMENT, f"File too large. Maximum size is {max_size // (1024*1024)}MB")
        if len(content) == 0:
            raise GRPCError(Status.INVALID_ARGUMENT, "File is empty")

        temp_file = None
        try:
            # Write to temp file
            fd, temp_file = tempfile.mkstemp(suffix='.sql')
            with os.fdopen(fd, 'wb') as f:
                f.write(content)

            # Find backup storage pod
            pods = await k8s.list_pods(
                namespace="n8n-system",
                label_selector="app=backup-storage"
            )
            if not pods:
                raise GRPCError(Status.UNAVAILABLE, "Backup storage unavailable")

            backup_pod = pods[0].metadata.name
            dest_path = f"/backups/snapshots/{name}.sql"

            # Copy file to storage
            cp_result = subprocess.run(
                ["kubectl", "cp", temp_file, f"n8n-system/{backup_pod}:{dest_path}"],
                capture_output=True,
                text=True
            )

            if cp_result.returncode != 0:
                raise GRPCError(Status.INTERNAL, f"Failed to copy file to storage: {cp_result.stderr}")

            return {
                "success": True,
                "message": f"Snapshot '{name}' uploaded successfully",
                "filename": f"{name}.sql"
            }

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"UploadSnapshot error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))
        finally:
            if temp_file and os.path.exists(temp_file):
                os.unlink(temp_file)
