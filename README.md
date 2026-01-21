# n8n Kubernetes Version Manager

Run multiple n8n versions on local Kubernetes. Deploy, compare, and test different versions with isolated databases and a web UI.

## Requirements

- **Docker Desktop** with Kubernetes enabled
- **Helm 3** - `brew install helm`

```bash
kubectl config current-context  # Should show: docker-desktop
```

## Quick Start

```bash
# 1. Install infrastructure
kubectl create namespace n8n-system
helm install n8n-infra ./charts/n8n-infrastructure -n n8n-system

# 2. Start the web UI
docker-compose up -d

# 3. Open http://localhost:3000
```

## Usage

### Web UI

1. Click **Deploy New Version**
2. Select version from dropdown or search
3. Choose mode (Queue or Regular)
4. Optionally restore from a database snapshot
5. Click Deploy

Each deployment gets:
- Its own namespace (`n8n-v1-85-0`)
- Isolated PostgreSQL database
- Unique port (`http://localhost:30185`)

### Deployment Details

Click any deployment row to view:
- **Status** - Pod states, container health, restart counts
- **Events** - Kubernetes events timeline
- **Logs** - Container logs with filtering
- **Config** - Connection details and credentials

### Snapshots

Database snapshots allow you to:
- Save workflow state before testing
- Restore to any deployment
- Upload existing backups

Create snapshots from the deployment row menu. Restore from the Status tab in deployment details.

### CLI

```bash
# Deploy
./scripts/deploy-version.sh 1.85.0 --queue

# List deployments
./scripts/list-versions.sh

# Remove
./scripts/remove-version.sh 1.85.0
```

## Port Mapping

Ports derived from version: `30000 + (major * 100) + minor`

| Version | URL |
|---------|-----|
| 1.85.0 | http://localhost:30185 |
| 1.92.0 | http://localhost:30192 |
| 2.0.0 | http://localhost:30200 |

## Cleanup

```bash
# Remove all deployments
kubectl delete namespace -l app=n8n

# Remove infrastructure
helm uninstall n8n-infra -n n8n-system
kubectl delete namespace n8n-system

# Stop UI
docker-compose down
```

## Development

```bash
# API
cd api && pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend
cd web-ui-next && npm install && npm run dev
```
