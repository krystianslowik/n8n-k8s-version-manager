# gRPC Migration Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete the gRPC migration by fixing port formula inconsistency, removing duplicate REST code, and migrating shell script logic to kubernetes-asyncio SDK.

**Architecture:** The gRPC server (server.py) becomes the sole API entry point. REST endpoints are removed except for file upload (requires multipart). Shell script logic is replaced with direct kubernetes-asyncio SDK calls in Python services.

**Tech Stack:** Python 3.11, grpcio-asyncio, kubernetes-asyncio, Helm SDK (subprocess for now), FastAPI (upload only)

---

## Phase 1: Fix Port Formula Inconsistency

### Task 1.1: Fix REST API Port Formula

**Files:**
- Modify: `api/versions.py:548-550`

**Step 1: Update port formula to match gRPC service**

Change from `major * 100` to `major * 1000`:

```python
# Line 548-550, change:
        # Formula: 30000 + major*100 + minor*10 + patch
        # ...
        port = 30000 + (int(version_parts[0]) * 100) + (int(version_parts[1]) * 10) + int(version_parts[2])

# To:
        # Formula: 30000 + major*1000 + minor*10 + patch
        # Strips pre-release suffix (e.g., "8-exp" -> "8")
        patch_str = version_parts[2].split('-')[0]
        port = 30000 + (int(version_parts[0]) * 1000) + (int(version_parts[1]) * 10) + int(patch_str)
```

**Step 2: Verify formula matches**

Run: `grep -n "30000.*\*" api/versions.py api/services/version_service.py`

Expected: Both files show `major * 1000`

**Step 3: Commit**

```bash
git add api/versions.py
git commit -m "fix: align REST port formula with gRPC (major*1000)"
```

---

## Phase 2: Remove Duplicate REST Code

### Task 2.1: Create Minimal Upload-Only REST Router

**Files:**
- Create: `api/upload.py`
- Modify: `api/main.py`

**Step 1: Create upload.py with only the upload endpoint**

```python
"""
REST endpoint for file uploads only.
File uploads require multipart/form-data which gRPC doesn't support well.
All other operations use gRPC via server.py.
"""
import os
import tempfile
import subprocess
from fastapi import APIRouter, HTTPException, File, UploadFile, Form

import k8s

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])

# Max file size: 500MB
MAX_UPLOAD_SIZE = 500 * 1024 * 1024


def validate_snapshot_name(name: str) -> None:
    """Validate snapshot name contains only safe characters."""
    import re
    if not re.match(r'^[a-zA-Z0-9_-]+$', name):
        raise HTTPException(
            status_code=400,
            detail="Snapshot name must contain only letters, numbers, hyphens, and underscores"
        )
    if len(name) > 63:
        raise HTTPException(status_code=400, detail="Snapshot name must be 63 characters or less")


@router.post("/upload")
async def upload_snapshot(
    file: UploadFile = File(...),
    name: str = Form(...)
):
    """Upload a SQL snapshot file."""
    validate_snapshot_name(name)

    if not file.filename or not file.filename.endswith('.sql'):
        raise HTTPException(status_code=400, detail="File must be a .sql file")

    temp_file = None
    try:
        content = await file.read()
        if len(content) > MAX_UPLOAD_SIZE:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum size is {MAX_UPLOAD_SIZE // (1024*1024)}MB"
            )

        if len(content) == 0:
            raise HTTPException(status_code=400, detail="File is empty")

        fd, temp_file = tempfile.mkstemp(suffix='.sql')
        with os.fdopen(fd, 'wb') as f:
            f.write(content)

        # Find backup storage pod using k8s module
        pods = await k8s.list_pods(
            namespace="n8n-system",
            label_selector="app=backup-storage"
        )
        if not pods:
            raise HTTPException(status_code=503, detail="Backup storage unavailable")

        backup_pod = pods[0].metadata.name
        dest_path = f"/backups/snapshots/{name}.sql"

        cp_result = subprocess.run(
            ["kubectl", "cp", temp_file, f"n8n-system/{backup_pod}:{dest_path}"],
            capture_output=True,
            text=True
        )

        if cp_result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to copy file to storage: {cp_result.stderr}"
            )

        return {
            "success": True,
            "message": f"Snapshot '{name}' uploaded successfully",
            "filename": f"{name}.sql"
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if temp_file and os.path.exists(temp_file):
            os.unlink(temp_file)
```

**Step 2: Commit upload.py**

```bash
git add api/upload.py
git commit -m "refactor: extract upload endpoint to dedicated module"
```

### Task 2.2: Simplify main.py - Remove REST Routers

**Files:**
- Modify: `api/main.py`

**Step 1: Update main.py to only include upload router**

Replace the entire file:

```python
"""
Minimal FastAPI app for file uploads only.
All other API operations use gRPC via server.py.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import k8s


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await k8s.close_client()


app = FastAPI(
    title="n8n Version Manager - Upload API",
    description="File upload endpoint only. Use gRPC for all other operations.",
    lifespan=lifespan
)

# CORS middleware - allow Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    if await k8s.check_cluster_health():
        return {"status": "ok"}
    return {"status": "degraded", "error": "Cannot reach Kubernetes cluster"}


# Only include upload router - all other operations use gRPC
from upload import router as upload_router
app.include_router(upload_router)
```

**Step 2: Commit main.py changes**

```bash
git add api/main.py
git commit -m "refactor: remove REST routers, keep only upload endpoint"
```

### Task 2.3: Delete Obsolete REST Files

**Files:**
- Delete: `api/versions.py`
- Delete: `api/snapshots.py`
- Delete: `api/available_versions.py`
- Delete: `api/infrastructure.py`
- Delete: `api/cluster.py`

**Step 1: Remove the files**

```bash
rm api/versions.py api/snapshots.py api/available_versions.py api/infrastructure.py api/cluster.py
```

**Step 2: Commit deletions**

```bash
git add -A
git commit -m "refactor: remove duplicate REST API files (gRPC replaces them)"
```

---

## Phase 3: Migrate Shell Scripts to Python SDK

### Task 3.1: Create Deployment Module with kubernetes-asyncio

**Files:**
- Create: `api/deployment.py`

**Step 1: Create deployment.py with Helm operations**

```python
"""
Deployment operations using kubernetes-asyncio and Helm.
Replaces deploy-version.sh shell script logic.
"""
import asyncio
import logging
import os
import tempfile
from typing import Dict, Any, Optional, AsyncIterator

import yaml
from kubernetes_asyncio import client

import k8s

logger = logging.getLogger(__name__)

# Resource requirements
REGULAR_MODE_MEMORY_MI = 512  # n8n main
QUEUE_MODE_MEMORY_MI = 1280   # main + workers + webhook
DB_MEMORY_MI = 256            # PostgreSQL


def calculate_port(version: str) -> int:
    """
    Calculate NodePort from version string.
    Formula: 30000 + (major * 1000) + (minor * 10) + patch
    Handles pre-release versions like 1.76.8-exp.
    """
    if version == 'unknown':
        return 0
    try:
        parts = version.split('.')
        major = int(parts[0])
        minor = int(parts[1])
        patch_str = parts[2].split('-')[0]  # Strip pre-release suffix
        patch = int(patch_str)
        return 30000 + (major * 1000) + (minor * 10) + patch
    except (ValueError, IndexError):
        return 0


def version_to_namespace(version: str) -> str:
    """Convert version string to Kubernetes namespace name."""
    return f"n8n-v{version.replace('.', '-')}"


async def check_cluster_capacity(is_queue_mode: bool) -> Dict[str, Any]:
    """
    Check if cluster has enough memory for deployment.
    Returns dict with 'can_deploy', 'available_mi', 'required_mi'.
    """
    api = await k8s.get_client()
    v1 = client.CoreV1Api(api)

    # Get node allocatable memory
    nodes = await v1.list_node()
    if not nodes.items:
        return {"can_deploy": False, "error": "No nodes found"}

    # Sum allocatable memory across all nodes
    total_allocatable_mi = 0
    for node in nodes.items:
        mem_str = node.status.allocatable.get("memory", "0")
        if mem_str.endswith("Ki"):
            total_allocatable_mi += int(mem_str[:-2]) // 1024
        elif mem_str.endswith("Mi"):
            total_allocatable_mi += int(mem_str[:-2])
        elif mem_str.endswith("Gi"):
            total_allocatable_mi += int(mem_str[:-2]) * 1024

    # Get current memory usage from running pods
    pods = await v1.list_pod_for_all_namespaces()
    used_mi = 0
    for pod in pods.items:
        if pod.status.phase not in ["Running", "Pending"]:
            continue
        for container in pod.spec.containers:
            mem_req = container.resources.requests.get("memory", "0") if container.resources and container.resources.requests else "0"
            if mem_req.endswith("Mi"):
                used_mi += int(mem_req[:-2])
            elif mem_req.endswith("Gi"):
                used_mi += int(mem_req[:-2]) * 1024

    available_mi = total_allocatable_mi - used_mi
    required_mi = (QUEUE_MODE_MEMORY_MI if is_queue_mode else REGULAR_MODE_MEMORY_MI) + DB_MEMORY_MI

    return {
        "can_deploy": available_mi >= required_mi,
        "available_mi": available_mi,
        "required_mi": required_mi,
        "total_mi": total_allocatable_mi,
        "used_mi": used_mi,
    }


async def namespace_exists(namespace: str) -> bool:
    """Check if namespace exists."""
    api = await k8s.get_client()
    v1 = client.CoreV1Api(api)
    try:
        await v1.read_namespace(namespace)
        return True
    except client.ApiException as e:
        if e.status == 404:
            return False
        raise


async def create_namespace(namespace: str) -> None:
    """Create a Kubernetes namespace."""
    api = await k8s.get_client()
    v1 = client.CoreV1Api(api)

    ns = client.V1Namespace(
        metadata=client.V1ObjectMeta(
            name=namespace,
            labels={"app.kubernetes.io/managed-by": "n8n-manager"}
        )
    )
    await v1.create_namespace(ns)
    logger.info(f"Created namespace {namespace}")


async def delete_namespace(namespace: str) -> None:
    """Delete a Kubernetes namespace."""
    api = await k8s.get_client()
    v1 = client.CoreV1Api(api)

    await v1.delete_namespace(namespace)
    logger.info(f"Deleted namespace {namespace}")


async def helm_install(
    release_name: str,
    namespace: str,
    chart_path: str,
    values: Dict[str, Any],
) -> AsyncIterator[str]:
    """
    Install Helm chart and yield progress messages.
    Uses subprocess since there's no good async Helm SDK.
    """
    # Write values to temp file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
        yaml.dump(values, f)
        values_file = f.name

    try:
        cmd = [
            "helm", "install", release_name, chart_path,
            "--namespace", namespace,
            "--create-namespace",
            "--values", values_file,
            "--wait",
            "--timeout", "5m",
        ]

        yield f"Running: helm install {release_name}"

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            error_msg = stderr.decode() if stderr else "Unknown error"
            raise RuntimeError(f"Helm install failed: {error_msg}")

        yield "Helm install completed"

    finally:
        os.unlink(values_file)


async def helm_uninstall(release_name: str, namespace: str) -> None:
    """Uninstall a Helm release."""
    cmd = ["helm", "uninstall", release_name, "--namespace", namespace]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        error_msg = stderr.decode() if stderr else "Unknown error"
        raise RuntimeError(f"Helm uninstall failed: {error_msg}")

    logger.info(f"Uninstalled release {release_name} from {namespace}")


async def get_helm_release_status(release_name: str, namespace: str) -> Optional[str]:
    """Get Helm release status. Returns None if not found."""
    cmd = ["helm", "status", release_name, "--namespace", namespace, "-o", "json"]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        return None

    import json
    try:
        data = json.loads(stdout.decode())
        return data.get("info", {}).get("status")
    except json.JSONDecodeError:
        return None
```

**Step 2: Commit deployment.py**

```bash
git add api/deployment.py
git commit -m "feat: add deployment module with kubernetes-asyncio SDK"
```

### Task 3.2: Create Snapshot Module with kubernetes-asyncio

**Files:**
- Create: `api/snapshot_ops.py`

**Step 1: Create snapshot_ops.py with snapshot operations**

```python
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
```

**Step 2: Commit snapshot_ops.py**

```bash
git add api/snapshot_ops.py
git commit -m "feat: add snapshot operations module with kubernetes-asyncio"
```

### Task 3.3: Update gRPC Services to Use New Modules

**Files:**
- Modify: `api/services/version_service.py`
- Modify: `api/services/snapshot_service.py`

**Step 1: Update version_service.py to use deployment module**

At the top, add import:
```python
from deployment import (
    calculate_port,
    version_to_namespace,
    check_cluster_capacity,
    namespace_exists,
    create_namespace,
    delete_namespace,
    helm_install,
    helm_uninstall,
    get_helm_release_status,
)
```

Replace the `calculate_port` function (lines 32-48) with an import.

Replace the `Deploy` method's shell script call with `helm_install()`.

Replace the `Delete` method's subprocess call with `helm_uninstall()` and `delete_namespace()`.

**Step 2: Update snapshot_service.py to use snapshot_ops module**

At the top, add import:
```python
from snapshot_ops import (
    list_snapshots,
    create_snapshot,
    delete_snapshot,
    restore_snapshot,
)
```

Replace shell script calls with the new module functions.

**Step 3: Commit service updates**

```bash
git add api/services/version_service.py api/services/snapshot_service.py
git commit -m "refactor: update gRPC services to use SDK modules"
```

---

## Phase 4: Update Docker and Infrastructure

### Task 4.1: Update Dockerfile for Slimmer Image

**Files:**
- Modify: `api/Dockerfile`

**Step 1: Update Dockerfile**

The REST files are removed, so the image will be smaller. Verify COPY commands only include needed files:

```dockerfile
# Copy application code
COPY *.py ./
COPY services/ ./services/
COPY generated/ ./generated/
```

**Step 2: Commit Dockerfile**

```bash
git add api/Dockerfile
git commit -m "chore: update Dockerfile after REST removal"
```

### Task 4.2: Update docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

**Step 1: Add REST server for uploads (runs alongside gRPC)**

The API container now runs gRPC on 50051. We need a second process or combine them.

Option: Run both in same container with supervisor or just run uvicorn for uploads on a different port.

For simplicity, add a second service for uploads:

```yaml
  # gRPC API server
  api:
    build:
      context: ./api
      dockerfile: Dockerfile
    container_name: n8n-api
    ports:
      - "50051:50051"
    volumes:
      - ~/.kube/config:/root/.kube/config:ro
      - ./:/workspace:ro
    environment:
      - PYTHONUNBUFFERED=1
    command: python server.py
    networks:
      - n8n-network

  # REST API for file uploads only
  upload-api:
    build:
      context: ./api
      dockerfile: Dockerfile
    container_name: n8n-upload
    ports:
      - "8000:8000"
    volumes:
      - ~/.kube/config:/root/.kube/config:ro
    environment:
      - PYTHONUNBUFFERED=1
    command: uvicorn main:app --host 0.0.0.0 --port 8000
    networks:
      - n8n-network
```

**Step 2: Commit docker-compose.yml**

```bash
git add docker-compose.yml
git commit -m "chore: add upload-api service for file uploads"
```

---

## Phase 5: Update Frontend Configuration

### Task 5.1: Update Frontend API URL for Uploads

**Files:**
- Modify: `web-ui-next/lib/api.ts`

**Step 1: Update API_URL to point to upload service**

```typescript
const API_URL = process.env.NEXT_PUBLIC_UPLOAD_API_URL || 'http://localhost:8000'
```

**Step 2: Commit frontend update**

```bash
git add web-ui-next/lib/api.ts
git commit -m "chore: update frontend to use separate upload API URL"
```

### Task 5.2: Remove Deprecated TypeScript Types

**Files:**
- Modify: `web-ui-next/lib/types.ts`

**Step 1: Remove deprecated Deployment and Snapshot types**

Keep only:
- `SnapshotActionResponse` (for upload)
- `EnvVar`, `ResourceSpec`, `HelmValues` (for forms)

**Step 2: Update components to use proto types**

Search for imports from `@/lib/types` and update to use proto types from `@/lib/generated/n8n_manager/v1/common_pb`.

**Step 3: Commit type cleanup**

```bash
git add web-ui-next/lib/types.ts
git commit -m "refactor: remove deprecated types, use proto types"
```

---

## Phase 6: Cleanup and Documentation

### Task 6.1: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update architecture section**

Document the new architecture:
- gRPC server on 50051 (primary API)
- REST upload server on 8000 (file uploads only)
- Envoy proxy on 8080 (gRPC-Web)

**Step 2: Commit documentation**

```bash
git add CLAUDE.md
git commit -m "docs: update architecture for gRPC migration"
```

### Task 6.2: Final Verification

**Step 1: Rebuild containers**

```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

**Step 2: Test gRPC operations**

- Open http://localhost:3000
- Verify deployments list loads
- Deploy a new version
- Delete a deployment

**Step 3: Test file upload**

- Upload a snapshot file
- Verify it appears in snapshots list

**Step 4: Create final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during verification"
```

---

## Summary

| Phase | Tasks | Files Changed |
|-------|-------|---------------|
| 1. Port Formula | 1 | 1 |
| 2. Remove REST | 3 | 7 deleted, 2 modified |
| 3. SDK Migration | 3 | 4 created/modified |
| 4. Docker | 2 | 2 |
| 5. Frontend | 2 | 2 |
| 6. Cleanup | 2 | 1 |

**Total: 13 tasks, ~15 files affected**

**Estimated effort:** 2-3 hours for implementation + testing
