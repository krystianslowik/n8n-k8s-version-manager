# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

n8n Kubernetes Version Manager - a tool to run and switch between multiple n8n versions simultaneously on local Kubernetes (Docker Desktop). Each deployment gets its own namespace, isolated PostgreSQL database, and unique port.

## Architecture

### Kubernetes Layout
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

### API Architecture
```
Frontend (Next.js)
    │
    ├── gRPC-Web via Connect-ES ──→ Envoy Proxy (:8080) ──→ gRPC Server (:50051)
    │                                                        (primary API)
    └── REST (file uploads only) ──→ FastAPI (:8000)
```

**Ports:**
- **50051**: gRPC server (primary API for all operations)
- **8080**: Envoy proxy (gRPC-Web translation for browser access)
- **8000**: REST server (file uploads only)

**Port mapping formula** (n8n instances): `30000 + (major × 1000) + (minor × 10) + patch`
- 1.85.0 → 31850, 1.92.0 → 31920, 2.0.0 → 32000

**Known limitations**:
- **No NetworkPolicy**: Per-version namespaces share cluster networking by default.

## Commands

### Development
```bash
# Start all services (recommended)
docker-compose up -d

# Backend services manually
cd api && pip install -r requirements.txt
python server.py              # gRPC server on :50051
uvicorn main:app --port 8000  # REST upload server on :8000
# Note: Envoy proxy requires docker-compose

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

- `api/` - Backend (Python 3.11, gRPC + minimal REST)
  - `server.py` - gRPC server entry point (primary API)
  - `main.py` - FastAPI app (file uploads only)
  - `deployment.py` - Deployment orchestration logic
  - `deployment_phase.py` - Deployment phase tracking and streaming
  - `snapshot_ops.py` - Snapshot operations
  - `available_versions.py` - GitHub releases API client with 6-hour cache
  - `infrastructure.py` - Redis and backup storage health checks
  - `cluster.py` - Cluster resource monitoring
  - `services/` - gRPC service implementations
  - `generated/` - Protobuf-generated Python code

- `proto/` - Protocol Buffer definitions
  - `n8n.proto` - Service and message definitions

- `web-ui-next/` - Next.js 16 frontend (TypeScript/React 19)
  - `app/` - App Router pages
  - `components/` - React components (shadcn/ui)
  - `lib/grpc-client.ts` - Connect-ES gRPC client
  - `lib/types.ts` - TypeScript interfaces
  - `generated/` - Protobuf-generated TypeScript code

- `charts/`
  - `n8n-infrastructure/` - Redis, backup storage (shared)
  - `n8n-instance/` - Per-version n8n deployment chart

- `scripts/` - Bash CLI tools for deployment/snapshot operations

## API Reference

### gRPC Services (via Connect-ES on :8080)

**VersionService:**
- `ListVersions` - List all deployments
- `DeployVersion` - Create new deployment (server streaming for progress)
- `DeleteVersion` - Remove deployment
- `GetVersionStatus` - Get deployment status
- `GetVersionEvents` - Get Kubernetes events
- `GetVersionLogs` - Get pod logs
- `GetVersionConfig` - Get deployment configuration

**SnapshotService:**
- `ListSnapshots` - List all snapshots
- `CreateSnapshot` - Create named snapshot
- `DeleteSnapshot` - Delete snapshot
- `RestoreSnapshot` - Restore snapshot to deployment

**InfrastructureService:**
- `GetStatus` - Redis and backup storage health

**AvailableVersionsService:**
- `ListAvailableVersions` - Fetch n8n releases from GitHub

### REST Endpoints (on :8000)

- `POST /api/upload` - File uploads (snapshots, etc.)

## Tech Stack

- **Backend**: gRPC (grpcio), FastAPI 0.109 (uploads only), Pydantic 2.5 (subprocess/kubectl integration)
- **Frontend**: Next.js 16.1, React 19, Tailwind CSS 4, shadcn/ui, Connect-ES (gRPC-Web client)
- **API Layer**: Protocol Buffers, Envoy Proxy (gRPC-Web translation)
- **Infrastructure**: Helm 3, PostgreSQL 16, Redis 7, Docker Compose

## Conventions

- Git commits: Conventional Commits (feat:, fix:, refactor:, perf:, docs:)
- TypeScript throughout frontend
- Pydantic models for API validation
- shadcn/ui components (Radix UI primitives)
