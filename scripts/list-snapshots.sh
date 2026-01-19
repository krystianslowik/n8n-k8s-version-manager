#!/bin/bash

echo "=== Database Snapshots ==="
echo ""

# Get backup pod name
BACKUP_POD=$(kubectl get pods -n n8n-system -l app=postgres -o jsonpath='{.items[0].metadata.name}')

if [ -z "$BACKUP_POD" ]; then
  echo "Error: PostgreSQL pod not found in n8n-system namespace"
  exit 1
fi

# List snapshots from backup volume
kubectl exec "$BACKUP_POD" -n n8n-system -- sh -c "
  if [ -d /backups ]; then
    ls -lh /backups/*.sql 2>/dev/null | awk '{print \$9, \"-\", \$5}' || echo 'No snapshots found'
  else
    echo 'Backup directory not mounted'
  fi
"
