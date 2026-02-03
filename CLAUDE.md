# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

n8n Kubernetes Version Manager - a tool to run and switch between multiple n8n versions simultaneously on local Kubernetes (Docker Desktop). Each deployment gets its own namespace, isolated PostgreSQL database, and unique port.

## Architecture

```
Docker Desktop Kubernetes
├── n8n-system (shared infrastructure)
│   ├── Redis (queue coordination)
│   └── Backup Storage Pod (PVC for database snapshots)
└── n8n-v{version} (per-version namespaces)
    ├── PostgreSQL StatefulSet (isolated database)
    ├── n8n Main Pod
    ├── Worker Pods (queue mode only)
    └── Webhook Pod (queue mode only)
```

**Port mapping formula**: `30000 + (major × 1000) + (minor × 10) + patch`
- 1.85.0 → 31850, 1.92.0 → 31920, 2.0.0 → 32000

**Known limitations**:
- **No NetworkPolicy**: Per-version namespaces share cluster networking by default.

## Commands

### Development
```bash
# Start both services (recommended)
docker-compose up -d

# Backend only
cd api && pip install -r requirements.txt && uvicorn main:app --reload --port 8000

# Frontend only
cd web-ui-next && npm install && npm run dev
```

### Frontend
```bash
cd web-ui-next
npm run dev      # Dev server on http://localhost:3000
npm run build    # Production build
npm run lint     # ESLint
```

### Infrastructure Setup
```bash
kubectl create namespace n8n-system
helm install n8n-infra ./charts/n8n-infrastructure -n n8n-system
```

### CLI Scripts
```bash
./scripts/deploy-version.sh 1.85.0 --queue              # Deploy with queue mode
./scripts/deploy-version.sh 1.92.0 --regular            # Deploy regular mode
./scripts/deploy-version.sh 1.85.0 --regular --snapshot test-data-v1  # With snapshot
./scripts/list-versions.sh                               # List deployments
./scripts/remove-version.sh 1.85.0                       # Remove deployment
./scripts/list-snapshots.sh                              # List snapshots
./scripts/create-named-snapshot.sh my-snapshot           # Create named snapshot
```

## Project Structure

- `api/` - FastAPI backend (Python 3.11)
  - `main.py` - Entry point, CORS, cache middleware
  - `versions.py` - Deploy/delete/status/events/logs/config endpoints
  - `snapshots.py` - Snapshot CRUD and restore operations
  - `available_versions.py` - GitHub releases API client with 6-hour cache
  - `infrastructure.py` - Redis and backup storage health checks
  - `cluster.py` - Cluster resource monitoring

- `web-ui-next/` - Next.js 16 frontend (TypeScript/React 19)
  - `app/` - App Router pages
  - `components/` - React components (shadcn/ui)
  - `lib/api.ts` - Type-safe API client
  - `lib/types.ts` - TypeScript interfaces

- `charts/`
  - `n8n-infrastructure/` - Redis, backup storage (shared)
  - `n8n-instance/` - Per-version n8n deployment chart

- `scripts/` - Bash CLI tools for deployment/snapshot operations

## Key API Endpoints

- `GET/POST /api/versions` - List/create deployments
- `DELETE /api/versions/{namespace}` - Remove deployment
- `GET /api/versions/{namespace}/status|events|logs|config` - Deployment details
- `GET/POST/DELETE /api/snapshots` - Snapshot management
- `GET /api/infrastructure/status` - Redis/backup health
- `GET /api/available-versions` - Fetch n8n releases from GitHub

## Tech Stack

- **Backend**: FastAPI 0.109, Pydantic 2.5, uvicorn (subprocess/kubectl integration)
- **Frontend**: Next.js 16.1, React 19, Tailwind CSS 4, shadcn/ui, TanStack React Query
- **Infrastructure**: Helm 3, PostgreSQL 16, Redis 7, Docker Compose

## Conventions

- Git commits: Conventional Commits (feat:, fix:, refactor:, perf:, docs:)
- TypeScript throughout frontend
- Pydantic models for API validation
- shadcn/ui components (Radix UI primitives)
