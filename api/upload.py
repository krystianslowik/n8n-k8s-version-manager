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
