#!/bin/bash

echo "=== n8n Versions Deployed ==="
echo ""

# Get all n8n version namespaces
NAMESPACES=$(kubectl get namespaces -o name | grep 'n8n-v' | sed 's|namespace/||')

if [ -z "$NAMESPACES" ]; then
  echo "No n8n versions deployed"
  exit 0
fi

for NS in $NAMESPACES; do
  echo "Namespace: $NS"

  # Extract version from namespace
  VERSION=$(echo "$NS" | sed 's/n8n-v//' | sed 's/-/./g')
  echo "  Version: $VERSION"

  # Get mode from pod labels
  MODE=$(kubectl get pods -n "$NS" -l component=worker -o name 2>/dev/null | wc -l)
  if [ "$MODE" -gt 0 ]; then
    echo "  Mode: Queue"
  else
    echo "  Mode: Regular"
  fi

  # Get pod status
  echo "  Pods:"
  kubectl get pods -n "$NS" --no-headers | awk '{print "    " $1 " - " $3}'

  # Get NodePort
  NODEPORT=$(kubectl get svc n8n-main -n "$NS" -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null)
  if [ -n "$NODEPORT" ]; then
    echo "  Access: http://localhost:$NODEPORT"
  fi

  echo ""
done
