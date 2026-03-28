"""
Snapshot operations using kubernetes-asyncio.
Replaces shell script logic for snapshots.
"""
import asyncio
import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional, AsyncIterator

from kubernetes_asyncio import client, stream

import k8s

logger = logging.getLogger(__name__)


@dataclass
class SnapshotInfo:
    """Snapshot metadata."""
    name: str
    source_namespace: Optional[str]
    size_bytes: int
    created_at: datetime


async def get_backup_pod() -> str:
    """Get the backup storage pod name."""
    pods = await k8s.list_pods(
        namespace="n8n-system",
        label_selector="app=backup-storage"
    )
    if not pods:
        raise RuntimeError("Backup storage pod not found")
    return pods[0].metadata.name


async def exec_in_pod(
    namespace: str,
    pod_name: str,
    command: List[str],
) -> str:
    """Execute command in pod and return output."""
    api = await k8s.get_client()
    v1 = client.CoreV1Api(api)

    resp = await stream.stream(
        v1.connect_get_namespaced_pod_exec,
        pod_name,
        namespace,
        command=command,
        stderr=True,
        stdin=False,
        stdout=True,
        tty=False,
    )

    return resp


async def list_snapshots() -> List[SnapshotInfo]:
    """List all snapshots from backup storage."""
    backup_pod = await get_backup_pod()

    # List files in snapshots directory
    output = await exec_in_pod(
        "n8n-system",
        backup_pod,
        ["ls", "-la", "/backups/snapshots/"]
    )

    snapshots = []
    for line in output.strip().split('\n'):
        # Parse ls -la output: -rw-r--r-- 1 root root 12345 Jan 20 10:30 name.sql
        parts = line.split()
        if len(parts) >= 9 and parts[-1].endswith('.sql'):
            filename = parts[-1]
            name = filename[:-4]  # Remove .sql extension
            size_bytes = int(parts[4]) if parts[4].isdigit() else 0

            # Parse date (simplified)
            try:
                date_str = f"{parts[5]} {parts[6]} {parts[7]}"
                created_at = datetime.strptime(date_str, "%b %d %H:%M")
                created_at = created_at.replace(year=datetime.now().year)
            except ValueError:
                created_at = datetime.now()

            snapshots.append(SnapshotInfo(
                name=name,
                source_namespace=None,  # Could parse from filename pattern
                size_bytes=size_bytes,
                created_at=created_at,
            ))

    return snapshots


async def create_snapshot(
    name: str,
    source_namespace: str,
) -> AsyncIterator[str]:
    """
    Create a database snapshot from a deployment.
    Yields progress messages.
    """
    # Validate name
    if not re.match(r'^[a-zA-Z0-9_-]+$', name):
        raise ValueError("Invalid snapshot name")

    yield f"Creating snapshot '{name}' from {source_namespace}"

    # Find postgres pod in source namespace
    pods = await k8s.list_pods(
        namespace=source_namespace,
        label_selector="app=postgres"
    )
    if not pods:
        raise RuntimeError(f"No postgres pod found in {source_namespace}")

    postgres_pod = pods[0].metadata.name
    yield f"Found postgres pod: {postgres_pod}"

    # Get backup pod
    backup_pod = await get_backup_pod()

    # Create pg_dump and pipe to backup storage
    yield "Running pg_dump..."

    # Execute pg_dump in postgres pod
    dump_cmd = [
        "pg_dump", "-U", "n8n", "-d", "n8n",
        "--no-owner", "--no-acl", "--clean", "--if-exists"
    ]

    api = await k8s.get_client()
    v1 = client.CoreV1Api(api)

    dump_output = await stream.stream(
        v1.connect_get_namespaced_pod_exec,
        postgres_pod,
        source_namespace,
        command=dump_cmd,
        stderr=True,
        stdin=False,
        stdout=True,
        tty=False,
    )

    yield "Saving to backup storage..."

    # Write dump to backup pod
    dest_path = f"/backups/snapshots/{name}.sql"

    # Use kubectl cp approach for simplicity (stream.stream with stdin is complex)
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.sql', delete=False) as f:
        f.write(dump_output)
        temp_file = f.name

    try:
        proc = await asyncio.create_subprocess_exec(
            "kubectl", "cp", temp_file, f"n8n-system/{backup_pod}:{dest_path}",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()

        if proc.returncode != 0:
            raise RuntimeError("Failed to copy snapshot to backup storage")
    finally:
        os.unlink(temp_file)

    yield f"Snapshot '{name}' created successfully"


async def delete_snapshot(name: str) -> None:
    """Delete a snapshot from backup storage."""
    backup_pod = await get_backup_pod()

    # Remove the file
    await exec_in_pod(
        "n8n-system",
        backup_pod,
        ["rm", "-f", f"/backups/snapshots/{name}.sql"]
    )

    logger.info(f"Deleted snapshot {name}")


async def restore_snapshot(
    snapshot_name: str,
    target_namespace: str,
) -> AsyncIterator[str]:
    """
    Restore a snapshot to a deployment.
    Yields progress messages.
    """
    yield f"Restoring '{snapshot_name}' to {target_namespace}"

    # Find postgres pod in target namespace
    pods = await k8s.list_pods(
        namespace=target_namespace,
        label_selector="app=postgres"
    )
    if not pods:
        raise RuntimeError(f"No postgres pod found in {target_namespace}")

    postgres_pod = pods[0].metadata.name
    yield f"Found postgres pod: {postgres_pod}"

    # Get backup pod and snapshot file
    backup_pod = await get_backup_pod()
    snapshot_path = f"/backups/snapshots/{snapshot_name}.sql"

    # Verify snapshot exists
    try:
        await exec_in_pod("n8n-system", backup_pod, ["test", "-f", snapshot_path])
    except Exception:
        raise RuntimeError(f"Snapshot '{snapshot_name}' not found")

    yield "Reading snapshot..."

    # Read snapshot content
    snapshot_content = await exec_in_pod(
        "n8n-system",
        backup_pod,
        ["cat", snapshot_path]
    )

    yield "Applying to database..."

    # Execute in postgres pod via psql
    api = await k8s.get_client()
    v1 = client.CoreV1Api(api)

    # This is simplified - actual implementation would stream the SQL
    restore_cmd = ["psql", "-U", "n8n", "-d", "n8n"]

    resp = await stream.stream(
        v1.connect_get_namespaced_pod_exec,
        postgres_pod,
        target_namespace,
        command=restore_cmd,
        stderr=True,
        stdin=True,
        stdout=True,
        tty=False,
        _preload_content=False,
    )

    # Send snapshot content as stdin
    await resp.write_stdin(snapshot_content)
    await resp.close()

    yield f"Snapshot '{snapshot_name}' restored to {target_namespace}"
