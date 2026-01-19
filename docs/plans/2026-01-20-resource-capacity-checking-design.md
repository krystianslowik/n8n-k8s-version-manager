# Resource Capacity Checking Design

## Problem

Deployments can fail silently when the cluster runs out of memory. Pods get stuck in "Pending" state with "Insufficient memory" errors, but:
- The deployment script succeeds (Helm install completes)
- Main pod can't schedule (no memory available)
- Worker/webhook pods may start (smaller footprint)
- UI shows "running" status but no URL (service never created)

**Current situation:**
- Cluster: 7.7GB allocatable memory
- 7 deployments requesting 10.6GB total (137% utilization)
- Result: 2 deployments stuck with main pods in Pending state

## Solution Overview

Two-phase approach:

### Phase 1: Pre-deployment Validation (Bash Script)
Add resource checking to `deploy-version.sh` that blocks deployments when insufficient memory.

### Phase 2: UI Monitoring Dashboard (Next.js)
Add real-time cluster resource monitoring to the UI with proactive warnings.

---

## Phase 1: Pre-deployment Validation

### Architecture

**Location:** `scripts/deploy-version.sh` (modify existing script)

**Execution flow:**
```
User runs: ./scripts/deploy-version.sh 1.123 --queue
  ↓
Check cluster capacity
  ↓
Calculate required memory (based on mode)
  ↓
Query current memory usage (kubectl)
  ↓
If insufficient → Block with error message
If sufficient → Proceed with Helm install
```

### Resource Calculation Logic

```bash
# Queue mode: main + webhook + 2 workers
QUEUE_MODE_MEMORY=1792  # 512 + 256 + (2 * 512)

# Regular mode: main only
REGULAR_MODE_MEMORY=512

# Get cluster allocatable memory
ALLOCATABLE=$(kubectl get nodes -o json |
  jq -r '.items[0].status.allocatable.memory' |
  sed 's/Ki$//' | awk '{print int($1/1024)}')

# Get current memory requests across all pods
CURRENT_USAGE=$(kubectl get pods --all-namespaces -o json |
  jq '[.items[] | select(.status.phase=="Running" or .status.phase=="Pending") |
      .spec.containers[].resources.requests.memory // "0Mi"] |
      map(rtrimstr("Mi") | tonumber) | add')

# Calculate available memory
AVAILABLE=$((ALLOCATABLE - CURRENT_USAGE))

# Determine required for this deployment
if [ "$MODE" == "--queue" ]; then
  REQUIRED=$QUEUE_MODE_MEMORY
else
  REQUIRED=$REGULAR_MODE_MEMORY
fi

# Check if sufficient
if [ $AVAILABLE -lt $REQUIRED ]; then
  echo "ERROR: Insufficient cluster memory"
  echo ""
  echo "Required: ${REQUIRED}Mi"
  echo "Available: ${AVAILABLE}Mi"
  echo "Cluster total: ${ALLOCATABLE}Mi"
  echo "Current usage: ${CURRENT_USAGE}Mi ($(( CURRENT_USAGE * 100 / ALLOCATABLE ))%)"
  echo ""
  echo "Active deployments consuming memory:"
  # List deployments with their memory usage
  kubectl get pods --all-namespaces -o custom-columns=...
  echo ""
  echo "To free up memory, delete old deployments:"
  echo "  ./scripts/remove-version.sh <version>"
  exit 1
fi
```

### Error Message Format

```
ERROR: Insufficient cluster memory

Required: 1792Mi (queue mode deployment)
Available: 248Mi
Cluster total: 7736Mi
Current usage: 7488Mi (97%)

Active deployments consuming memory:
  n8n-v1-123-11  1792Mi  (Queue)   4h 30m old
  n8n-v2-4-3     1792Mi  (Queue)   3h 15m old
  n8n-v1-86-0     512Mi  (Regular) 5h 10m old
  n8n-v2-3-4      512Mi  (Regular) 1h 5m old

To free up memory, delete old deployments:
  ./scripts/remove-version.sh 1.123.11
  ./scripts/remove-version.sh 1.86.0
```

### Implementation Notes

- **Check timing:** Before `helm install` command (line 88 in current script)
- **Exit code:** Non-zero (1) on insufficient resources
- **jq requirement:** Script already uses kubectl, add jq for JSON parsing
- **Fallback:** If jq not available, skip check with warning

---

## Phase 2: UI Monitoring Dashboard

### API Endpoint: `/api/cluster/resources`

**Response format:**
```json
{
  "memory": {
    "allocatable_mi": 7736,
    "used_mi": 7488,
    "available_mi": 248,
    "utilization_percent": 97
  },
  "can_deploy": {
    "queue_mode": false,
    "regular_mode": false
  },
  "deployments": [
    {
      "namespace": "n8n-v1-123-11",
      "memory_mi": 1792,
      "mode": "queue",
      "age_seconds": 16200
    }
  ]
}
```

**Implementation:** `web-ui/api/cluster.py`

### UI Components

#### 1. Dashboard Stat Card - "Cluster Memory"

**Location:** Dashboard page (top stat cards section)

**Display:**
```
┌─────────────────────────────┐
│ 🧠 Cluster Memory           │
│                             │
│ [████████████░░░] 97%       │
│ 7.5 GB / 7.7 GB            │
│                             │
│ ⚠️ Low capacity             │
└─────────────────────────────┘
```

**Color coding:**
- Green: < 70% utilization
- Yellow: 70-85% utilization
- Red: > 85% utilization

**Click behavior:** Opens memory details dialog with deployment list

#### 2. Deploy Drawer - Capacity Warning

**Location:** Inside deploy drawer, before "Deploy" button

**Display when insufficient capacity:**
```
┌───────────────────────────────────────┐
│ ⚠️ Insufficient Memory                │
│                                       │
│ This queue mode deployment needs      │
│ 1792Mi, but only 248Mi available.    │
│                                       │
│ Delete one of these deployments:      │
│                                       │
│ • n8n-v1-123-11 (1792Mi) [Delete]    │
│ • n8n-v2-4-3 (1792Mi) [Delete]       │
│ • n8n-v1-86-0 (512Mi) [Delete]       │
│                                       │
│ [Deploy] button is disabled           │
└───────────────────────────────────────┘
```

**Behavior:**
- Warning appears when user selects queue/regular mode
- "Deploy" button disabled if insufficient capacity
- Delete buttons trigger inline deletion, rechecks capacity
- Auto-hides warning when capacity becomes sufficient

#### 3. Sidebar - Memory Gauge

**Location:** Sidebar (below infrastructure status)

**Display:**
```
Memory Usage
[████████████░░░] 97%
7.5 GB / 7.7 GB
```

**Polling:** Every 10 seconds (same as infrastructure status)

### Real-time Updates

**Polling strategy:**
- Dashboard stat card: 10s interval
- Deploy drawer: Check on mode change + 5s interval while open
- Sidebar gauge: 10s interval

**Optimistic updates:**
- After successful deployment: Immediately add predicted memory usage
- After successful deletion: Immediately subtract memory usage
- Re-sync on next poll

---

## Data Flow

```
┌─────────────┐
│ User clicks │
│   Deploy    │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│ UI: Check capacity  │
│ GET /api/cluster/   │
│     resources       │
└──────┬──────────────┘
       │
       ▼
   Sufficient?
       │
  Yes ─┼─ No ───→ Show warning
       │          Disable button
       ▼          Show delete options
┌─────────────────────┐
│ Call deploy API     │
│ POST /api/versions/ │
│      deploy         │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│ Backend: Check      │
│ capacity (bash)     │
└──────┬──────────────┘
       │
  Sufficient?
       │
  Yes ─┼─ No ───→ Return 400 error
       │          "Insufficient memory"
       ▼
┌─────────────────────┐
│ Run helm install    │
└─────────────────────┘
```

**Defense in depth:** Both UI and backend validate capacity
- UI check: Better UX, proactive guidance
- Backend check: Safety net, prevents API/CLI bypasses

---

## Migration Strategy

### Step 1: Update Bash Script (Immediate)
- Modify `scripts/deploy-version.sh`
- Add resource checking before helm install
- Test with current deployments

### Step 2: Add Backend API (Next.js Rebuild)
- Create `web-ui/api/cluster.py`
- Add `/api/cluster/resources` endpoint
- Test with Postman/curl

### Step 3: Add UI Components (Next.js Rebuild)
- Add memory stat card to dashboard
- Add capacity warning to deploy drawer
- Add memory gauge to sidebar
- Test end-to-end flow

### Step 4: Documentation
- Update README with capacity planning guidance
- Add troubleshooting section for "Insufficient memory" errors

---

## Testing Strategy

### Bash Script Testing
1. Test with sufficient capacity (should allow deployment)
2. Test with insufficient capacity (should block with error)
3. Test error message formatting (readable, actionable)
4. Test with missing jq (should warn but allow deployment)

### UI Testing
1. Test memory gauge color coding (green/yellow/red thresholds)
2. Test deploy drawer warning appears/disappears correctly
3. Test inline delete from warning dialog
4. Test optimistic updates after deploy/delete
5. Test polling intervals (no excessive requests)

### Edge Cases
1. Multiple simultaneous deployments
2. Deployments deleted outside UI (kubectl)
3. Cluster memory increased (Docker Desktop settings)
4. Isolated DB mode (adds postgres pod, more memory)

---

## Future Enhancements

### Auto-scaling Recommendations
Show suggestion: "Increase Docker Desktop memory to 12GB to run 8 concurrent deployments"

### Historical Tracking
Track peak memory usage over time, show trends

### Smart Cleanup Suggestions
Analyze deployment access patterns, suggest which to delete based on:
- Age (older first)
- Last accessed (if trackable)
- Mode (regular uses less memory than queue)

### Quota Management
Allow setting max deployments per user/team

---

## Success Criteria

✅ No more silent deployment failures due to memory
✅ Clear error messages when capacity exceeded
✅ Users can make informed decisions about what to delete
✅ UI proactively warns before attempting deployment
✅ Both CLI and UI respect capacity limits
