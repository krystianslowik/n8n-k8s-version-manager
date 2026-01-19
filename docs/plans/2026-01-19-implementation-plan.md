# K8s n8n Version Switching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Kubernetes-based system for quickly switching between n8n versions with queue mode support and automatic database snapshots.

**Architecture:** Two Helm charts - one for shared infrastructure (Postgres, Redis, backups) and one for n8n instances. Each version runs in its own namespace, with conditional rendering for queue vs regular mode.

**Tech Stack:** Kubernetes (Docker Desktop), Helm 3, PostgreSQL, Redis, n8n

---

## Task 1: Create Infrastructure Helm Chart Foundation

**Files:**
- Create: `charts/n8n-infrastructure/Chart.yaml`
- Create: `charts/n8n-infrastructure/values.yaml`
- Create: `charts/n8n-infrastructure/templates/_helpers.tpl`

**Step 1: Create Chart.yaml**

```bash
mkdir -p charts/n8n-infrastructure/templates
```

Create `charts/n8n-infrastructure/Chart.yaml`:

```yaml
apiVersion: v2
name: n8n-infrastructure
description: Shared infrastructure for n8n version switching (PostgreSQL, Redis, Backups)
type: application
version: 0.1.0
appVersion: "1.0"
maintainers:
  - name: n8n-team
```

**Step 2: Create values.yaml**

Create `charts/n8n-infrastructure/values.yaml`:

```yaml
# PostgreSQL configuration
postgres:
  image: postgres:16
  database: n8n
  username: admin
  password: changeme123  # Change in production
  storage:
    size: 10Gi
    storageClass: ""  # Use default storage class
  resources:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 2Gi

# Redis configuration
redis:
  image: redis:6-alpine
  storage:
    size: 2Gi
    storageClass: ""
  resources:
    requests:
      cpu: 100m
      memory: 128Mi
    limits:
      cpu: 500m
      memory: 512Mi

# Backup configuration
backup:
  enabled: true
  retention: 10  # Keep last 10 snapshots
  storage:
    size: 20Gi
    storageClass: ""
```

**Step 3: Create Helm helpers**

Create `charts/n8n-infrastructure/templates/_helpers.tpl`:

```yaml
{{/*
Expand the name of the chart.
*/}}
{{- define "n8n-infrastructure.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "n8n-infrastructure.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "n8n-infrastructure.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "n8n-infrastructure.labels" -}}
helm.sh/chart: {{ include "n8n-infrastructure.chart" . }}
{{ include "n8n-infrastructure.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "n8n-infrastructure.selectorLabels" -}}
app.kubernetes.io/name: {{ include "n8n-infrastructure.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}
```

**Step 4: Verify chart structure**

Run: `tree charts/n8n-infrastructure`

Expected output:
```
charts/n8n-infrastructure
├── Chart.yaml
├── templates
│   └── _helpers.tpl
└── values.yaml
```

**Step 5: Commit**

```bash
git add charts/n8n-infrastructure/
git commit -m "feat: create infrastructure Helm chart foundation

- Add Chart.yaml with metadata
- Add values.yaml with Postgres, Redis, and backup configuration
- Add Helm template helpers

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create PostgreSQL StatefulSet

**Files:**
- Create: `charts/n8n-infrastructure/templates/postgres-statefulset.yaml`
- Create: `charts/n8n-infrastructure/templates/postgres-service.yaml`
- Create: `charts/n8n-infrastructure/templates/postgres-pvc.yaml`

**Step 1: Create PostgreSQL PVC**

Create `charts/n8n-infrastructure/templates/postgres-pvc.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data
  namespace: n8n-system
  labels:
    {{- include "n8n-infrastructure.labels" . | nindent 4 }}
    app: postgres
spec:
  accessModes:
    - ReadWriteOnce
  {{- if .Values.postgres.storage.storageClass }}
  storageClassName: {{ .Values.postgres.storage.storageClass }}
  {{- end }}
  resources:
    requests:
      storage: {{ .Values.postgres.storage.size }}
```

**Step 2: Create PostgreSQL Service**

Create `charts/n8n-infrastructure/templates/postgres-service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: n8n-system
  labels:
    {{- include "n8n-infrastructure.labels" . | nindent 4 }}
    app: postgres
spec:
  type: ClusterIP
  ports:
    - port: 5432
      targetPort: 5432
      protocol: TCP
      name: postgres
  selector:
    app: postgres
```

**Step 3: Create PostgreSQL StatefulSet**

Create `charts/n8n-infrastructure/templates/postgres-statefulset.yaml`:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: n8n-system
  labels:
    {{- include "n8n-infrastructure.labels" . | nindent 4 }}
    app: postgres
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: {{ .Values.postgres.image }}
        ports:
        - containerPort: 5432
          name: postgres
        env:
        - name: POSTGRES_DB
          value: {{ .Values.postgres.database }}
        - name: POSTGRES_USER
          value: {{ .Values.postgres.username }}
        - name: POSTGRES_PASSWORD
          value: {{ .Values.postgres.password }}
        - name: PGDATA
          value: /var/lib/postgresql/data/pgdata
        volumeMounts:
        - name: postgres-data
          mountPath: /var/lib/postgresql/data
        resources:
          {{- toYaml .Values.postgres.resources | nindent 10 }}
        livenessProbe:
          exec:
            command:
            - /bin/sh
            - -c
            - pg_isready -U {{ .Values.postgres.username }} -d {{ .Values.postgres.database }}
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          exec:
            command:
            - /bin/sh
            - -c
            - pg_isready -U {{ .Values.postgres.username }} -d {{ .Values.postgres.database }}
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
      volumes:
      - name: postgres-data
        persistentVolumeClaim:
          claimName: postgres-data
```

**Step 4: Test Helm template rendering**

Run: `helm template test-infra ./charts/n8n-infrastructure --namespace n8n-system`

Expected: YAML output with PostgreSQL resources rendered correctly

**Step 5: Commit**

```bash
git add charts/n8n-infrastructure/templates/postgres-*.yaml
git commit -m "feat: add PostgreSQL StatefulSet with PVC and Service

- Create postgres-pvc.yaml for persistent storage
- Create postgres-service.yaml for cluster networking
- Create postgres-statefulset.yaml with health checks
- Configure resource limits and liveness/readiness probes

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Redis Deployment

**Files:**
- Create: `charts/n8n-infrastructure/templates/redis-deployment.yaml`
- Create: `charts/n8n-infrastructure/templates/redis-service.yaml`
- Create: `charts/n8n-infrastructure/templates/redis-pvc.yaml`

**Step 1: Create Redis PVC**

Create `charts/n8n-infrastructure/templates/redis-pvc.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: redis-data
  namespace: n8n-system
  labels:
    {{- include "n8n-infrastructure.labels" . | nindent 4 }}
    app: redis
spec:
  accessModes:
    - ReadWriteOnce
  {{- if .Values.redis.storage.storageClass }}
  storageClassName: {{ .Values.redis.storage.storageClass }}
  {{- end }}
  resources:
    requests:
      storage: {{ .Values.redis.storage.size }}
```

**Step 2: Create Redis Service**

Create `charts/n8n-infrastructure/templates/redis-service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: n8n-system
  labels:
    {{- include "n8n-infrastructure.labels" . | nindent 4 }}
    app: redis
spec:
  type: ClusterIP
  ports:
    - port: 6379
      targetPort: 6379
      protocol: TCP
      name: redis
  selector:
    app: redis
```

**Step 3: Create Redis Deployment**

Create `charts/n8n-infrastructure/templates/redis-deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: n8n-system
  labels:
    {{- include "n8n-infrastructure.labels" . | nindent 4 }}
    app: redis
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: {{ .Values.redis.image }}
        ports:
        - containerPort: 6379
          name: redis
        volumeMounts:
        - name: redis-data
          mountPath: /data
        resources:
          {{- toYaml .Values.redis.resources | nindent 10 }}
        livenessProbe:
          exec:
            command:
            - redis-cli
            - ping
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          exec:
            command:
            - redis-cli
            - ping
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
      volumes:
      - name: redis-data
        persistentVolumeClaim:
          claimName: redis-data
```

**Step 4: Test Helm template rendering**

Run: `helm template test-infra ./charts/n8n-infrastructure --namespace n8n-system | grep -A 5 "kind: Deployment"`

Expected: Redis Deployment YAML rendered correctly

**Step 5: Commit**

```bash
git add charts/n8n-infrastructure/templates/redis-*.yaml
git commit -m "feat: add Redis deployment with PVC and Service

- Create redis-pvc.yaml for persistent data
- Create redis-service.yaml for cluster networking
- Create redis-deployment.yaml with health checks
- Configure resource limits and probes

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create Backup CronJob and PVC

**Files:**
- Create: `charts/n8n-infrastructure/templates/backup-pvc.yaml`
- Create: `charts/n8n-infrastructure/templates/backup-cronjob.yaml`

**Step 1: Create Backup PVC**

Create `charts/n8n-infrastructure/templates/backup-pvc.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: backup-storage
  namespace: n8n-system
  labels:
    {{- include "n8n-infrastructure.labels" . | nindent 4 }}
    app: backup
spec:
  accessModes:
    - ReadWriteOnce
  {{- if .Values.backup.storage.storageClass }}
  storageClassName: {{ .Values.backup.storage.storageClass }}
  {{- end }}
  resources:
    requests:
      storage: {{ .Values.backup.storage.size }}
```

**Step 2: Create Backup CronJob**

Create `charts/n8n-infrastructure/templates/backup-cronjob.yaml`:

```yaml
{{- if .Values.backup.enabled }}
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup-cleanup
  namespace: n8n-system
  labels:
    {{- include "n8n-infrastructure.labels" . | nindent 4 }}
    app: backup
spec:
  schedule: "0 2 * * *"  # Run daily at 2 AM
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      template:
        metadata:
          labels:
            app: backup
        spec:
          restartPolicy: OnFailure
          containers:
          - name: backup-cleanup
            image: postgres:16
            command:
            - /bin/bash
            - -c
            - |
              # Keep only the last N backups (retention policy)
              cd /backups
              ls -t n8n-*.sql 2>/dev/null | tail -n +{{ add .Values.backup.retention 1 }} | xargs -r rm -f
              echo "Backup cleanup completed. Kept last {{ .Values.backup.retention }} backups."
            volumeMounts:
            - name: backup-storage
              mountPath: /backups
          volumes:
          - name: backup-storage
            persistentVolumeClaim:
              claimName: backup-storage
{{- end }}
```

**Step 3: Test Helm template rendering**

Run: `helm template test-infra ./charts/n8n-infrastructure --namespace n8n-system | grep -A 10 "kind: CronJob"`

Expected: CronJob YAML rendered correctly with cleanup script

**Step 4: Commit**

```bash
git add charts/n8n-infrastructure/templates/backup-*.yaml
git commit -m "feat: add backup storage and cleanup CronJob

- Create backup-pvc.yaml for storing database snapshots
- Create backup-cronjob.yaml to cleanup old backups daily
- Implement retention policy (keep last 10 backups by default)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Create n8n Instance Helm Chart Foundation

**Files:**
- Create: `charts/n8n-instance/Chart.yaml`
- Create: `charts/n8n-instance/values.yaml`
- Create: `charts/n8n-instance/templates/_helpers.tpl`

**Step 1: Create Chart.yaml**

```bash
mkdir -p charts/n8n-instance/templates
```

Create `charts/n8n-instance/Chart.yaml`:

```yaml
apiVersion: v2
name: n8n-instance
description: n8n instance with configurable queue mode and version
type: application
version: 0.1.0
appVersion: "1.0"
maintainers:
  - name: n8n-team
```

**Step 2: Create values.yaml**

Create `charts/n8n-instance/values.yaml`:

```yaml
# n8n version configuration
n8nVersion: "latest"

# Deployment mode
queueMode: true  # true = queue mode, false = regular mode

# Database configuration
isolatedDB: false  # true = dedicated DB, false = shared DB

database:
  # Used when isolatedDB=false (shared database)
  shared:
    host: postgres.n8n-system.svc.cluster.local
    port: 5432
    database: n8n
    username: admin
    password: changeme123  # Should match infrastructure chart

  # Used when isolatedDB=true (isolated database)
  isolated:
    image: postgres:16
    storage:
      size: 10Gi
    resources:
      requests:
        cpu: 250m
        memory: 512Mi
      limits:
        cpu: 1000m
        memory: 2Gi

# Redis configuration (only used in queue mode)
redis:
  host: redis.n8n-system.svc.cluster.local
  port: 6379

# Replica configuration
replicas:
  workers: 2  # Number of worker pods (queue mode only)

# Service configuration
service:
  type: NodePort
  port: 5678
  nodePort: null  # Auto-calculated if null

# Resource limits
resources:
  main:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 2Gi
  worker:
    requests:
      cpu: 250m
      memory: 512Mi
    limits:
      cpu: 1000m
      memory: 2Gi
  webhook:
    requests:
      cpu: 100m
      memory: 256Mi
    limits:
      cpu: 500m
      memory: 1Gi

# n8n configuration
n8nConfig:
  encryptionKey: "defaultEncryptionKeyChangeMe"
  timezone: "America/New_York"
  webhookUrl: ""  # Auto-generated if empty
```

**Step 3: Create Helm helpers**

Create `charts/n8n-instance/templates/_helpers.tpl`:

```yaml
{{/*
Expand the name of the chart.
*/}}
{{- define "n8n-instance.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "n8n-instance.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "n8n-instance.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "n8n-instance.labels" -}}
helm.sh/chart: {{ include "n8n-instance.chart" . }}
{{ include "n8n-instance.selectorLabels" . }}
app: n8n
version: {{ .Values.n8nVersion | quote }}
mode: {{ ternary "queue" "regular" .Values.queueMode }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "n8n-instance.selectorLabels" -}}
app.kubernetes.io/name: {{ include "n8n-instance.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Calculate NodePort from version string
Converts version like "1.123" to port 30123
*/}}
{{- define "n8n-instance.nodePort" -}}
{{- if .Values.service.nodePort }}
{{- .Values.service.nodePort }}
{{- else }}
{{- $version := .Values.n8nVersion | toString }}
{{- $parts := split "." $version }}
{{- $major := index $parts 0 | int }}
{{- $minor := index $parts 1 | default "0" | int }}
{{- add 30000 (add (mul $major 100) $minor) }}
{{- end }}
{{- end }}

{{/*
Database host
*/}}
{{- define "n8n-instance.dbHost" -}}
{{- if .Values.isolatedDB }}
postgres-{{ .Release.Name }}.{{ .Release.Namespace }}.svc.cluster.local
{{- else }}
{{- .Values.database.shared.host }}
{{- end }}
{{- end }}

{{/*
Database credentials
*/}}
{{- define "n8n-instance.dbUsername" -}}
{{- if .Values.isolatedDB }}
admin
{{- else }}
{{- .Values.database.shared.username }}
{{- end }}
{{- end }}

{{- define "n8n-instance.dbPassword" -}}
{{- if .Values.isolatedDB }}
changeme123
{{- else }}
{{- .Values.database.shared.password }}
{{- end }}
{{- end }}

{{- define "n8n-instance.dbDatabase" -}}
{{- if .Values.isolatedDB }}
n8n
{{- else }}
{{- .Values.database.shared.database }}
{{- end }}
{{- end }}
```

**Step 4: Verify chart structure**

Run: `tree charts/n8n-instance`

Expected output:
```
charts/n8n-instance
├── Chart.yaml
├── templates
│   └── _helpers.tpl
└── values.yaml
```

**Step 5: Commit**

```bash
git add charts/n8n-instance/
git commit -m "feat: create n8n-instance Helm chart foundation

- Add Chart.yaml with metadata
- Add values.yaml with queue mode, version, and DB config
- Add Helm helpers with auto-calculated NodePort
- Support both shared and isolated database modes

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Create n8n ConfigMap

**Files:**
- Create: `charts/n8n-instance/templates/configmap.yaml`

**Step 1: Create ConfigMap template**

Create `charts/n8n-instance/templates/configmap.yaml`:

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: n8n-config
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "n8n-instance.labels" . | nindent 4 }}
data:
  # Database configuration
  DB_TYPE: "postgresdb"
  DB_POSTGRESDB_HOST: {{ include "n8n-instance.dbHost" . | quote }}
  DB_POSTGRESDB_PORT: {{ .Values.database.shared.port | quote }}
  DB_POSTGRESDB_DATABASE: {{ include "n8n-instance.dbDatabase" . | quote }}
  DB_POSTGRESDB_USER: {{ include "n8n-instance.dbUsername" . | quote }}
  DB_POSTGRESDB_PASSWORD: {{ include "n8n-instance.dbPassword" . | quote }}

  {{- if .Values.queueMode }}
  # Queue mode configuration
  EXECUTIONS_MODE: "queue"
  QUEUE_BULL_REDIS_HOST: {{ .Values.redis.host | quote }}
  QUEUE_BULL_REDIS_PORT: {{ .Values.redis.port | quote }}
  QUEUE_HEALTH_CHECK_ACTIVE: "true"
  {{- else }}
  # Regular mode configuration
  EXECUTIONS_MODE: "regular"
  {{- end }}

  # n8n configuration
  N8N_ENCRYPTION_KEY: {{ .Values.n8nConfig.encryptionKey | quote }}
  GENERIC_TIMEZONE: {{ .Values.n8nConfig.timezone | quote }}
  TZ: {{ .Values.n8nConfig.timezone | quote }}

  {{- if .Values.n8nConfig.webhookUrl }}
  WEBHOOK_URL: {{ .Values.n8nConfig.webhookUrl | quote }}
  {{- else }}
  WEBHOOK_URL: {{ printf "http://localhost:%d" (include "n8n-instance.nodePort" . | int) | quote }}
  {{- end }}

  # Diagnostics
  N8N_DIAGNOSTICS_ENABLED: "false"
```

**Step 2: Test ConfigMap rendering**

Run: `helm template test-n8n ./charts/n8n-instance --namespace n8n-v1-123 --set n8nVersion=1.123,queueMode=true | grep -A 20 "kind: ConfigMap"`

Expected: ConfigMap with queue mode variables rendered

Run: `helm template test-n8n ./charts/n8n-instance --namespace n8n-v1-123 --set n8nVersion=1.123,queueMode=false | grep "EXECUTIONS_MODE"`

Expected: ConfigMap with regular mode

**Step 3: Commit**

```bash
git add charts/n8n-instance/templates/configmap.yaml
git commit -m "feat: add n8n ConfigMap with conditional queue mode

- Create configmap.yaml with database and n8n settings
- Conditional rendering based on queueMode flag
- Auto-generate webhook URL from NodePort
- Support both shared and isolated database config

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Create n8n Main Process (StatefulSet/Deployment)

**Files:**
- Create: `charts/n8n-instance/templates/main-statefulset.yaml`
- Create: `charts/n8n-instance/templates/main-service.yaml`
- Create: `charts/n8n-instance/templates/main-pvc.yaml`

**Step 1: Create n8n data PVC**

Create `charts/n8n-instance/templates/main-pvc.yaml`:

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: n8n-data
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "n8n-instance.labels" . | nindent 4 }}
    component: main
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 5Gi
```

**Step 2: Create n8n Main Service**

Create `charts/n8n-instance/templates/main-service.yaml`:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: n8n-main
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "n8n-instance.labels" . | nindent 4 }}
    component: main
spec:
  type: {{ .Values.service.type }}
  ports:
    - port: {{ .Values.service.port }}
      targetPort: 5678
      protocol: TCP
      name: http
      {{- if eq .Values.service.type "NodePort" }}
      nodePort: {{ include "n8n-instance.nodePort" . }}
      {{- end }}
  selector:
    {{- include "n8n-instance.selectorLabels" . | nindent 4 }}
    component: main
```

**Step 3: Create n8n Main StatefulSet**

Create `charts/n8n-instance/templates/main-statefulset.yaml`:

```yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: n8n-main
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "n8n-instance.labels" . | nindent 4 }}
    component: main
spec:
  serviceName: n8n-main
  replicas: 1
  selector:
    matchLabels:
      {{- include "n8n-instance.selectorLabels" . | nindent 6 }}
      component: main
  template:
    metadata:
      labels:
        {{- include "n8n-instance.selectorLabels" . | nindent 8 }}
        component: main
        app: n8n
        version: {{ .Values.n8nVersion | quote }}
        mode: {{ ternary "queue" "regular" .Values.queueMode }}
    spec:
      containers:
      - name: n8n
        image: docker.n8n.io/n8nio/n8n:{{ .Values.n8nVersion }}
        ports:
        - containerPort: 5678
          name: http
        envFrom:
        - configMapRef:
            name: n8n-config
        volumeMounts:
        - name: n8n-data
          mountPath: /home/node/.n8n
        resources:
          {{- toYaml .Values.resources.main | nindent 10 }}
        livenessProbe:
          httpGet:
            path: /healthz
            port: 5678
          initialDelaySeconds: 60
          periodSeconds: 30
          timeoutSeconds: 10
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /healthz
            port: 5678
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
      volumes:
      - name: n8n-data
        persistentVolumeClaim:
          claimName: n8n-data
```

**Step 4: Test Main process rendering**

Run: `helm template test-n8n ./charts/n8n-instance --namespace n8n-v1-123 --set n8nVersion=1.123 | grep -A 30 "kind: StatefulSet"`

Expected: StatefulSet with correct image tag and health checks

**Step 5: Commit**

```bash
git add charts/n8n-instance/templates/main-*.yaml
git commit -m "feat: add n8n main process StatefulSet

- Create main-pvc.yaml for n8n data persistence
- Create main-service.yaml with NodePort support
- Create main-statefulset.yaml with health checks
- Configure resource limits and probes

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Create Worker and Webhook Deployments (Queue Mode)

**Files:**
- Create: `charts/n8n-instance/templates/worker-deployment.yaml`
- Create: `charts/n8n-instance/templates/webhook-deployment.yaml`

**Step 1: Create Worker Deployment**

Create `charts/n8n-instance/templates/worker-deployment.yaml`:

```yaml
{{- if .Values.queueMode }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: n8n-worker
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "n8n-instance.labels" . | nindent 4 }}
    component: worker
spec:
  replicas: {{ .Values.replicas.workers }}
  selector:
    matchLabels:
      {{- include "n8n-instance.selectorLabels" . | nindent 6 }}
      component: worker
  template:
    metadata:
      labels:
        {{- include "n8n-instance.selectorLabels" . | nindent 8 }}
        component: worker
        app: n8n
        version: {{ .Values.n8nVersion | quote }}
        mode: "queue"
    spec:
      containers:
      - name: n8n-worker
        image: docker.n8n.io/n8nio/n8n:{{ .Values.n8nVersion }}
        command:
        - n8n
        - worker
        envFrom:
        - configMapRef:
            name: n8n-config
        volumeMounts:
        - name: n8n-data
          mountPath: /home/node/.n8n
        resources:
          {{- toYaml .Values.resources.worker | nindent 10 }}
        livenessProbe:
          exec:
            command:
            - /bin/sh
            - -c
            - "pgrep -f 'n8n worker' > /dev/null"
          initialDelaySeconds: 30
          periodSeconds: 30
          timeoutSeconds: 5
          failureThreshold: 3
      volumes:
      - name: n8n-data
        persistentVolumeClaim:
          claimName: n8n-data
{{- end }}
```

**Step 2: Create Webhook Deployment**

Create `charts/n8n-instance/templates/webhook-deployment.yaml`:

```yaml
{{- if .Values.queueMode }}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: n8n-webhook
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "n8n-instance.labels" . | nindent 4 }}
    component: webhook
spec:
  replicas: 1
  selector:
    matchLabels:
      {{- include "n8n-instance.selectorLabels" . | nindent 6 }}
      component: webhook
  template:
    metadata:
      labels:
        {{- include "n8n-instance.selectorLabels" . | nindent 8 }}
        component: webhook
        app: n8n
        version: {{ .Values.n8nVersion | quote }}
        mode: "queue"
    spec:
      containers:
      - name: n8n-webhook
        image: docker.n8n.io/n8nio/n8n:{{ .Values.n8nVersion }}
        command:
        - n8n
        - webhook
        ports:
        - containerPort: 5678
          name: http
        envFrom:
        - configMapRef:
            name: n8n-config
        volumeMounts:
        - name: n8n-data
          mountPath: /home/node/.n8n
        resources:
          {{- toYaml .Values.resources.webhook | nindent 10 }}
        livenessProbe:
          httpGet:
            path: /healthz
            port: 5678
          initialDelaySeconds: 30
          periodSeconds: 30
          timeoutSeconds: 5
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /healthz
            port: 5678
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 3
          failureThreshold: 3
      volumes:
      - name: n8n-data
        persistentVolumeClaim:
          claimName: n8n-data
{{- end }}
```

**Step 3: Test queue mode rendering**

Run: `helm template test-n8n ./charts/n8n-instance --namespace n8n-v1-123 --set n8nVersion=1.123,queueMode=true | grep -E "kind: Deployment"`

Expected: Two Deployments (worker and webhook)

Run: `helm template test-n8n ./charts/n8n-instance --namespace n8n-v1-123 --set n8nVersion=1.123,queueMode=false | grep -E "kind: Deployment"`

Expected: No Deployments (empty output)

**Step 4: Commit**

```bash
git add charts/n8n-instance/templates/worker-deployment.yaml charts/n8n-instance/templates/webhook-deployment.yaml
git commit -m "feat: add worker and webhook deployments for queue mode

- Create worker-deployment.yaml with configurable replicas
- Create webhook-deployment.yaml for webhook handling
- Both conditionally rendered when queueMode=true
- Share n8n-data PVC with main process

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Create Pre-Install Snapshot Hook

**Files:**
- Create: `charts/n8n-instance/templates/pre-install-snapshot-job.yaml`

**Step 1: Create snapshot hook Job**

Create `charts/n8n-instance/templates/pre-install-snapshot-job.yaml`:

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ .Release.Name }}-pre-install-snapshot
  namespace: {{ .Release.Namespace }}
  labels:
    {{- include "n8n-instance.labels" . | nindent 4 }}
    component: backup
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-5"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  ttlSecondsAfterFinished: 300
  template:
    metadata:
      labels:
        {{- include "n8n-instance.selectorLabels" . | nindent 8 }}
        component: backup
    spec:
      restartPolicy: OnFailure
      containers:
      - name: snapshot
        image: postgres:16
        command:
        - /bin/bash
        - -c
        - |
          set -e

          # Create timestamp
          TIMESTAMP=$(date +%Y%m%d-%H%M%S)
          VERSION={{ .Values.n8nVersion }}
          BACKUP_FILE="/backups/n8n-${TIMESTAMP}-pre-v${VERSION}.sql"

          echo "Creating database snapshot before deploying version ${VERSION}..."

          # Wait for postgres to be ready
          until pg_isready -h {{ include "n8n-instance.dbHost" . }} -U {{ include "n8n-instance.dbUsername" . }}; do
            echo "Waiting for PostgreSQL..."
            sleep 2
          done

          # Create backup
          PGPASSWORD={{ include "n8n-instance.dbPassword" . }} pg_dump \
            -h {{ include "n8n-instance.dbHost" . }} \
            -U {{ include "n8n-instance.dbUsername" . }} \
            -d {{ include "n8n-instance.dbDatabase" . }} \
            > "${BACKUP_FILE}"

          if [ -f "${BACKUP_FILE}" ]; then
            SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
            echo "Snapshot created successfully: ${BACKUP_FILE} (${SIZE})"
          else
            echo "ERROR: Snapshot creation failed"
            exit 1
          fi
        volumeMounts:
        - name: backup-storage
          mountPath: /backups
      volumes:
      - name: backup-storage
        persistentVolumeClaim:
          claimName: backup-storage
```

**Step 2: Test hook rendering**

Run: `helm template test-n8n ./charts/n8n-instance --namespace n8n-v1-123 --set n8nVersion=1.123 | grep -A 5 "helm.sh/hook"`

Expected: Job with pre-install and pre-upgrade hooks

**Step 3: Commit**

```bash
git add charts/n8n-instance/templates/pre-install-snapshot-job.yaml
git commit -m "feat: add pre-install snapshot hook for database backups

- Create pre-install-snapshot-job.yaml as Helm hook
- Runs before every install/upgrade to create DB snapshot
- Timestamped backup files in /backups volume
- Automatic cleanup after 5 minutes (TTL)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Test Infrastructure Chart Deployment

**Files:**
- None (deployment testing)

**Step 1: Verify Kubernetes cluster is running**

Run: `kubectl cluster-info`

Expected: Cluster information displayed

Run: `kubectl config use-context docker-desktop`

Expected: Context switched to docker-desktop

**Step 2: Create n8n-system namespace**

Run: `kubectl create namespace n8n-system`

Expected: `namespace/n8n-system created`

**Step 3: Install infrastructure chart**

Run: `helm install n8n-infra ./charts/n8n-infrastructure --namespace n8n-system`

Expected: Release installed successfully

**Step 4: Wait for pods to be ready**

Run: `kubectl wait --for=condition=ready pod -l app=postgres -n n8n-system --timeout=300s`

Expected: `pod/postgres-0 condition met`

Run: `kubectl wait --for=condition=ready pod -l app=redis -n n8n-system --timeout=300s`

Expected: `pod/redis-... condition met`

**Step 5: Verify all resources created**

Run: `kubectl get all -n n8n-system`

Expected output showing:
- StatefulSet: postgres-0 (1/1 Ready)
- Deployment: redis (1/1 Ready)
- Services: postgres, redis
- PVCs: postgres-data, redis-data, backup-storage

**Step 6: Test PostgreSQL connectivity**

Run: `kubectl exec -it postgres-0 -n n8n-system -- psql -U admin -d n8n -c "SELECT version();"`

Expected: PostgreSQL version displayed

**Step 7: Test Redis connectivity**

Run: `kubectl exec -it $(kubectl get pod -l app=redis -n n8n-system -o jsonpath='{.items[0].metadata.name}') -n n8n-system -- redis-cli ping`

Expected: `PONG`

**Step 8: Commit verification notes**

```bash
git add -A
git commit --allow-empty -m "test: verify infrastructure chart deployment

- Created n8n-system namespace
- Deployed PostgreSQL, Redis, and backup storage
- All pods running and healthy
- Database and Redis connectivity verified

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Test n8n Instance Deployment (Queue Mode)

**Files:**
- None (deployment testing)

**Step 1: Deploy n8n v1.123 in queue mode**

Run: `helm install n8n-v1-123 ./charts/n8n-instance --set n8nVersion=1.123,queueMode=true,replicas.workers=2 --namespace n8n-v1-123 --create-namespace`

Expected: Release installed, pre-install snapshot job runs

**Step 2: Check snapshot job completion**

Run: `kubectl logs job/n8n-v1-123-pre-install-snapshot -n n8n-v1-123`

Expected: Log showing "Snapshot created successfully"

**Step 3: Wait for n8n pods to be ready**

Run: `kubectl wait --for=condition=ready pod -l component=main -n n8n-v1-123 --timeout=300s`

Expected: Main pod ready

Run: `kubectl get pods -n n8n-v1-123`

Expected output:
- n8n-main-0 (1/1 Running)
- n8n-worker-... x2 (2/2 Running)
- n8n-webhook-... (1/1 Running)

**Step 4: Test n8n UI accessibility**

Run: `kubectl get svc -n n8n-v1-123`

Expected: n8n-main service with NodePort 30123

Test in browser: `http://localhost:30123`

Expected: n8n login/setup page loads

**Step 5: Verify queue mode configuration**

Run: `kubectl exec -it n8n-main-0 -n n8n-v1-123 -- env | grep EXECUTIONS_MODE`

Expected: `EXECUTIONS_MODE=queue`

Run: `kubectl exec -it n8n-main-0 -n n8n-v1-123 -- env | grep REDIS`

Expected: Redis host configuration present

**Step 6: Check logs for all components**

Run: `kubectl logs n8n-main-0 -n n8n-v1-123 --tail=20`

Expected: n8n started successfully

Run: `kubectl logs $(kubectl get pod -l component=worker -n n8n-v1-123 -o jsonpath='{.items[0].metadata.name}') -n n8n-v1-123 --tail=20`

Expected: Worker connected to Redis and processing jobs

**Step 7: Commit test results**

```bash
git add -A
git commit --allow-empty -m "test: verify n8n instance deployment in queue mode

- Deployed n8n v1.123 in queue mode
- Pre-install snapshot completed successfully
- All pods (main, workers, webhook) running
- n8n UI accessible at http://localhost:30123
- Queue mode configuration verified

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Test n8n Instance Deployment (Regular Mode)

**Files:**
- None (deployment testing)

**Step 1: Deploy n8n v2.1 in regular mode**

Run: `helm install n8n-v2-1 ./charts/n8n-instance --set n8nVersion=2.1,queueMode=false --namespace n8n-v2-1 --create-namespace`

Expected: Release installed, pre-install snapshot job runs

**Step 2: Check snapshot job completion**

Run: `kubectl logs job/n8n-v2-1-pre-install-snapshot -n n8n-v2-1`

Expected: Log showing "Snapshot created successfully"

**Step 3: Wait for n8n pod to be ready**

Run: `kubectl wait --for=condition=ready pod -l component=main -n n8n-v2-1 --timeout=300s`

Expected: Main pod ready

Run: `kubectl get pods -n n8n-v2-1`

Expected output:
- n8n-main-0 (1/1 Running)
- NO worker or webhook pods (regular mode)

**Step 4: Test n8n UI accessibility**

Run: `kubectl get svc -n n8n-v2-1`

Expected: n8n-main service with NodePort 30201

Test in browser: `http://localhost:30201`

Expected: n8n login/setup page loads

**Step 5: Verify regular mode configuration**

Run: `kubectl exec -it n8n-main-0 -n n8n-v2-1 -- env | grep EXECUTIONS_MODE`

Expected: `EXECUTIONS_MODE=regular`

Run: `kubectl exec -it n8n-main-0 -n n8n-v2-1 -- env | grep REDIS`

Expected: No Redis configuration (empty output or error)

**Step 6: List both versions**

Run: `kubectl get namespaces | grep n8n-v`

Expected:
- n8n-v1-123
- n8n-v2-1

Run: `kubectl get pods -A | grep n8n`

Expected: Pods from both versions listed

**Step 7: Commit test results**

```bash
git add -A
git commit --allow-empty -m "test: verify n8n instance deployment in regular mode

- Deployed n8n v2.1 in regular mode
- Pre-install snapshot completed successfully
- Only main pod running (no workers/webhook)
- n8n UI accessible at http://localhost:30201
- Regular mode configuration verified
- Both versions (1.123 and 2.1) running simultaneously

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 13: Create Helper Scripts

**Files:**
- Create: `scripts/deploy-version.sh`
- Create: `scripts/list-versions.sh`
- Create: `scripts/remove-version.sh`
- Create: `scripts/list-snapshots.sh`
- Create: `scripts/restore-snapshot.sh`

**Step 1: Create deploy-version.sh**

```bash
mkdir -p scripts
```

Create `scripts/deploy-version.sh`:

```bash
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
```

Make executable: `chmod +x scripts/deploy-version.sh`

**Step 2: Create list-versions.sh**

Create `scripts/list-versions.sh`:

```bash
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
```

Make executable: `chmod +x scripts/list-versions.sh`

**Step 3: Create remove-version.sh**

Create `scripts/remove-version.sh`:

```bash
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
```

Make executable: `chmod +x scripts/remove-version.sh`

**Step 4: Create list-snapshots.sh**

Create `scripts/list-snapshots.sh`:

```bash
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
kubectl exec -it "$BACKUP_POD" -n n8n-system -- sh -c "
  if [ -d /backups ]; then
    ls -lh /backups/*.sql 2>/dev/null | awk '{print \$9, \"-\", \$5}' || echo 'No snapshots found'
  else
    echo 'Backup directory not mounted'
  fi
"
```

Make executable: `chmod +x scripts/list-snapshots.sh`

**Step 5: Create restore-snapshot.sh**

Create `scripts/restore-snapshot.sh`:

```bash
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
```

Make executable: `chmod +x scripts/restore-snapshot.sh`

**Step 6: Test helper scripts**

Run: `./scripts/list-versions.sh`

Expected: List of currently deployed versions

Run: `./scripts/list-snapshots.sh`

Expected: List of database snapshots

**Step 7: Commit helper scripts**

```bash
git add scripts/
git commit -m "feat: add helper scripts for version management

- deploy-version.sh: Deploy n8n version with smart defaults
- list-versions.sh: Show all deployed versions and status
- remove-version.sh: Clean up version and namespace
- list-snapshots.sh: Show available database snapshots
- restore-snapshot.sh: Restore database from snapshot

All scripts are executable and include usage examples.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 14: Create README and Quick Start Guide

**Files:**
- Create: `README.md`

**Step 1: Create README.md**

Create `README.md`:

```markdown
# n8n Kubernetes Version Switching

Quickly test different n8n versions on Kubernetes with queue mode support and automatic database snapshots.

## Features

- 🚀 Deploy any n8n version in under 2 minutes
- 🔄 Toggle between queue mode and regular mode
- 💾 Automatic database snapshots before version switches
- 🔒 Optional isolated databases for risky tests
- 🧹 Clean namespace-based isolation
- 📊 Run 1-2 versions simultaneously

## Prerequisites

- Docker Desktop with Kubernetes enabled
- Helm 3 installed
- kubectl configured for docker-desktop context

## Quick Start

### 1. Deploy Infrastructure (One-time)

```bash
# Create system namespace
kubectl create namespace n8n-system

# Install shared infrastructure (PostgreSQL, Redis, Backups)
helm install n8n-infra ./charts/n8n-infrastructure --namespace n8n-system

# Wait for infrastructure to be ready
kubectl wait --for=condition=ready pod -l app=postgres -n n8n-system --timeout=300s
kubectl wait --for=condition=ready pod -l app=redis -n n8n-system --timeout=300s
```

### 2. Deploy Your First n8n Version

```bash
# Deploy n8n v1.123 in queue mode
./scripts/deploy-version.sh 1.123 --queue

# Wait for pods to be ready
kubectl wait --for=condition=ready pod -l component=main -n n8n-v1-123 --timeout=300s

# Access n8n UI
open http://localhost:30123
```

### 3. Deploy Another Version

```bash
# Deploy n8n v2.1 in regular mode (no queue)
./scripts/deploy-version.sh 2.1 --regular

# Access at different port
open http://localhost:30201
```

### 4. List Running Versions

```bash
./scripts/list-versions.sh
```

Output:
```
=== n8n Versions Deployed ===

Namespace: n8n-v1-123
  Version: 1.123
  Mode: Queue
  Pods:
    n8n-main-0 - Running
    n8n-worker-abc123 - Running
    n8n-worker-def456 - Running
    n8n-webhook-ghi789 - Running
  Access: http://localhost:30123

Namespace: n8n-v2-1
  Version: 2.1
  Mode: Regular
  Pods:
    n8n-main-0 - Running
  Access: http://localhost:30201
```

## Usage

### Deploy a Version

```bash
# Queue mode (default)
./scripts/deploy-version.sh 1.123 --queue

# Regular mode
./scripts/deploy-version.sh 2.1 --regular

# With isolated database
./scripts/deploy-version.sh 2.1 --queue --isolated-db
```

### List Versions

```bash
./scripts/list-versions.sh
```

### Remove a Version

```bash
./scripts/remove-version.sh 1.123
```

### Manage Database Snapshots

```bash
# List available snapshots
./scripts/list-snapshots.sh

# Restore from snapshot
./scripts/restore-snapshot.sh n8n-20260119-120000-pre-v1.123.sql
```

## Architecture

### Infrastructure (n8n-system namespace)
- **PostgreSQL**: Shared database for all versions
- **Redis**: Message queue for queue mode
- **Backup Storage**: PVC for database snapshots

### n8n Instances (per-version namespaces)
- **Queue Mode**: Main process + Workers + Webhook process
- **Regular Mode**: Single main process

## Port Allocation

Ports are auto-calculated from version numbers:
- v1.123 → Port 30123
- v2.1 → Port 30201
- vX.Y → Port 30000 + (X * 100) + Y

## Database Management

### Shared Database (Default)
All versions connect to the same PostgreSQL instance. Test how different versions handle the same data.

### Isolated Database
Deploy with `--isolated-db` to create a dedicated database for risky tests.

### Automatic Snapshots
Before every version deployment, a snapshot is automatically created:
- Format: `n8n-YYYYMMDD-HHMMSS-pre-vX.Y.sql`
- Location: `/backups` volume in n8n-system namespace
- Retention: Last 10 snapshots (configurable)

## Troubleshooting

### Check Pod Status
```bash
kubectl get pods -n n8n-v1-123
```

### View Logs
```bash
# Main process
kubectl logs -f n8n-main-0 -n n8n-v1-123

# Worker process
kubectl logs -f <worker-pod-name> -n n8n-v1-123
```

### Database Connection Issues
```bash
# Test PostgreSQL connectivity
kubectl exec -it postgres-0 -n n8n-system -- psql -U admin -d n8n -c "SELECT version();"

# Check n8n database config
kubectl exec -it n8n-main-0 -n n8n-v1-123 -- env | grep DB_
```

### Redis Connection Issues (Queue Mode)
```bash
# Test Redis connectivity
kubectl exec -it <redis-pod-name> -n n8n-system -- redis-cli ping

# Check n8n Redis config
kubectl exec -it n8n-main-0 -n n8n-v1-123 -- env | grep REDIS
```

## Configuration

### Infrastructure Values
Edit `charts/n8n-infrastructure/values.yaml`:
- PostgreSQL storage size, resources
- Redis storage size, resources
- Backup retention policy

### Instance Values
Edit `charts/n8n-instance/values.yaml`:
- Default n8n version
- Queue mode settings
- Worker replica count
- Resource limits

## Cleanup

### Remove a Single Version
```bash
./scripts/remove-version.sh 1.123
```

### Remove Everything
```bash
# Remove all n8n versions
kubectl delete namespace -l app=n8n

# Remove infrastructure
helm uninstall n8n-infra --namespace n8n-system
kubectl delete namespace n8n-system
```

## Contributing

This project was designed for quick n8n version testing and learning Kubernetes. Feel free to extend it with:
- Web UI for version management
- Automated testing after deployment
- Metrics and monitoring
- Ingress support for host-based routing

## License

MIT
```

**Step 2: Commit README**

```bash
git add README.md
git commit -m "docs: add comprehensive README and quick start guide

- Getting started instructions
- Usage examples for all helper scripts
- Architecture overview
- Troubleshooting section
- Port allocation explanation
- Database management guide

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Task 15: Final Integration Test

**Files:**
- None (integration testing)

**Step 1: Clean up existing deployments**

Run: `./scripts/remove-version.sh 1.123`

Expected: Version 1.123 removed

Run: `./scripts/remove-version.sh 2.1`

Expected: Version 2.1 removed

**Step 2: Deploy fresh version with helper script**

Run: `./scripts/deploy-version.sh 1.85.0 --queue`

Expected: Deployment successful, snapshot created

**Step 3: Verify snapshot was created**

Run: `./scripts/list-snapshots.sh`

Expected: New snapshot file listed with "pre-v1.85.0"

**Step 4: Wait and verify deployment**

Run: `kubectl wait --for=condition=ready pod -l component=main -n n8n-v1-85-0 --timeout=300s`

Expected: Pod ready

Run: `./scripts/list-versions.sh`

Expected: Version 1.85.0 in queue mode listed

**Step 5: Access n8n UI**

Test in browser: `http://localhost:30185`

Expected: n8n setup page loads successfully

**Step 6: Deploy second version**

Run: `./scripts/deploy-version.sh 1.86.0 --regular`

Expected: New snapshot created, deployment successful

**Step 7: Verify both versions running**

Run: `./scripts/list-versions.sh`

Expected: Both 1.85.0 (queue) and 1.86.0 (regular) listed

Test both UIs:
- http://localhost:30185 (v1.85.0)
- http://localhost:30186 (v1.86.0)

**Step 8: Test snapshot restoration (optional)**

Run: `./scripts/list-snapshots.sh`

Note the latest snapshot name

Run: `./scripts/restore-snapshot.sh <snapshot-name>`

Expected: Restoration prompts for confirmation, completes successfully

**Step 9: Document test results**

```bash
git add -A
git commit --allow-empty -m "test: complete end-to-end integration test

- Deployed two n8n versions using helper scripts
- Verified automatic snapshots before each deployment
- Confirmed queue mode and regular mode work correctly
- Tested snapshot restoration process
- Both UIs accessible on calculated ports
- All helper scripts functioning as expected

System ready for production use!

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```

---

## Success Criteria Verification

- ✅ Can deploy any n8n version in under 2 minutes
- ✅ Can toggle queue mode vs regular mode per version
- ✅ Database automatically backed up before version switches
- ✅ Can run 1-2 versions simultaneously
- ✅ Can restore from snapshots if upgrade goes wrong
- ✅ Team members can independently test different versions
- ✅ Clean removal of versions (no leftover resources)

## Next Steps

After completing this implementation plan:

1. **Share with team**: Distribute README.md and train team on helper scripts
2. **Monitor usage**: Collect feedback on pain points and missing features
3. **Phase 2 Enhancements**:
   - Add metrics/monitoring (Prometheus + Grafana)
   - Implement automated testing after deployment
   - Build web UI for non-technical users
4. **Production hardening**:
   - Secure database credentials with Kubernetes Secrets
   - Add RBAC policies
   - Implement backup compression
   - Add resource quotas per namespace

## Estimated Timeline

- **Tasks 1-4**: Infrastructure chart (1-2 hours)
- **Tasks 5-9**: n8n instance chart (2-3 hours)
- **Tasks 10-12**: Testing deployments (1-2 hours)
- **Tasks 13-14**: Helper scripts and docs (1 hour)
- **Task 15**: Integration testing (30 minutes)

**Total**: 5.5-8.5 hours for complete implementation
