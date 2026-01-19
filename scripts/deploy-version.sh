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
