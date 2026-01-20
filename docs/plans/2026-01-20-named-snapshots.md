# Named Snapshots System - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable creating named, reusable database snapshots that can be used to initialize isolated n8n instances

**Architecture:** Named snapshots stored alongside timestamped snapshots, with deployment-time restore capability via Helm chart post-install Jobs

**Tech Stack:** Python/FastAPI (backend), React/Next.js/shadcn (frontend), Kubernetes Jobs (snapshot creation/restore), Helm (deployment orchestration)

---

## Overview

Currently, the system only supports:
- Creating timestamped snapshots (e.g., `n8n-20260119-181411-pre-v2.1.0.sql`)
- Restoring snapshots to the shared database
- Deploying isolated instances with empty databases

**New capabilities:**
1. Create snapshots with custom names (e.g., "test-data-v1", "prod-clone")
2. Deploy isolated instances initialized from named snapshots
3. Reuse same snapshot across multiple n8n versions for testing
4. Delete named snapshots from UI
5. List and manage named vs timestamped snapshots separately

**Use cases:**
- Testing migrations: Deploy v1.120 and v1.125 both with "prod-clone" snapshot
- Clean test environments: Create "empty-base" and reuse for multiple isolated instances
- Reproducible bugs: Create "bug-reproduction" snapshot and share with team
- Performance testing: Create "large-dataset" snapshot with 10,000 workflows

---

## Critical Files

### Backend
- **Modify:** `/Users/slowik/Desktop/n8n/k8s/web-ui/api/snapshots.py` - Add named snapshot endpoints
- **Create:** `/Users/slowik/Desktop/n8n/k8s/scripts/create-named-snapshot.sh` - CLI for named snapshots
- **Modify:** `/Users/slowik/Desktop/n8n/k8s/scripts/list-snapshots.sh` - Support named/auto filtering
- **Create:** `/Users/slowik/Desktop/n8n/k8s/scripts/delete-snapshot.sh` - Delete snapshots

### Frontend
- **Modify:** `/Users/slowik/Desktop/n8n/k8s/web-ui-next/components/snapshots-panel.tsx` - Show named vs auto
- **Modify:** `/Users/slowik/Desktop/n8n/k8s/web-ui-next/components/deploy-drawer.tsx` - Add snapshot selector
- **Modify:** `/Users/slowik/Desktop/n8n/k8s/web-ui-next/lib/api.ts` - Add named snapshot API calls
- **Create:** `/Users/slowik/Desktop/n8n/k8s/web-ui-next/components/create-named-snapshot-dialog.tsx` - UI for creating

### Helm & Deployment
- **Create:** `/Users/slowik/Desktop/n8n/k8s/charts/n8n-instance/templates/isolated-db-statefulset.yaml` - PostgreSQL for isolated mode
- **Create:** `/Users/slowik/Desktop/n8n/k8s/charts/n8n-instance/templates/restore-snapshot-job.yaml` - Post-install restore
- **Modify:** `/Users/slowik/Desktop/n8n/k8s/charts/n8n-instance/values.yaml` - Add snapshot config
- **Modify:** `/Users/slowik/Desktop/n8n/k8s/scripts/deploy-version.sh` - Add `--snapshot` flag

---

## Task 1: Backend - Named Snapshot Creation Script

**Files:**
- Create: `/Users/slowik/Desktop/n8n/k8s/scripts/create-named-snapshot.sh`

**Step 1: Write bash script for named snapshot creation**

```bash
#!/bin/bash
set -e

# Usage: ./scripts/create-named-snapshot.sh <name> [--source shared|<namespace>]

NAME=$1
SOURCE=${2:-shared}

if [ -z "$NAME" ]; then
  echo "Usage: ./scripts/create-named-snapshot.sh <name> [--source shared|<namespace>]"
  echo "Example: ./scripts/create-named-snapshot.sh test-data-v1"
  echo "Example: ./scripts/create-named-snapshot.sh prod-clone --source n8n-v1-25-0"
  exit 1
fi

# Validate name (alphanumeric, hyphens, underscores only)
if ! [[ "$NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "ERROR: Invalid name. Use only letters, numbers, hyphens, and underscores"
  echo "Good: test-data-v1, prod_clone, mySnapshot123"
  echo "Bad: test data, snapshot.sql, my/snapshot"
  exit 1
fi

# Parse source
if [ "$SOURCE" == "shared" ]; then
  DB_HOST="postgres.n8n-system.svc.cluster.local"
  DB_NAME="n8n"
  SOURCE_NAMESPACE="n8n-system"
else
  # Source is a namespace (e.g., n8n-v1-25-0)
  DB_HOST="postgres-${SOURCE}.${SOURCE}.svc.cluster.local"
  DB_NAME="n8n"
  SOURCE_NAMESPACE="$SOURCE"

  # Verify namespace exists
  if ! kubectl get namespace "$SOURCE_NAMESPACE" &> /dev/null; then
    echo "ERROR: Namespace not found: $SOURCE_NAMESPACE"
    exit 1
  fi
fi

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${NAME}.sql"

echo "Creating named snapshot: $NAME"
echo "Source: $SOURCE_NAMESPACE ($DB_HOST)"
echo "Output: /backups/snapshots/$BACKUP_FILE"
echo ""

# Create Kubernetes Job to run snapshot
cat <<EOF | kubectl apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: snapshot-${NAME}-${TIMESTAMP}
  namespace: n8n-system
spec:
  ttlSecondsAfterFinished: 300
  template:
    spec:
      restartPolicy: OnFailure
      containers:
      - name: snapshot
        image: postgres:16
        command:
        - /bin/bash
        - -c
        - |
          set -e

          # Wait for postgres
          until pg_isready -h ${DB_HOST} -U admin; do
            echo "Waiting for PostgreSQL at ${DB_HOST}..."
            sleep 2
          done

          # Create snapshots directory if it doesn't exist
          mkdir -p /backups/snapshots

          # Create backup
          PGPASSWORD=changeme123 pg_dump \\
            -h ${DB_HOST} \\
            -U admin \\
            -d ${DB_NAME} \\
            > "/backups/snapshots/${BACKUP_FILE}"

          if [ -f "/backups/snapshots/${BACKUP_FILE}" ]; then
            SIZE=\$(du -h "/backups/snapshots/${BACKUP_FILE}" | cut -f1)
            echo "Named snapshot created: ${BACKUP_FILE} (\${SIZE})"

            # Create metadata file
            cat > "/backups/snapshots/${BACKUP_FILE}.meta" <<METADATA
{
  "name": "${NAME}",
  "created": "\$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "source": "${SOURCE}",
  "type": "named"
}
METADATA
          else
            echo "ERROR: Snapshot creation failed"
            exit 1
          fi
        volumeMounts:
        - name: backup-storage
          mountPath: /backups
      volumes:
      - name: backup-storage
        persistentVolumeClaim:
          claimName: backup-storage
EOF

echo "Snapshot job created: snapshot-${NAME}-${TIMESTAMP}"
echo "Monitor: kubectl logs -f job/snapshot-${NAME}-${TIMESTAMP} -n n8n-system"
```

**Step 2: Make script executable**

Run: `chmod +x /Users/slowik/Desktop/n8n/k8s/scripts/create-named-snapshot.sh`

**Step 3: Test script manually**

Run: `cd /Users/slowik/Desktop/n8n/k8s && ./scripts/create-named-snapshot.sh test-snapshot-1`
Expected: Job created, snapshot appears in `/backups/snapshots/`

**Step 4: Commit**

```bash
git add scripts/create-named-snapshot.sh
git commit -m "feat(snapshots): add script to create named snapshots

- Validates snapshot name (alphanumeric, hyphens, underscores)
- Supports --source flag for shared or specific namespace
- Creates metadata file alongside snapshot
- Uses Kubernetes Job for snapshot creation"
```

---

## Task 2: Backend - Delete Snapshot Script

**Files:**
- Create: `/Users/slowik/Desktop/n8n/k8s/scripts/delete-snapshot.sh`

**Step 1: Write bash script for deleting snapshots**

```bash
#!/bin/bash
set -e

# Usage: ./scripts/delete-snapshot.sh <filename>

FILENAME=$1

if [ -z "$FILENAME" ]; then
  echo "Usage: ./scripts/delete-snapshot.sh <filename>"
  echo "Example: ./scripts/delete-snapshot.sh test-data-v1.sql"
  exit 1
fi

# Determine snapshot path (check both directories)
if [[ "$FILENAME" == *.sql ]]; then
  SNAPSHOT_PATH="/backups/snapshots/$FILENAME"
  if [ ! -f "/backups/$FILENAME" ]; then
    # Try timestamped directory
    SNAPSHOT_PATH="/backups/$FILENAME"
  fi
else
  echo "ERROR: Filename must end with .sql"
  exit 1
fi

echo "Deleting snapshot: $FILENAME"
read -p "Are you sure? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Deletion cancelled"
  exit 0
fi

# Get postgres pod to exec into
POSTGRES_POD=$(kubectl get pods -n n8n-system -l app=postgres -o jsonpath='{.items[0].metadata.name}')

if [ -z "$POSTGRES_POD" ]; then
  echo "Error: PostgreSQL pod not found"
  exit 1
fi

# Delete snapshot and metadata
kubectl exec "$POSTGRES_POD" -n n8n-system -- sh -c "
  if [ -f '$SNAPSHOT_PATH' ]; then
    rm -f '$SNAPSHOT_PATH'
    rm -f '${SNAPSHOT_PATH}.meta'
    echo 'Snapshot deleted: $FILENAME'
  else
    echo 'ERROR: Snapshot not found: $SNAPSHOT_PATH'
    exit 1
  fi
"
```

**Step 2: Make executable and test**

Run:
```bash
chmod +x scripts/delete-snapshot.sh
./scripts/delete-snapshot.sh test-snapshot-1.sql
```

**Step 3: Commit**

```bash
git add scripts/delete-snapshot.sh
git commit -m "feat(snapshots): add script to delete snapshots"
```

---

## Task 3: Backend - Update List Snapshots Script

**Files:**
- Modify: `/Users/slowik/Desktop/n8n/k8s/scripts/list-snapshots.sh`

**Step 1: Read current script**

**Step 2: Add support for --named-only and --auto-only flags**

Replace script with:

```bash
#!/bin/bash

# Usage: ./scripts/list-snapshots.sh [--named-only|--auto-only]

MODE=${1:-all}

# Get postgres pod
POSTGRES_POD=$(kubectl get pods -n n8n-system -l app=postgres -o jsonpath='{.items[0].metadata.name}')

if [ -z "$POSTGRES_POD" ]; then
  echo "Error: PostgreSQL pod not found"
  exit 1
fi

# List snapshots
case $MODE in
  --named-only)
    kubectl exec "$POSTGRES_POD" -n n8n-system -- sh -c "ls -1 /backups/snapshots/*.sql 2>/dev/null || true" | sed 's|/backups/snapshots/||'
    ;;
  --auto-only)
    kubectl exec "$POSTGRES_POD" -n n8n-system -- sh -c "ls -1 /backups/n8n-*.sql 2>/dev/null || true" | sed 's|/backups/||'
    ;;
  all|*)
    echo "=== Named Snapshots ==="
    kubectl exec "$POSTGRES_POD" -n n8n-system -- sh -c "ls -1 /backups/snapshots/*.sql 2>/dev/null || echo '  (none)'" | sed 's|/backups/snapshots/||'
    echo ""
    echo "=== Timestamped Snapshots ==="
    kubectl exec "$POSTGRES_POD" -n n8n-system -- sh -c "ls -1 /backups/n8n-*.sql 2>/dev/null || echo '  (none)'" | sed 's|/backups/||'
    ;;
esac
```

**Step 3: Test**

Run: `./scripts/list-snapshots.sh --named-only`
Expected: Shows only named snapshots from `/backups/snapshots/`

**Step 4: Commit**

```bash
git add scripts/list-snapshots.sh
git commit -m "feat(snapshots): add filtering for named vs timestamped snapshots"
```

---

## Task 4: Backend - API Endpoints for Named Snapshots

**Files:**
- Modify: `/Users/slowik/Desktop/n8n/k8s/web-ui/api/snapshots.py`

**Step 1: Add new Pydantic models**

Add after line 13:

```python
class CreateNamedSnapshotRequest(BaseModel):
    name: str
    source: str = "shared"  # "shared" or namespace name

class DeleteSnapshotRequest(BaseModel):
    filename: str
```

**Step 2: Update parse_snapshots_output to distinguish types**

Replace the `parse_snapshots_output` function (lines 15-39):

```python
def parse_snapshots_output(output: str, snapshot_type: str = "all") -> List[Dict[str, str]]:
    """Parse list-snapshots.sh output into structured JSON."""
    snapshots = []
    lines = output.strip().split('\n')

    for line in lines:
        if not line.strip() or not line.endswith('.sql'):
            continue

        filename = line.strip()

        # Determine if named or timestamped
        is_named = not filename.startswith('n8n-')

        # Parse timestamp from filename for auto snapshots
        if not is_named:
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
```

**Step 3: Add endpoint for listing named snapshots only**

Add after the existing `@router.get("")` endpoint (around line 42):

```python
@router.get("/named")
async def list_named_snapshots():
    """List only named snapshots for deployment UI."""
    try:
        result = subprocess.run(
            ["/workspace/scripts/list-snapshots.sh", "--named-only"],
            capture_output=True,
            text=True,
            cwd="/workspace"
        )

        if result.returncode != 0:
            return {"snapshots": []}

        snapshots = parse_snapshots_output(result.stdout, snapshot_type="named")
        return {"snapshots": snapshots}

    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="list-snapshots.sh script not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**Step 4: Add endpoint for creating named snapshots**

Add after `@router.post("/create")`:

```python
@router.post("/create-named")
async def create_named_snapshot(request: CreateNamedSnapshotRequest):
    """Create named database snapshot."""
    try:
        # Validate name
        if not re.match(r'^[a-zA-Z0-9_-]+$', request.name):
            return {
                "success": False,
                "error": "Invalid name. Use only letters, numbers, hyphens, and underscores"
            }

        # Run create-named-snapshot.sh script
        cmd = ["/workspace/scripts/create-named-snapshot.sh", request.name]
        if request.source != "shared":
            cmd.extend(["--source", request.source])

        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd="/workspace"
        )

        if result.returncode != 0:
            return {
                "success": False,
                "error": result.stderr,
                "output": result.stdout
            }

        return {
            "success": True,
            "message": f"Named snapshot '{request.name}' created",
            "output": result.stdout
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**Step 5: Add endpoint for deleting snapshots**

Add after `@router.post("/restore")`:

```python
@router.delete("/{filename}")
async def delete_snapshot(filename: str):
    """Delete a snapshot by filename."""
    try:
        # Security: validate filename
        if not filename.endswith('.sql') or '/' in filename or '..' in filename:
            return {
                "success": False,
                "error": "Invalid filename"
            }

        result = subprocess.run(
            ["/workspace/scripts/delete-snapshot.sh", filename],
            capture_output=True,
            text=True,
            cwd="/workspace",
            input="yes\n"  # Auto-confirm deletion
        )

        if result.returncode != 0:
            return {
                "success": False,
                "error": result.stderr,
                "output": result.stdout
            }

        return {
            "success": True,
            "message": f"Snapshot {filename} deleted",
            "output": result.stdout
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**Step 6: Update existing list endpoint to show both types**

Modify `@router.get("")` to use updated parser (around line 42):

```python
@router.get("")
async def list_snapshots():
    """List all database snapshots (named and timestamped)."""
    try:
        result = subprocess.run(
            ["/workspace/scripts/list-snapshots.sh"],
            capture_output=True,
            text=True,
            cwd="/workspace"
        )

        if result.returncode != 0:
            return {"snapshots": []}

        snapshots = parse_snapshots_output(result.stdout, snapshot_type="all")
        return {"snapshots": snapshots}

    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="list-snapshots.sh script not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

**Step 7: Rebuild Docker containers**

Run:
```bash
cd /Users/slowik/Desktop/n8n/k8s
docker compose down
docker compose up -d --build
```

**Step 8: Test API endpoints**

Run:
```bash
# List all snapshots
curl http://localhost:8000/api/snapshots

# List named only
curl http://localhost:8000/api/snapshots/named

# Create named snapshot
curl -X POST http://localhost:8000/api/snapshots/create-named \
  -H "Content-Type: application/json" \
  -d '{"name": "test-api-1", "source": "shared"}'
```

Expected: All endpoints work correctly

**Step 9: Commit**

```bash
git add web-ui/api/snapshots.py
git commit -m "feat(api): add endpoints for named snapshot management

- POST /api/snapshots/create-named - Create named snapshot
- GET /api/snapshots/named - List only named snapshots
- DELETE /api/snapshots/{filename} - Delete snapshot
- Update response format to distinguish named vs timestamped"
```

---

## Task 5: Frontend - Update API Client

**Files:**
- Modify: `/Users/slowik/Desktop/n8n/k8s/web-ui-next/lib/api.ts`

**Step 1: Read current API client**

**Step 2: Add TypeScript types for snapshots**

Add before the `api` object (around line 10):

```typescript
export interface Snapshot {
  filename: string
  name?: string
  type: 'named' | 'auto'
  timestamp?: string
  created?: string
  size?: string
  source?: string
}

export interface SnapshotListResponse {
  snapshots: Snapshot[]
}

export interface CreateNamedSnapshotRequest {
  name: string
  source?: string
}

export interface SnapshotActionResponse {
  success: boolean
  message?: string
  error?: string
  output?: string
}
```

**Step 3: Add new API methods**

Add to the `api` object:

```typescript
  // Get only named snapshots
  getNamedSnapshots: async (): Promise<Snapshot[]> => {
    const response = await fetch(`${API_URL}/api/snapshots/named`)
    const data: SnapshotListResponse = await response.json()
    return data.snapshots
  },

  // Create named snapshot
  createNamedSnapshot: async (request: CreateNamedSnapshotRequest): Promise<SnapshotActionResponse> => {
    const response = await fetch(`${API_URL}/api/snapshots/create-named`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    return response.json()
  },

  // Delete snapshot
  deleteSnapshot: async (filename: string): Promise<SnapshotActionResponse> => {
    const response = await fetch(`${API_URL}/api/snapshots/${filename}`, {
      method: 'DELETE',
    })
    return response.json()
  },
```

**Step 4: Update getSnapshots return type**

Change the `getSnapshots` method signature to return `Snapshot[]`:

```typescript
  getSnapshots: async (): Promise<Snapshot[]> => {
    const response = await fetch(`${API_URL}/api/snapshots`)
    const data: SnapshotListResponse = await response.json()
    return data.snapshots
  },
```

**Step 5: Commit**

```bash
git add web-ui-next/lib/api.ts
git commit -m "feat(ui): add API methods for named snapshot management"
```

---

## Task 6: Frontend - Create Named Snapshot Dialog Component

**Files:**
- Create: `/Users/slowik/Desktop/n8n/k8s/web-ui-next/components/create-named-snapshot-dialog.tsx`

**Step 1: Create dialog component**

```typescript
'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { LoaderIcon } from 'lucide-react'

interface CreateNamedSnapshotDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CreateNamedSnapshotDialog({
  open,
  onOpenChange,
}: CreateNamedSnapshotDialogProps) {
  const [name, setName] = useState('')
  const [source, setSource] = useState('shared')
  const queryClient = useQueryClient()

  const createMutation = useMutation({
    mutationFn: () => api.createNamedSnapshot({ name, source }),
    onSuccess: (data) => {
      if (data.success) {
        toast.success('Snapshot created', {
          description: `Named snapshot "${name}" has been created`,
        })
        queryClient.invalidateQueries({ queryKey: ['snapshots'] })
        onOpenChange(false)
        setName('')
        setSource('shared')
      } else {
        toast.error('Failed to create snapshot', {
          description: data.error,
        })
      }
    },
    onError: (error: Error) => {
      toast.error('Failed to create snapshot', {
        description: error.message,
      })
    },
  })

  const handleCreate = () => {
    // Validate name
    if (!name.trim()) {
      toast.error('Name required', {
        description: 'Please enter a snapshot name',
      })
      return
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      toast.error('Invalid name', {
        description: 'Use only letters, numbers, hyphens, and underscores',
      })
      return
    }

    createMutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Named Snapshot</DialogTitle>
          <DialogDescription>
            Create a reusable snapshot with a custom name
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="snapshot-name">Snapshot Name</Label>
            <Input
              id="snapshot-name"
              placeholder="e.g., test-data-v1, prod-clone"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={createMutation.isPending}
            />
            <p className="text-xs text-muted-foreground">
              Use only letters, numbers, hyphens, and underscores
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="snapshot-source">Source Database</Label>
            <Select
              value={source}
              onValueChange={setSource}
              disabled={createMutation.isPending}
            >
              <SelectTrigger id="snapshot-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="shared">Shared Database</SelectItem>
                {/* TODO: Add isolated instance namespaces from deployments API */}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Snapshot'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

**Step 2: Commit**

```bash
git add web-ui-next/components/create-named-snapshot-dialog.tsx
git commit -m "feat(ui): add dialog for creating named snapshots"
```

---

## Task 7: Frontend - Update Snapshots Panel

**Files:**
- Modify: `/Users/slowik/Desktop/n8n/k8s/web-ui-next/components/snapshots-panel.tsx`

**Step 1: Read current component**

**Step 2: Add delete functionality and named snapshot dialog**

Import the new dialog at the top:

```typescript
import { CreateNamedSnapshotDialog } from './create-named-snapshot-dialog'
```

Add state for the dialog (after line 28):

```typescript
const [createNamedOpen, setCreateNamedOpen] = useState(false)
```

Add delete mutation (after restoreMutation):

```typescript
const deleteMutation = useMutation({
  mutationFn: (filename: string) => api.deleteSnapshot(filename),
  onSuccess: (data) => {
    if (data.success) {
      toast.success('Snapshot deleted')
      queryClient.invalidateQueries({ queryKey: ['snapshots'] })
    } else {
      toast.error('Failed to delete snapshot', {
        description: data.error,
      })
    }
  },
  onError: (error: Error) => {
    toast.error('Failed to delete snapshot', {
      description: error.message,
    })
  },
})
```

**Step 3: Separate named and timestamped snapshots**

Add after queryClient setup:

```typescript
const namedSnapshots = snapshots?.filter((s) => s.type === 'named') || []
const autoSnapshots = snapshots?.filter((s) => s.type === 'auto') || []
```

**Step 4: Update header to add "Create Named" button**

Replace the "Create Snapshot" button (around line 100-115) with two buttons:

```typescript
<div className="flex gap-2">
  <Button
    onClick={() => setCreateNamedOpen(true)}
    variant="outline"
    size="sm"
  >
    <CameraIcon className="h-4 w-4 mr-2" />
    Create Named
  </Button>
  <Button
    onClick={() => createMutation.mutate()}
    disabled={createMutation.isPending}
    size="sm"
  >
    {createMutation.isPending ? (
      <>
        <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
        Creating...
      </>
    ) : (
      <>
        <CameraIcon className="h-4 w-4 mr-2" />
        Quick Snapshot
      </>
    )}
  </Button>
</div>
```

**Step 5: Update snapshot list to show two sections**

Replace the AccordionContent (lines 126-166) with:

```typescript
<AccordionContent>
  {snapshots?.length === 0 ? (
    // Empty state
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <DatabaseIcon className="h-12 w-12 text-muted-foreground mb-4" />
      <h3 className="font-semibold text-lg mb-2">No Snapshots</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Create your first database snapshot
      </p>
    </div>
  ) : (
    <div className="space-y-4">
      {/* Named Snapshots Section */}
      {namedSnapshots.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground">
            Named Snapshots ({namedSnapshots.length})
          </h4>
          <div className="space-y-2">
            {namedSnapshots.map((snapshot) => (
              <div
                key={snapshot.filename}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3">
                  <DatabaseIcon className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-mono text-sm font-medium">
                      {snapshot.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {snapshot.filename}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRestore(snapshot.filename)}
                  >
                    <RotateCcwIcon className="h-3 w-3 mr-2" />
                    Restore
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(snapshot.filename)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timestamped Snapshots Section */}
      {autoSnapshots.length > 0 && (
        <div>
          <h4 className="text-sm font-medium mb-2 text-muted-foreground">
            Automatic Snapshots ({autoSnapshots.length})
          </h4>
          <div className="space-y-2">
            {autoSnapshots.map((snapshot) => (
              <div
                key={snapshot.filename}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-accent transition-colors"
              >
                <div className="flex items-center gap-3">
                  <DatabaseIcon className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="font-mono text-sm font-medium">
                      {snapshot.filename}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {snapshot.timestamp}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleRestore(snapshot.filename)}
                >
                  <RotateCcwIcon className="h-3 w-3 mr-2" />
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )}
</AccordionContent>
```

**Step 6: Add dialog to render**

Add before the closing fragment (before `</>`):

```typescript
<CreateNamedSnapshotDialog
  open={createNamedOpen}
  onOpenChange={setCreateNamedOpen}
/>
```

**Step 7: Test in browser**

Run: Navigate to http://localhost:3000
Expected: Snapshots panel shows two sections, create named button works

**Step 8: Commit**

```bash
git add web-ui-next/components/snapshots-panel.tsx
git commit -m "feat(ui): separate named and timestamped snapshots, add delete"
```

---

## Task 8: Helm Chart - Create Isolated DB StatefulSet Template

**Files:**
- Create: `/Users/slowik/Desktop/n8n/k8s/charts/n8n-instance/templates/isolated-db-statefulset.yaml`

**Step 1: Create PostgreSQL StatefulSet for isolated mode**

```yaml
{{- if .Values.isolatedDB }}
apiVersion: v1
kind: Service
metadata:
  name: postgres-{{ .Release.Name }}
  namespace: {{ .Release.Namespace }}
  labels:
    app: postgres
    instance: {{ .Release.Name }}
spec:
  ports:
  - port: 5432
    targetPort: 5432
    name: postgres
  clusterIP: None
  selector:
    app: postgres
    instance: {{ .Release.Name }}
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres-{{ .Release.Name }}
  namespace: {{ .Release.Namespace }}
  labels:
    app: postgres
    instance: {{ .Release.Name }}
spec:
  serviceName: postgres-{{ .Release.Name }}
  replicas: 1
  selector:
    matchLabels:
      app: postgres
      instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app: postgres
        instance: {{ .Release.Name }}
    spec:
      containers:
      - name: postgres
        image: {{ .Values.database.isolated.image }}
        ports:
        - containerPort: 5432
          name: postgres
        env:
        - name: POSTGRES_DB
          value: "n8n"
        - name: POSTGRES_USER
          value: "admin"
        - name: POSTGRES_PASSWORD
          value: "changeme123"
        - name: PGDATA
          value: /var/lib/postgresql/data/pgdata
        volumeMounts:
        - name: postgres-data
          mountPath: /var/lib/postgresql/data
        resources:
          requests:
            cpu: {{ .Values.database.isolated.resources.requests.cpu }}
            memory: {{ .Values.database.isolated.resources.requests.memory }}
          limits:
            cpu: {{ .Values.database.isolated.resources.limits.cpu }}
            memory: {{ .Values.database.isolated.resources.limits.memory }}
        livenessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - admin
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - admin
          initialDelaySeconds: 5
          periodSeconds: 5
  volumeClaimTemplates:
  - metadata:
      name: postgres-data
    spec:
      accessModes: ["ReadWriteOnce"]
      resources:
        requests:
          storage: {{ .Values.database.isolated.storage.size }}
{{- end }}
```

**Step 2: Commit**

```bash
git add charts/n8n-instance/templates/isolated-db-statefulset.yaml
git commit -m "feat(helm): add PostgreSQL StatefulSet for isolated database mode"
```

---

## Task 9: Helm Chart - Create Snapshot Restore Job Template

**Files:**
- Create: `/Users/slowik/Desktop/n8n/k8s/charts/n8n-instance/templates/restore-snapshot-job.yaml`

**Step 1: Create post-install Job for snapshot restore**

```yaml
{{- if and .Values.isolatedDB .Values.database.isolated.snapshot.enabled }}
apiVersion: batch/v1
kind: Job
metadata:
  name: restore-snapshot-{{ .Release.Name }}
  namespace: {{ .Release.Namespace }}
  annotations:
    "helm.sh/hook": post-install
    "helm.sh/hook-weight": "0"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: OnFailure
      initContainers:
      # Wait for postgres to be ready
      - name: wait-for-postgres
        image: postgres:16
        command:
        - /bin/bash
        - -c
        - |
          until pg_isready -h postgres-{{ .Release.Name }}.{{ .Release.Namespace }}.svc.cluster.local -U admin; do
            echo "Waiting for PostgreSQL..."
            sleep 2
          done
          echo "PostgreSQL is ready"
      containers:
      - name: restore
        image: postgres:16
        command:
        - /bin/bash
        - -c
        - |
          set -e

          SNAPSHOT_FILE="/snapshots/{{ .Values.database.isolated.snapshot.name }}"

          if [ ! -f "$SNAPSHOT_FILE" ]; then
            echo "ERROR: Snapshot not found: $SNAPSHOT_FILE"
            echo "Available snapshots:"
            ls -lh /snapshots/
            exit 1
          fi

          echo "Restoring snapshot: {{ .Values.database.isolated.snapshot.name }}"
          echo "Target database: postgres-{{ .Release.Name }}.{{ .Release.Namespace }}.svc.cluster.local"

          # Restore snapshot to isolated database
          PGPASSWORD=changeme123 psql \\
            -h postgres-{{ .Release.Name }}.{{ .Release.Namespace }}.svc.cluster.local \\
            -U admin \\
            -d n8n \\
            < "$SNAPSHOT_FILE"

          echo "Snapshot restored successfully"
        volumeMounts:
        - name: snapshots
          mountPath: /snapshots
          readOnly: true
      volumes:
      # Mount the snapshot storage from n8n-system namespace
      # Note: This assumes NFS or similar shared storage
      - name: snapshots
        persistentVolumeClaim:
          claimName: backup-storage
          # This will fail if PVC is not shared across namespaces
          # Alternative: Use a CronJob to copy snapshot before deployment
{{- end }}
```

**Step 2: Note limitations and commit**

```bash
git add charts/n8n-instance/templates/restore-snapshot-job.yaml
git commit -m "feat(helm): add post-install Job to restore snapshots

Note: Requires shared PVC access across namespaces or NFS storage.
Alternative implementation may be needed for non-shared storage."
```

---

## Task 10: Helm Chart - Update values.yaml

**Files:**
- Modify: `/Users/slowik/Desktop/n8n/k8s/charts/n8n-instance/values.yaml`

**Step 1: Add snapshot configuration**

Add after line 30 (in the `database.isolated` section):

```yaml
  isolated:
    image: postgres:16
    storage:
      size: 10Gi
    resources:
      requests:
        cpu: 250m
        memory: 512Mi
      limits:
        cpu: 1000m
        memory: 2Gi
    # Snapshot restore configuration
    snapshot:
      enabled: false          # Set to true to restore from snapshot
      name: ""                # Snapshot filename (e.g., "test-data-v1.sql")
      sourceNamespace: "n8n-system"  # Where backup-storage PVC is mounted
```

**Step 2: Commit**

```bash
git add charts/n8n-instance/values.yaml
git commit -m "feat(helm): add snapshot restore configuration to values"
```

---

## Task 11: Deployment Script - Add Snapshot Flag

**Files:**
- Modify: `/Users/slowik/Desktop/n8n/k8s/scripts/deploy-version.sh`

**Step 1: Add snapshot flag parsing**

Add after line 13 (in flag parsing section):

```bash
SNAPSHOT_NAME=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --snapshot)
      SNAPSHOT_NAME="$2"
      shift 2
      ;;
    # ... existing flags
  esac
done
```

**Step 2: Add validation**

Add after line 41 (after version validation):

```bash
# Validate: --snapshot requires --isolated-db
if [ -n "$SNAPSHOT_NAME" ] && [ "$ISOLATED" != "true" ]; then
  echo "ERROR: --snapshot flag requires --isolated-db"
  echo "Usage: ./scripts/deploy-version.sh <version> --regular --isolated-db --snapshot <name>"
  exit 1
fi

# Verify snapshot exists (if provided)
if [ -n "$SNAPSHOT_NAME" ]; then
  echo "Verifying snapshot exists: ${SNAPSHOT_NAME}.sql"

  # Get postgres pod to check snapshot
  POSTGRES_POD=$(kubectl get pods -n n8n-system -l app=postgres -o jsonpath='{.items[0].metadata.name}')

  if [ -z "$POSTGRES_POD" ]; then
    echo "Warning: Cannot verify snapshot (PostgreSQL pod not found)"
  else
    SNAPSHOT_EXISTS=$(kubectl exec "$POSTGRES_POD" -n n8n-system -- sh -c "
      [ -f '/backups/snapshots/${SNAPSHOT_NAME}.sql' ] && echo 'true' || echo 'false'
    ")

    if [ "$SNAPSHOT_EXISTS" != "true" ]; then
      echo "ERROR: Snapshot not found: ${SNAPSHOT_NAME}.sql"
      echo ""
      echo "Available named snapshots:"
      ./scripts/list-snapshots.sh --named-only
      exit 1
    fi

    echo "✓ Snapshot verified: ${SNAPSHOT_NAME}.sql"
  fi
fi
echo ""
```

**Step 3: Update Helm install command**

Replace Helm install (around line 236):

```bash
# Build Helm command
HELM_CMD="helm install \"$RELEASE_NAME\" ./charts/n8n-instance \
  --set n8nVersion=\"$VERSION\" \
  --set queueMode=\"$QUEUE_MODE\" \
  --set isolatedDB=\"$ISOLATED\" \
  --namespace \"$NAMESPACE\" \
  --create-namespace"

# Add snapshot parameters if provided
if [ -n "$SNAPSHOT_NAME" ]; then
  HELM_CMD="$HELM_CMD \
    --set database.isolated.snapshot.enabled=true \
    --set database.isolated.snapshot.name=\"${SNAPSHOT_NAME}.sql\""
fi

# Execute Helm install
eval "$HELM_CMD"
```

**Step 4: Update usage message**

Update the usage message (line 5-7):

```bash
# Usage: ./scripts/deploy-version.sh <version> [--queue|--regular] [--isolated-db] [--snapshot <name>] [--name <custom-name>]
```

Add to examples (around line 38):

```bash
echo "Example with snapshot: ./scripts/deploy-version.sh 1.123 --regular --isolated-db --snapshot test-data-v1"
```

**Step 5: Update deployment summary**

Add after line 249 (in the summary):

```bash
echo "Mode: $([ "$QUEUE_MODE" == "true" ] && echo "Queue" || echo "Regular")"
echo "Database: $([ "$ISOLATED" == "true" ] && echo "Isolated" || echo "Shared")"
if [ -n "$SNAPSHOT_NAME" ]; then
  echo "Snapshot: ${SNAPSHOT_NAME}.sql"
fi
```

**Step 6: Test deployment with snapshot**

Run:
```bash
cd /Users/slowik/Desktop/n8n/k8s
./scripts/deploy-version.sh 1.123 --regular --isolated-db --snapshot test-snapshot-1
```

Expected: Deployment succeeds, snapshot is restored

**Step 7: Commit**

```bash
git add scripts/deploy-version.sh
git commit -m "feat(deploy): add --snapshot flag for deploying with named snapshots

- Validates snapshot exists before deployment
- Requires --isolated-db flag
- Verifies snapshot file in backup-storage PVC
- Passes snapshot name to Helm chart"
```

---

## Task 12: Frontend - Add Snapshot Selector to Deploy Drawer

**Files:**
- Modify: `/Users/slowik/Desktop/n8n/k8s/web-ui-next/components/deploy-drawer.tsx`

**Step 1: Read current component**

**Step 2: Add snapshot field to form schema**

Find the form schema (around line 20-30) and add:

```typescript
const formSchema = z.object({
  version: z.string().min(1, "Version is required"),
  mode: z.enum(["queue", "regular"]),
  isolatedDatabase: z.boolean(),
  snapshot: z.string().optional(),  // NEW
  customName: z.string().optional(),
})
```

**Step 3: Add query for named snapshots**

Add after the availableVersions query (around line 50):

```typescript
const { data: namedSnapshots } = useQuery({
  queryKey: ['snapshots', 'named'],
  queryFn: api.getNamedSnapshots,
  enabled: open,  // Only fetch when drawer is open
})
```

**Step 4: Add snapshot selector field**

Add after the "Isolated Database" checkbox (around line 150):

```typescript
{/* Snapshot Selector - only shown if isolated database enabled */}
{form.watch('isolatedDatabase') && (
  <FormField
    control={form.control}
    name="snapshot"
    render={({ field }) => (
      <FormItem>
        <FormLabel>Initialize From Snapshot (optional)</FormLabel>
        <FormDescription>
          Deploy with data from an existing snapshot
        </FormDescription>
        <Select
          onValueChange={field.onChange}
          defaultValue={field.value}
        >
          <FormControl>
            <SelectTrigger>
              <SelectValue placeholder="Empty database" />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            <SelectItem value="">Empty database</SelectItem>
            {namedSnapshots?.map((snap) => (
              <SelectItem key={snap.name} value={snap.name || ''}>
                {snap.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormItem>
    )}
  />
)}
```

**Step 5: Update deploy mutation to include snapshot**

Modify the deployVersion call (around line 80):

```typescript
const deployMutation = useMutation({
  mutationFn: (data: z.infer<typeof formSchema>) =>
    api.deployVersion({
      version: data.version,
      mode: data.mode,
      isolated_db: data.isolatedDatabase,
      snapshot: data.snapshot,  // NEW
      custom_name: data.customName,
    }),
  // ... rest of mutation
})
```

**Step 6: Update API client to support snapshot parameter**

In `/Users/slowik/Desktop/n8n/k8s/web-ui-next/lib/api.ts`, update the deployVersion method:

```typescript
export interface DeployVersionRequest {
  version: string
  mode: 'queue' | 'regular'
  isolated_db?: boolean
  snapshot?: string  // NEW
  custom_name?: string
}

// In api object:
deployVersion: async (request: DeployVersionRequest): Promise<DeploymentActionResponse> => {
  const params = new URLSearchParams({
    version: request.version,
    mode: request.mode,
  })

  if (request.isolated_db) params.append('isolated_db', 'true')
  if (request.snapshot) params.append('snapshot', request.snapshot)  // NEW
  if (request.custom_name) params.append('custom_name', request.custom_name)

  const response = await fetch(`${API_URL}/api/versions/deploy?${params}`, {
    method: 'POST',
  })
  return response.json()
},
```

**Step 7: Update backend to accept snapshot parameter**

In `/Users/slowik/Desktop/n8n/k8s/web-ui/api/versions.py`, update deploy endpoint (around line 50):

```python
@router.post("/deploy")
async def deploy_version(
    version: str,
    mode: str = Query(..., regex="^(queue|regular)$"),
    isolated_db: bool = False,
    snapshot: Optional[str] = None,  # NEW
    custom_name: Optional[str] = None
):
    """Deploy n8n version."""
    try:
        # Build command
        cmd = ["/workspace/scripts/deploy-version.sh", version]

        if mode == "queue":
            cmd.append("--queue")
        else:
            cmd.append("--regular")

        if isolated_db:
            cmd.append("--isolated-db")

        if snapshot:  # NEW
            cmd.extend(["--snapshot", snapshot])

        if custom_name:
            cmd.extend(["--name", custom_name])

        # ... rest of deploy logic
```

**Step 8: Test full flow**

1. Create named snapshot via UI
2. Open deploy drawer
3. Enable isolated database
4. Select snapshot from dropdown
5. Deploy
6. Verify instance has snapshot data

**Step 9: Commit**

```bash
git add web-ui-next/components/deploy-drawer.tsx web-ui-next/lib/api.ts web-ui/api/versions.py
git commit -m "feat(ui): add snapshot selector to deployment form

- Shows dropdown when isolated database is enabled
- Lists all named snapshots
- Passes snapshot name to backend API
- Backend forwards to deploy script"
```

---

## Task 13: Documentation & Final Testing

**Files:**
- Create: `/Users/slowik/Desktop/n8n/k8s/docs/snapshots-guide.md`

**Step 1: Write user guide**

```markdown
# Named Snapshots Guide

## Overview

Named snapshots allow you to create reusable database backups with custom names, which can be used to initialize isolated n8n instances.

## Use Cases

- **Testing migrations**: Deploy multiple versions with the same snapshot
- **Clean test environments**: Reuse a baseline snapshot for testing
- **Bug reproduction**: Share a snapshot with your team
- **Performance testing**: Create a snapshot with large datasets

## Creating Named Snapshots

### Via UI

1. Navigate to the Dashboard
2. Scroll to "Database Snapshots" panel
3. Click "Create Named" button
4. Enter a snapshot name (e.g., `test-data-v1`)
5. Select source database (Shared or specific instance)
6. Click "Create Snapshot"

### Via CLI

```bash
./scripts/create-named-snapshot.sh test-data-v1
```

From specific instance:
```bash
./scripts/create-named-snapshot.sh prod-clone --source n8n-v1-25-0
```

## Deploying with Snapshots

### Via UI

1. Click "Deploy New Version" button
2. Select version
3. Enable "Isolated Database"
4. Select snapshot from dropdown (or leave empty for fresh DB)
5. Click "Deploy"

### Via CLI

```bash
./scripts/deploy-version.sh 1.123 --regular --isolated-db --snapshot test-data-v1
```

## Managing Snapshots

### List Snapshots

Via UI: View in "Database Snapshots" panel (accordion)

Via CLI:
```bash
# All snapshots
./scripts/list-snapshots.sh

# Named only
./scripts/list-snapshots.sh --named-only

# Timestamped only
./scripts/list-snapshots.sh --auto-only
```

### Delete Snapshots

Via UI: Click "Delete" button next to snapshot

Via CLI:
```bash
./scripts/delete-snapshot.sh test-data-v1.sql
```

## Storage Structure

```
/backups/
├── snapshots/              # Named snapshots
│   ├── test-data-v1.sql
│   ├── prod-clone.sql
│   └── *.sql.meta         # Metadata files
└── n8n-*.sql              # Timestamped auto-snapshots
```

## Limitations

- Snapshots can only be used with isolated databases (not shared)
- Cross-namespace PVC access required (or NFS/shared storage)
- Snapshot restore happens during deployment (adds ~30s)
- Named snapshots must have unique names

## Troubleshooting

### "Snapshot not found" during deployment

1. Verify snapshot exists: `./scripts/list-snapshots.sh --named-only`
2. Check filename includes `.sql` extension
3. Ensure backup-storage PVC is mounted correctly

### Snapshot restore fails

1. Check Helm Job logs: `kubectl logs -n <namespace> job/restore-snapshot-<release>`
2. Verify PostgreSQL is running: `kubectl get pods -n <namespace>`
3. Check PVC access: `kubectl describe pvc backup-storage -n n8n-system`
```

**Step 2: Create comprehensive test plan**

```markdown
# Named Snapshots - Test Plan

## Pre-requisites
- Cluster running with shared database
- At least one deployment active
- Backup-storage PVC healthy

## Test Cases

### 1. Create Named Snapshot (UI)
- [ ] Click "Create Named" button in snapshots panel
- [ ] Enter valid name (alphanumeric, hyphens, underscores)
- [ ] Select "Shared Database" as source
- [ ] Click "Create Snapshot"
- [ ] Verify success toast appears
- [ ] Verify snapshot appears in "Named Snapshots" section

### 2. Create Named Snapshot (CLI)
- [ ] Run: `./scripts/create-named-snapshot.sh cli-test-1`
- [ ] Verify Job created: `kubectl get jobs -n n8n-system`
- [ ] Check logs: `kubectl logs -n n8n-system job/snapshot-cli-test-1-*`
- [ ] Verify file exists: `./scripts/list-snapshots.sh --named-only`

### 3. Invalid Snapshot Names
- [ ] Try spaces: `./scripts/create-named-snapshot.sh "test space"` - should fail
- [ ] Try special chars: `./scripts/create-named-snapshot.sh test@snapshot` - should fail
- [ ] Try slashes: `./scripts/create-named-snapshot.sh test/snapshot` - should fail
- [ ] Verify error message is clear

### 4. List Snapshots
- [ ] Run: `./scripts/list-snapshots.sh`
- [ ] Verify shows both named and timestamped sections
- [ ] Run: `./scripts/list-snapshots.sh --named-only`
- [ ] Verify shows only named snapshots
- [ ] Check UI: Accordion should show same snapshots

### 5. Delete Named Snapshot (UI)
- [ ] Click "Delete" on a named snapshot
- [ ] Verify snapshot disappears from list
- [ ] Verify success toast appears
- [ ] Refresh page - snapshot should still be gone

### 6. Delete Snapshot (CLI)
- [ ] Run: `./scripts/delete-snapshot.sh cli-test-1.sql`
- [ ] Type "yes" to confirm
- [ ] Verify snapshot deleted
- [ ] List snapshots - should not appear

### 7. Deploy with Snapshot (UI)
- [ ] Create test snapshot: `test-deploy-ui`
- [ ] Click "Deploy New Version"
- [ ] Select version 1.123
- [ ] Select "Regular" mode
- [ ] Enable "Isolated Database"
- [ ] Select "test-deploy-ui" from snapshot dropdown
- [ ] Click "Deploy"
- [ ] Wait for deployment
- [ ] Check restore job: `kubectl logs -n n8n-v1-123 job/restore-snapshot-*`
- [ ] Access UI: http://localhost:30123
- [ ] Verify data from snapshot is present

### 8. Deploy with Snapshot (CLI)
- [ ] Create test snapshot: `test-deploy-cli`
- [ ] Run: `./scripts/deploy-version.sh 1.124 --regular --isolated-db --snapshot test-deploy-cli`
- [ ] Verify deployment succeeds
- [ ] Check restore job logs
- [ ] Verify data loaded

### 9. Deploy without Snapshot
- [ ] Deploy: `./scripts/deploy-version.sh 1.125 --regular --isolated-db`
- [ ] Verify no restore job created
- [ ] Access UI - should be empty database

### 10. Snapshot from Isolated Instance
- [ ] Deploy isolated instance: v1.126
- [ ] Create workflows in that instance
- [ ] Create snapshot from it: `./scripts/create-named-snapshot.sh isolated-test --source n8n-v1-126`
- [ ] Deploy new instance with that snapshot: v1.127
- [ ] Verify workflows copied correctly

### 11. Edge Cases
- [ ] Try deploying with snapshot but without --isolated-db - should fail with clear error
- [ ] Try deploying with non-existent snapshot - should fail with list of available snapshots
- [ ] Create snapshot with existing name - should overwrite or fail?
- [ ] Delete snapshot that's actively being used - what happens?

### 12. Performance
- [ ] Create large snapshot (100MB+)
- [ ] Deploy with large snapshot
- [ ] Measure restore time
- [ ] Verify UI remains responsive

### 13. Cross-version Testing
- [ ] Create snapshot from v1.120
- [ ] Deploy to v1.130 with that snapshot
- [ ] Verify migration happens correctly
- [ ] Check n8n logs for migration messages

## Acceptance Criteria
- [ ] All test cases pass
- [ ] No errors in container logs
- [ ] UI is responsive and intuitive
- [ ] Error messages are clear and actionable
- [ ] Documentation is complete
```

**Step 3: Run full test suite**

Execute all test cases from the test plan above.

**Step 4: Commit documentation**

```bash
git add docs/snapshots-guide.md
git commit -m "docs: add user guide and test plan for named snapshots"
```

---

## Verification

After completing all tasks:

1. **End-to-End Test:**
   ```bash
   # 1. Create named snapshot
   ./scripts/create-named-snapshot.sh e2e-test

   # 2. Deploy with snapshot
   ./scripts/deploy-version.sh 1.123 --regular --isolated-db --snapshot e2e-test

   # 3. Verify deployment
   kubectl get pods -n n8n-v1-123
   kubectl logs -n n8n-v1-123 job/restore-snapshot-*
   curl http://localhost:30123  # Should load with snapshot data

   # 4. Clean up
   ./scripts/remove-version.sh 1.123
   ./scripts/delete-snapshot.sh e2e-test.sql
   ```

2. **UI Flow Test:**
   - Create named snapshot via UI
   - Deploy new version via UI with that snapshot
   - Verify data loaded correctly
   - Delete snapshot via UI

3. **Error Handling Test:**
   - Try invalid snapshot names
   - Try deploying with non-existent snapshot
   - Try snapshot without isolated DB flag

All tests should pass before considering this feature complete.

---

## Notes

- **Cross-namespace PVC access**: Current Helm implementation assumes backup-storage PVC can be mounted from any namespace. If using local storage, you may need to:
  - Use NFS/shared storage for backup-storage PVC
  - OR implement a copy mechanism (Job copies snapshot to target namespace before restore)

- **Snapshot size limits**: No limits enforced - consider adding validation for very large snapshots

- **Naming conflicts**: Creating a snapshot with an existing name will overwrite - consider adding confirmation dialog in UI

- **Snapshot versioning**: No versioning system - each snapshot is standalone. Consider adding version tags if needed.
