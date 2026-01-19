#!/bin/bash

set -e

# Usage: ./scripts/deploy-version.sh <version> [--queue|--regular] [--isolated-db]

VERSION=$1
MODE=${2:---queue}
ISOLATED_DB=${3:-}

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/deploy-version.sh <version> [--queue|--regular] [--isolated-db]"
  echo "Example: ./scripts/deploy-version.sh 1.123 --queue"
  exit 1
fi

# Convert version to namespace format (dots to hyphens)
NAMESPACE="n8n-v${VERSION//./-}"
RELEASE_NAME="n8n-v${VERSION//./-}"

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
echo "Access UI: http://localhost:$(python3 -c "v='$VERSION'.split('.'); print(30000 + int(v[0])*100 + int(v[1]))")"
