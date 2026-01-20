#!/bin/bash
set -e

# Usage: ./scripts/delete-snapshot.sh <filename>

FILENAME=$1

if [ -z "$FILENAME" ]; then
  echo "Usage: ./scripts/delete-snapshot.sh <filename>"
  echo "Example: ./scripts/delete-snapshot.sh test-data-v1.sql"
  exit 1
fi

# Validate filename
if [[ ! "$FILENAME" == *.sql ]]; then
  echo "ERROR: Filename must end with .sql"
  exit 1
fi

# Determine if it's a named or timestamped snapshot
if [[ "$FILENAME" == n8n-*.sql ]]; then
  SNAPSHOT_PATH="/backups/$FILENAME"
else
  SNAPSHOT_PATH="/backups/snapshots/$FILENAME"
fi

echo "Deleting snapshot: $FILENAME"
read -p "Are you sure? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
  echo "Deletion cancelled"
  exit 0
fi

# Use temporary pod to delete the snapshot
kubectl delete pod tmp-delete --ignore-not-found=true -n n8n-system >/dev/null 2>&1
DELETE_RESULT=$(kubectl run tmp-delete --rm -i --restart=Never --image=busybox -n n8n-system \
  --overrides="{\"spec\":{\"containers\":[{\"name\":\"tmp-delete\",\"image\":\"busybox\",\"command\":[\"sh\",\"-c\",\"if [ -f '$SNAPSHOT_PATH' ]; then rm -f '$SNAPSHOT_PATH' '${SNAPSHOT_PATH}.meta' 2>/dev/null; echo 'deleted'; else echo 'not-found'; fi\"],\"volumeMounts\":[{\"name\":\"backup\",\"mountPath\":\"/backups\"}]}],\"volumes\":[{\"name\":\"backup\",\"persistentVolumeClaim\":{\"claimName\":\"backup-storage\"}}]}}" \
  2>&1 | grep -v "^pod.*deleted" | tr -d '\n')

if [ "$DELETE_RESULT" == "deleted" ]; then
  echo "Snapshot deleted: $FILENAME"
elif [ "$DELETE_RESULT" == "not-found" ]; then
  echo "ERROR: Snapshot not found: $SNAPSHOT_PATH"
  exit 1
else
  echo "ERROR: Unexpected result: $DELETE_RESULT"
  exit 1
fi
