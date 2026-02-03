"""Deployment phase calculation logic for real-time status tracking."""

from typing import List, Dict, Any
from enum import Enum


class DeploymentPhase(str, Enum):
    """Deployment phases for granular status tracking."""
    DB_STARTING = "db-starting"
    N8N_STARTING = "n8n-starting"
    WORKERS_STARTING = "workers-starting"
    RUNNING = "running"
    FAILED = "failed"
    UNKNOWN = "unknown"


PHASE_LABELS = {
    DeploymentPhase.DB_STARTING: "DB starting",
    DeploymentPhase.N8N_STARTING: "n8n starting",
    DeploymentPhase.WORKERS_STARTING: "Workers",
    DeploymentPhase.RUNNING: "Running",
    DeploymentPhase.FAILED: "Failed",
    DeploymentPhase.UNKNOWN: "Unknown",
}


def is_pod_running(pod: Dict) -> bool:
    """Check if pod is Running with all containers ready."""
    if pod.get("phase") != "Running":
        return False
    containers = pod.get("containers", [])
    if not containers:
        return False
    return all(c.get("ready", False) for c in containers)


def is_pod_failed(pod: Dict) -> bool:
    """Check if pod is in a failed state."""
    if pod.get("phase") == "Failed":
        return True
    # Check for problematic container states
    for container in pod.get("containers", []):
        state_detail = container.get("state_detail")
        if state_detail in ["CrashLoopBackOff", "ErrImagePull", "ImagePullBackOff", "Error"]:
            return True
        if container.get("restart_count", 0) > 5:
            return True
    return False


def get_failure_reason(pod: Dict) -> str:
    """Extract failure reason from pod."""
    for container in pod.get("containers", []):
        state_detail = container.get("state_detail")
        if state_detail:
            return f"{container.get('name', 'unknown')}: {state_detail}"
    return pod.get("phase", "Unknown error")


def calculate_phase(pods: List[Dict], is_queue_mode: bool) -> Dict[str, Any]:
    """
    Calculate deployment phase from pod statuses.

    Pod naming from helm templates:
    - postgres-{namespace}-0: PostgreSQL StatefulSet
    - n8n-main-0: Main n8n StatefulSet
    - n8n-worker-*: Worker Deployment pods (queue mode)
    - n8n-webhook-*: Webhook Deployment pods (queue mode)
    """
    if not pods:
        return {
            "phase": DeploymentPhase.DB_STARTING.value,
            "label": PHASE_LABELS[DeploymentPhase.DB_STARTING],
            "message": "Waiting for pods..."
        }

    # Categorize pods by type
    postgres_pods = [p for p in pods if p.get("name", "").startswith("postgres-")]
    main_pods = [p for p in pods if p.get("name", "").startswith("n8n-main")]
    worker_pods = [p for p in pods if p.get("name", "").startswith("n8n-worker")]
    webhook_pods = [p for p in pods if p.get("name", "").startswith("n8n-webhook")]

    # All relevant pods for failure checking
    all_pods = postgres_pods + main_pods + worker_pods + webhook_pods

    # Check for failures first
    failed_pods = [p for p in all_pods if is_pod_failed(p)]
    if failed_pods:
        failed_pod = failed_pods[0]
        return {
            "phase": DeploymentPhase.FAILED.value,
            "label": PHASE_LABELS[DeploymentPhase.FAILED],
            "failed_pod": failed_pod.get("name"),
            "reason": get_failure_reason(failed_pod)
        }

    # Check postgres status
    postgres_running = any(is_pod_running(p) for p in postgres_pods)
    if not postgres_running:
        progress = _get_pod_progress(postgres_pods, "postgres")
        return {
            "phase": DeploymentPhase.DB_STARTING.value,
            "label": PHASE_LABELS[DeploymentPhase.DB_STARTING],
            "message": progress
        }

    # Check main n8n status
    main_running = any(is_pod_running(p) for p in main_pods)
    if not main_running:
        progress = _get_pod_progress(main_pods, "n8n-main")
        return {
            "phase": DeploymentPhase.N8N_STARTING.value,
            "label": PHASE_LABELS[DeploymentPhase.N8N_STARTING],
            "message": progress
        }

    # Check workers/webhook for queue mode
    if is_queue_mode:
        workers_running = worker_pods and all(is_pod_running(p) for p in worker_pods)
        webhook_running = any(is_pod_running(p) for p in webhook_pods)

        if not (workers_running and webhook_running):
            workers_ready = sum(1 for p in worker_pods if is_pod_running(p))
            workers_total = len(worker_pods)
            return {
                "phase": DeploymentPhase.WORKERS_STARTING.value,
                "label": PHASE_LABELS[DeploymentPhase.WORKERS_STARTING],
                "message": f"Workers: {workers_ready}/{workers_total}, Webhook: {'ready' if webhook_running else 'starting'}"
            }

    # All pods running
    pods_ready = len([p for p in all_pods if is_pod_running(p)])
    pods_total = len(all_pods)
    return {
        "phase": DeploymentPhase.RUNNING.value,
        "label": PHASE_LABELS[DeploymentPhase.RUNNING],
        "pods_ready": pods_ready,
        "pods_total": pods_total
    }


def _get_pod_progress(pods: List[Dict], pod_type: str) -> str:
    """Get human-readable progress message for pods."""
    if not pods:
        return f"Waiting for {pod_type} pod..."

    pod = pods[0]
    phase = pod.get("phase", "Unknown")

    if phase == "Pending":
        # Check if image is being pulled
        for container in pod.get("containers", []):
            state_detail = container.get("state_detail")
            if state_detail == "ContainerCreating":
                return "Creating container..."
            if state_detail == "PodInitializing":
                return "Initializing..."
        return "Pod pending..."

    if phase == "Running":
        containers = pod.get("containers", [])
        ready = sum(1 for c in containers if c.get("ready", False))
        total = len(containers)
        if ready < total:
            return f"Containers: {ready}/{total} ready"
        return "Starting..."

    return f"Status: {phase}"
