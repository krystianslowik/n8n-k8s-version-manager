# n8n Version Manager Web UI Design

**Date:** 2026-01-19
**Status:** Design Complete - Ready for Implementation

## Overview

A web UI for managing n8n version deployments on local Kubernetes cluster. Provides quick version switching with visual feedback, running in a Docker container alongside the k8s setup.

## Goals

1. **Speed** - One-click deploy and remove operations
2. **Visibility** - See all versions, status, and resources at a glance
3. **Safety** - Confirmations for destructive actions, clear error messages
4. **Simplicity** - Single page app, minimal navigation, focused tool

## Architecture

### Container Setup

**Single Docker Container** containing:
- **Frontend**: Vite + React + shadcn/ui (compiled to static files)
- **Backend**: Python FastAPI server

**Why Docker:**
- Single `docker run` command to start
- Consistent environment
- Easy to distribute/share
- Runs alongside k8s cluster (not in it)

### Container Configuration

```dockerfile
FROM python:3.11-slim

# Install kubectl and helm
RUN apt-get update && apt-get install -y curl && \
    curl -LO https://dl.k8s.io/release/v1.28.0/bin/linux/amd64/kubectl && \
    chmod +x kubectl && mv kubectl /usr/local/bin/ && \
    curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
```

**Run Command:**
```bash
docker run -d \
  --name n8n-ui \
  --network host \
  -v ~/.kube/config:/root/.kube/config:ro \
  -v $(pwd):/workspace:ro \
  -p 8080:8080 \
  n8n-version-ui
```

**Mounted Volumes:**
- `~/.kube/config` - Kubernetes authentication
- Project directory (`/workspace`) - Access to scripts and charts

### Data Flow

```
Browser → FastAPI API → kubectl/helm commands → Kubernetes → Response → Browser
         ↓
    Static Files (React App)
```

## Backend API (FastAPI)

### Endpoints

```python
# Version Management
GET    /api/versions              # List deployed n8n versions
POST   /api/versions              # Deploy new version
DELETE /api/versions/{version}    # Remove version

# Snapshot Management
GET    /api/snapshots             # List database snapshots
POST   /api/snapshots/restore     # Restore from snapshot

# Infrastructure
GET    /api/infrastructure/status # Check postgres, redis health
GET    /api/available-versions    # List n8n versions (hardcoded or Docker Hub)
```

### Implementation Strategy

**Reuse existing bash scripts** via subprocess calls:

```python
@app.post("/api/versions")
async def deploy_version(version: str, mode: str, isolated_db: bool = False):
    cmd = ["/workspace/scripts/deploy-version.sh", version, f"--{mode}"]
    if isolated_db:
        cmd.append("--isolated-db")

    result = subprocess.run(cmd, capture_output=True, text=True, cwd="/workspace")
    return {
        "success": result.returncode == 0,
        "output": result.stdout,
        "error": result.stderr
    }

@app.get("/api/versions")
async def list_versions():
    # Parse output of ./scripts/list-versions.sh
    result = subprocess.run(
        ["/workspace/scripts/list-versions.sh"],
        capture_output=True,
        text=True,
        cwd="/workspace"
    )
    # Parse and return structured JSON
    return parse_versions_output(result.stdout)
```

**Benefits:**
- Reuses tested scripts (no reimplementation)
- Simple error handling
- Fast to implement

### Response Format

**GET /api/versions:**
```json
{
  "versions": [
    {
      "version": "1.85.0",
      "namespace": "n8n-v1-85-0",
      "mode": "queue",
      "status": "running",
      "pods": {
        "ready": 4,
        "total": 4
      },
      "url": "http://localhost:30185"
    }
  ]
}
```

**POST /api/versions:**
```json
{
  "success": true,
  "message": "Deployment initiated",
  "namespace": "n8n-v1-90-0",
  "url": "http://localhost:30190"
}
```

## Frontend UI (React + shadcn/ui)

### Tech Stack

- **Build Tool**: Vite (fast builds, hot reload)
- **Framework**: React 18
- **UI Library**: shadcn/ui components
- **Styling**: Tailwind CSS
- **HTTP Client**: Fetch API (built-in)
- **State**: React Query for data fetching

### Single Page Layout

```
┌─────────────────────────────────────────────┐
│ n8n Version Manager                    [Status]│
├─────────────────────────────────────────────┤
│                                             │
│ ┌─── Deploy New Version ─────────────────┐ │
│ │ Version: [1.90.0]                       │ │
│ │ Mode: (•) Queue  ( ) Regular            │ │
│ │ □ Isolated Database                     │ │
│ │                          [Deploy] ───┐  │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ┌─── Active Versions ─────────────────────┐ │
│ │ Version  Mode   Status  Pods  URL  [Del]│ │
│ │ 1.85.0   Queue  Running 4/4   →    [X]  │ │
│ │ 1.86.0   Regular Running 1/1  →    [X]  │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ▼ Database Snapshots (2)                    │
│ ├─ n8n-20260119-181411-pre-v2.1.0.sql [↻]  │
│ └─ n8n-20260119-181239-pre-v1.23.0.sql [↻] │
│                                             │
└─────────────────────────────────────────────┘
```

### Component Breakdown

**1. Header Component**
- Title + subtitle
- Infrastructure status indicator
  - Postgres: ✓ (green) / ✗ (red)
  - Redis: ✓ (green) / ✗ (red)

**2. DeployVersionCard Component** (shadcn Card)
- Version input (shadcn Input)
- Mode selector (shadcn RadioGroup)
- Isolated DB checkbox (shadcn Checkbox)
- Deploy button (shadcn Button, primary)
- Loading state with spinner

**3. VersionsTable Component** (shadcn Table)
- Columns: Version | Mode | Status | Pods | Access | Actions
- Each row:
  - Version text
  - Mode badge (shadcn Badge: "Queue" green, "Regular" blue)
  - Status badge (Running green, Pending yellow, Failed red)
  - Pod count (e.g., "4/4")
  - URL link (opens in new tab)
  - Delete button (shadcn Button, destructive)

**4. SnapshotsSection Component** (shadcn Accordion)
- Collapsible section
- List of snapshots with:
  - Filename
  - Timestamp (parsed from filename)
  - Restore button (shadcn Button, outline)

### shadcn Components Used

- `Card`, `CardHeader`, `CardTitle`, `CardContent`
- `Button` (primary, destructive, outline variants)
- `Input`
- `RadioGroup`, `RadioGroupItem`
- `Checkbox`
- `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableCell`
- `Badge`
- `Accordion`, `AccordionItem`, `AccordionTrigger`, `AccordionContent`
- `AlertDialog` (for confirmations)
- `Toast`, `Toaster` (for notifications)
- `Skeleton` (loading states)

## Error Handling & UX

### Real-time Updates

- **Polling**: Fetch `/api/versions` every 5 seconds
- **Smart polling**: Only when page is visible (Page Visibility API)
- **Auto-refresh**: After deploy/delete operations

### Loading States

1. **Initial Load**: Skeleton loaders for table rows
2. **Deploy Operation**:
   - Disable form
   - Button shows spinner
   - Show toast "Deploying version X.Y.Z..."
3. **Delete Operation**:
   - Disable delete button
   - Show spinner in button
   - Show toast "Removing version X.Y.Z..."

### Error Handling

**Deployment Errors:**
```
Toast: "Deployment failed: <error message from script>"
Expandable details with full script output
```

**Infrastructure Down:**
```
Banner at top: "⚠️ Infrastructure unavailable. Postgres or Redis not ready."
Disable deploy button
```

**Network Errors:**
```
Toast: "Connection error. Retrying..."
Auto-retry with exponential backoff
```

### Safety Confirmations

**Delete Version:**
```
AlertDialog:
  Title: "Delete n8n version 1.85.0?"
  Description: "This will remove the namespace and all pods. Database data will remain."
  Actions: [Cancel] [Delete]
```

**Restore Snapshot:**
```
AlertDialog:
  Title: "Restore snapshot?"
  Description: "This will OVERWRITE the current database with: n8n-20260119-181411-pre-v2.1.0.sql"
  Warning: "All current data will be replaced. This cannot be undone."
  Actions: [Cancel] [Restore]
```

### Visual Feedback

**Status Colors:**
- Running: Green (bg-green-500)
- Pending: Yellow (bg-yellow-500)
- Failed: Red (bg-red-500)

**Actions:**
- Toast notifications for all operations
- Smooth table row animations on add/remove
- Highlight newly deployed version (pulse animation for 3 seconds)

## Project Structure

```
web-ui/
├── Dockerfile
├── docker-compose.yml         # Optional: easier docker run
├── requirements.txt           # FastAPI, kubernetes, uvicorn
├── main.py                    # FastAPI application
├── api/
│   ├── versions.py           # Version endpoints
│   ├── snapshots.py          # Snapshot endpoints
│   └── infrastructure.py     # Infrastructure status
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── Header.tsx
│       │   ├── DeployVersionCard.tsx
│       │   ├── VersionsTable.tsx
│       │   └── SnapshotsSection.tsx
│       ├── lib/
│       │   ├── api.ts         # API client functions
│       │   └── utils.ts
│       └── components/ui/     # shadcn components
│           ├── button.tsx
│           ├── card.tsx
│           ├── input.tsx
│           └── ... (other shadcn components)
└── README.md
```

## Build Process

### Frontend Build
```bash
cd frontend
npm run build
# Output: frontend/dist/
```

### Docker Build
```bash
# Dockerfile copies frontend/dist/ to /app/static/
docker build -t n8n-version-ui .
```

### FastAPI Static File Serving
```python
from fastapi.staticfiles import StaticFiles

app.mount("/", StaticFiles(directory="static", html=True), name="static")
```

## Development Workflow

### Local Development (without Docker)

**Backend:**
```bash
cd web-ui
pip install -r requirements.txt
uvicorn main:app --reload --port 8080
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
# Runs on localhost:5173, proxies API calls to localhost:8080
```

### Production (Docker)

```bash
# Build
docker build -t n8n-version-ui .

# Run
docker run -d \
  --name n8n-ui \
  --network host \
  -v ~/.kube/config:/root/.kube/config:ro \
  -v $(pwd):/workspace:ro \
  -p 8080:8080 \
  n8n-version-ui

# Access
open http://localhost:8080
```

## Success Criteria

- ✅ Deploy n8n version in 2 clicks (version input + deploy button)
- ✅ See all running versions at a glance
- ✅ Remove version with 1 click (+ confirmation)
- ✅ Visual status updates without page refresh
- ✅ Access n8n instances directly from UI (clickable URLs)
- ✅ Restore database snapshots with confirmation
- ✅ Error messages are clear and actionable
- ✅ Works on macOS with Docker Desktop Kubernetes

## Non-Goals

- No user authentication (local tool only)
- No version upgrade suggestions
- No workflow import/export
- No n8n instance configuration editing
- No advanced Kubernetes features (scaling, resource limits)
- No remote access (localhost only)

## Future Enhancements (Phase 2)

- Real-time logs viewer (stream kubectl logs)
- Resource usage graphs (CPU, memory)
- Quick workflow migration between versions
- Custom n8n environment variables
- Multiple cluster support (switch kubeconfig)

## Implementation Plan Next Steps

1. Create `web-ui/` directory structure
2. Set up FastAPI backend with basic endpoints
3. Initialize Vite + React + shadcn frontend
4. Implement core components (DeployCard, VersionsTable)
5. Add polling and real-time updates
6. Create Dockerfile and test Docker deployment
7. Add error handling and confirmations
8. Polish UI and test end-to-end
