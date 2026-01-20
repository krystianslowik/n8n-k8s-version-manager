# Named Snapshots Guide

## Overview

Named snapshots allow you to create reusable database backups with custom names, which can be used to initialize isolated n8n instances.

## Use Cases

- **Testing migrations**: Deploy multiple versions with the same snapshot
- **Clean test environments**: Reuse a baseline snapshot for testing
- **Bug reproduction**: Share a snapshot with your team
- **Performance testing**: Create a snapshot with large datasets

## Creating Named Snapshots

### Via UI

1. Navigate to the Dashboard
2. Scroll to "Database Snapshots" panel
3. Click "Create Named" button
4. Enter a snapshot name (e.g., `test-data-v1`)
5. Select source database (Shared or specific instance)
6. Click "Create Snapshot"

### Via CLI

```bash
./scripts/create-named-snapshot.sh test-data-v1
```

From specific instance:
```bash
./scripts/create-named-snapshot.sh prod-clone --source n8n-v1-25-0
```

## Deploying with Snapshots

### Via UI

1. Click "Deploy New Version" button
2. Select version
3. Enable "Isolated Database"
4. Select snapshot from dropdown (or leave empty for fresh DB)
5. Click "Deploy"

### Via CLI

```bash
./scripts/deploy-version.sh 1.123 --regular --isolated-db --snapshot test-data-v1
```

## Managing Snapshots

### List Snapshots

Via UI: View in "Database Snapshots" panel (accordion)

Via CLI:
```bash
# All snapshots
./scripts/list-snapshots.sh

# Named only
./scripts/list-snapshots.sh --named-only

# Timestamped only
./scripts/list-snapshots.sh --auto-only
```

### Delete Snapshots

Via UI: Click "Delete" button next to snapshot

Via CLI:
```bash
./scripts/delete-snapshot.sh test-data-v1.sql
```

## Storage Structure

```
/backups/
├── snapshots/              # Named snapshots
│   ├── test-data-v1.sql
│   ├── prod-clone.sql
│   └── *.sql.meta         # Metadata files
└── n8n-*.sql              # Timestamped auto-snapshots
```

## Limitations

- Snapshots can only be used with isolated databases (not shared)
- Cross-namespace PVC access required (or NFS/shared storage)
- Snapshot restore happens during deployment (adds ~30s)
- Named snapshots must have unique names

## Troubleshooting

### "Snapshot not found" during deployment

1. Verify snapshot exists: `./scripts/list-snapshots.sh --named-only`
2. Check filename includes `.sql` extension
3. Ensure backup-storage PVC is mounted correctly

### Snapshot restore fails

1. Check Helm Job logs: `kubectl logs -n <namespace> job/restore-snapshot-<release>`
2. Verify PostgreSQL is running: `kubectl get pods -n <namespace>`
3. Check PVC access: `kubectl describe pvc backup-storage -n n8n-system`
