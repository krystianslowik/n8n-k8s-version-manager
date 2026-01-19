#!/bin/bash

set -e

# Usage: ./scripts/deploy-version.sh <version> [--queue|--regular] [--isolated-db] [--name <custom-name>]

VERSION=$1
shift

# Parse flags
MODE="--queue"
ISOLATED_DB=""
CUSTOM_NAME=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --queue|--regular)
      MODE=$1
      shift
      ;;
    --isolated-db)
      ISOLATED_DB=$1
      shift
      ;;
    --name)
      CUSTOM_NAME="$2"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/deploy-version.sh <version> [--queue|--regular] [--isolated-db] [--name <custom-name>]"
  echo "Example: ./scripts/deploy-version.sh 1.123 --queue"
  echo "Example with custom name: ./scripts/deploy-version.sh 1.123 --regular --name acme-prod"
  exit 1
fi

# Generate namespace and port
if [ -n "$CUSTOM_NAME" ]; then
  NAMESPACE="$CUSTOM_NAME"
  RELEASE_NAME="$CUSTOM_NAME"

  # Hash-based port for custom names (CRC32 mod 1000 + 30000)
  PORT=$(echo -n "$CUSTOM_NAME" | cksum | awk '{print 30000 + ($1 % 1000)}')
else
  # Auto-generate from version
  NAMESPACE="n8n-v${VERSION//./-}"
  RELEASE_NAME="n8n-v${VERSION//./-}"

  # Calculate port from version
  PORT=$(python3 -c "v='$VERSION'.split('.'); print(30000 + int(v[0])*100 + int(v[1]))")
fi

# Validate namespace doesn't already exist
if kubectl get namespace "$NAMESPACE" &> /dev/null; then
  echo "ERROR: Namespace '$NAMESPACE' already exists"
  echo "Use a different name or remove the existing deployment first."
  exit 1
fi

# Determine queue mode
if [ "$MODE" == "--queue" ]; then
  QUEUE_MODE="true"
  echo "Deploying n8n v${VERSION} in QUEUE mode..."
elif [ "$MODE" == "--regular" ]; then
  QUEUE_MODE="false"
  echo "Deploying n8n v${VERSION} in REGULAR mode..."
else
  echo "Invalid mode: $MODE (use --queue or --regular)"
  exit 1
fi

# Determine isolated DB
if [ "$ISOLATED_DB" == "--isolated-db" ]; then
  ISOLATED="true"
  echo "Using ISOLATED database"
else
  ISOLATED="false"
  echo "Using SHARED database"
fi

# Check cluster capacity before deploying
echo ""
echo "Checking cluster capacity..."

# Memory requirements (in Mi)
QUEUE_MODE_MEMORY=1792  # main(512) + webhook(256) + 2*worker(512)
REGULAR_MODE_MEMORY=512  # main only
ISOLATED_DB_MEMORY=512   # postgres when using isolated DB

# Calculate required memory for this deployment
if [ "$QUEUE_MODE" == "true" ]; then
  REQUIRED_MEMORY=$QUEUE_MODE_MEMORY
else
  REQUIRED_MEMORY=$REGULAR_MODE_MEMORY
fi

# Add isolated DB memory if needed
if [ "$ISOLATED" == "true" ]; then
  REQUIRED_MEMORY=$((REQUIRED_MEMORY + ISOLATED_DB_MEMORY))
fi

# Get cluster allocatable memory (in Mi)
ALLOCATABLE=$(kubectl get nodes -o json 2>/dev/null | \
  python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    mem = data['items'][0]['status']['allocatable']['memory']
    # Convert Ki to Mi
    print(int(mem.rstrip('Ki')) // 1024)
except:
    print('0')
" 2>/dev/null || echo "0")

# Get current memory requests across all pods (in Mi)
CURRENT_USAGE=$(kubectl get pods --all-namespaces -o json 2>/dev/null | \
  python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    total = 0
    for pod in data['items']:
        if pod['status']['phase'] in ['Running', 'Pending']:
            for container in pod['spec']['containers']:
                mem_req = container.get('resources', {}).get('requests', {}).get('memory', '0')
                if mem_req.endswith('Mi'):
                    total += int(mem_req[:-2])
                elif mem_req.endswith('Gi'):
                    total += int(mem_req[:-2]) * 1024
    print(total)
except:
    print('0')
" 2>/dev/null || echo "0")

# Calculate available memory
AVAILABLE=$((ALLOCATABLE - CURRENT_USAGE))

# Check if we have enough capacity
if [ "$ALLOCATABLE" -eq 0 ]; then
  echo "⚠️  Warning: Could not determine cluster capacity (kubectl or python3 not available)"
  echo "Proceeding without capacity check..."
  echo ""
elif [ $AVAILABLE -lt $REQUIRED_MEMORY ]; then
  echo "❌ ERROR: Insufficient cluster memory"
  echo ""
  echo "Required:  ${REQUIRED_MEMORY}Mi ($([ "$QUEUE_MODE" == "true" ] && echo "queue" || echo "regular") mode$([ "$ISOLATED" == "true" ] && echo " + isolated DB" || echo ""))"
  echo "Available: ${AVAILABLE}Mi"
  echo "Total:     ${ALLOCATABLE}Mi"
  echo "Usage:     ${CURRENT_USAGE}Mi ($((CURRENT_USAGE * 100 / ALLOCATABLE))%)"
  echo ""
  echo "Active n8n deployments:"

  # List n8n deployments with their memory usage
  for ns in $(kubectl get ns -o name 2>/dev/null | grep "namespace/n8n-v" | cut -d/ -f2); do
    ns_memory=$(kubectl get pods -n "$ns" -o json 2>/dev/null | \
      python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    total = 0
    for pod in data['items']:
        if pod['status']['phase'] in ['Running', 'Pending']:
            for container in pod['spec']['containers']:
                mem_req = container.get('resources', {}).get('requests', {}).get('memory', '0')
                if mem_req.endswith('Mi'):
                    total += int(mem_req[:-2])
                elif mem_req.endswith('Gi'):
                    total += int(mem_req[:-2]) * 1024
    print(total)
except:
    print('0')
" 2>/dev/null || echo "0")

    # Get namespace age
    ns_age=$(kubectl get namespace "$ns" -o jsonpath='{.metadata.creationTimestamp}' 2>/dev/null | \
      python3 -c "
from datetime import datetime
import sys
try:
    created = datetime.fromisoformat(sys.stdin.read().strip().replace('Z', '+00:00'))
    now = datetime.now(created.tzinfo)
    diff = now - created
    hours = int(diff.total_seconds() // 3600)
    mins = int((diff.total_seconds() % 3600) // 60)
    if hours > 24:
        days = hours // 24
        hours = hours % 24
        print(f'{days}d {hours}h')
    elif hours > 0:
        print(f'{hours}h {mins}m')
    else:
        print(f'{mins}m')
except:
    print('unknown')
" 2>/dev/null || echo "unknown")

    echo "  • $ns (${ns_memory}Mi, age: $ns_age)"
  done

  echo ""
  echo "To free up memory, delete old deployments:"
  echo "  ./scripts/remove-version.sh <version>"
  echo ""
  exit 1
else
  echo "✓ Sufficient capacity: ${AVAILABLE}Mi available, ${REQUIRED_MEMORY}Mi required"
fi
echo ""

# Deploy using Helm
echo "Installing Helm release ${RELEASE_NAME} in namespace ${NAMESPACE}..."
helm install "$RELEASE_NAME" ./charts/n8n-instance \
  --set n8nVersion="$VERSION" \
  --set queueMode="$QUEUE_MODE" \
  --set isolatedDB="$ISOLATED" \
  --namespace "$NAMESPACE" \
  --create-namespace

echo ""
echo "Deployment initiated!"
echo "Namespace: $NAMESPACE"
echo "Version: $VERSION"
echo "Mode: $([ "$QUEUE_MODE" == "true" ] && echo "Queue" || echo "Regular")"
echo "Database: $([ "$ISOLATED" == "true" ] && echo "Isolated" || echo "Shared")"
echo ""
echo "Check status: kubectl get pods -n $NAMESPACE"
echo "View logs: kubectl logs -f n8n-main-0 -n $NAMESPACE"
echo "Access UI: http://localhost:$PORT"
