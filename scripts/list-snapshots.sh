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
