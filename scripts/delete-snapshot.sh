#!/bin/bash
set -e

# Usage: ./scripts/delete-snapshot.sh <filename>

FILENAME=$1

if [ -z "$FILENAME" ]; then
  echo "Usage: ./scripts/delete-snapshot.sh <filename>"
  echo "Example: ./scripts/delete-snapshot.sh test-data-v1.sql"
  exit 1
fi

# Determine snapshot path (check both directories)
if [[ "$FILENAME" == *.sql ]]; then
  SNAPSHOT_PATH="/backups/snapshots/$FILENAME"
  if [ ! -f "/backups/$FILENAME" ]; then
    # Try timestamped directory
    SNAPSHOT_PATH="/backups/$FILENAME"
  fi
else
  echo "ERROR: Filename must end with .sql"
  exit 1
fi

echo "Deleting snapshot: $FILENAME"
read -p "Are you sure? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Deletion cancelled"
  exit 0
fi

# Get postgres pod to exec into
POSTGRES_POD=$(kubectl get pods -n n8n-system -l app=postgres -o jsonpath='{.items[0].metadata.name}')

if [ -z "$POSTGRES_POD" ]; then
  echo "Error: PostgreSQL pod not found"
  exit 1
fi

# Delete snapshot and metadata
kubectl exec "$POSTGRES_POD" -n n8n-system -- sh -c "
  if [ -f '$SNAPSHOT_PATH' ]; then
    rm -f '$SNAPSHOT_PATH'
    rm -f '${SNAPSHOT_PATH}.meta'
    echo 'Snapshot deleted: $FILENAME'
  else
    echo 'ERROR: Snapshot not found: $SNAPSHOT_PATH'
    exit 1
  fi
"
