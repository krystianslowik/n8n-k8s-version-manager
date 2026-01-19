#!/bin/bash

set -e

# Usage: ./scripts/restore-snapshot.sh <snapshot-filename>

SNAPSHOT=$1

if [ -z "$SNAPSHOT" ]; then
  echo "Usage: ./scripts/restore-snapshot.sh <snapshot-filename>"
  echo "Example: ./scripts/restore-snapshot.sh n8n-20260119-120000-pre-v1.123.sql"
  echo ""
  echo "Available snapshots:"
  ./scripts/list-snapshots.sh
  exit 1
fi

# Get postgres pod
POSTGRES_POD=$(kubectl get pods -n n8n-system -l app=postgres -o jsonpath='{.items[0].metadata.name}')

if [ -z "$POSTGRES_POD" ]; then
  echo "Error: PostgreSQL pod not found"
  exit 1
fi

echo "Restoring snapshot: $SNAPSHOT"
echo "PostgreSQL pod: $POSTGRES_POD"
echo ""

read -p "This will OVERWRITE the current database. Are you sure? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Restore cancelled"
  exit 0
fi

echo "Restoring database..."
kubectl exec -it "$POSTGRES_POD" -n n8n-system -- sh -c "
  if [ ! -f /backups/$SNAPSHOT ]; then
    echo 'Error: Snapshot file not found: /backups/$SNAPSHOT'
    exit 1
  fi

  echo 'Dropping existing database...'
  psql -U admin -d postgres -c 'DROP DATABASE IF EXISTS n8n;'

  echo 'Creating fresh database...'
  psql -U admin -d postgres -c 'CREATE DATABASE n8n OWNER admin;'

  echo 'Restoring from snapshot...'
  psql -U admin -d n8n -f /backups/$SNAPSHOT

  echo 'Database restored successfully!'
"

echo ""
echo "Restore complete!"
echo "You may need to restart n8n pods for changes to take effect:"
echo "  kubectl rollout restart statefulset/n8n-main -n <namespace>"
