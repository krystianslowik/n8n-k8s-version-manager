#!/bin/bash

set -e

# Usage: ./scripts/remove-version.sh <version>

VERSION=$1

if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/remove-version.sh <version>"
  echo "Example: ./scripts/remove-version.sh 1.123"
  exit 1
fi

# Convert version to namespace format
NAMESPACE="n8n-v${VERSION//./-}"
RELEASE_NAME="n8n-v${VERSION//./-}"

echo "Removing n8n version $VERSION..."
echo "Namespace: $NAMESPACE"
echo ""

# Check if namespace exists
if ! kubectl get namespace "$NAMESPACE" &>/dev/null; then
  echo "Error: Namespace $NAMESPACE does not exist"
  exit 1
fi

# Uninstall Helm release
echo "Uninstalling Helm release..."
helm uninstall "$RELEASE_NAME" --namespace "$NAMESPACE" || true

# Wait a bit for resources to be cleaned up
sleep 5

# Delete namespace
echo "Deleting namespace..."
kubectl delete namespace "$NAMESPACE"

echo ""
echo "n8n version $VERSION removed successfully!"
