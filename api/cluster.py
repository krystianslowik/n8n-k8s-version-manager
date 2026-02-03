from datetime import datetime
from fastapi import APIRouter
import k8s

router = APIRouter(prefix="/api/cluster", tags=["cluster"])

# Memory requirements (in Mi)
QUEUE_MODE_MEMORY = 1792  # main(512) + webhook(256) + 2*worker(512)
REGULAR_MODE_MEMORY = 512  # main only


@router.get("/resources")
async def get_cluster_resources():
    """Get cluster resource availability and usage."""
    try:
        # Get cluster allocatable memory
        total_memory = await k8s.get_cluster_allocatable_memory()
        if total_memory is None:
            return {
                "error": "Failed to query cluster nodes",
                "memory": None,
                "can_deploy": {"queue_mode": False, "regular_mode": False},
                "deployments": []
            }

        # Get total memory usage
        used_memory = await k8s.get_total_memory_requests()

        # Convert to Mi for API response
        allocatable_mi = total_memory // (1024 * 1024)
        used_mi = used_memory // (1024 * 1024)
        available_mi = allocatable_mi - used_mi
        utilization_percent = int((used_mi / allocatable_mi * 100) if allocatable_mi > 0 else 0)

        # Get n8n deployments
        namespaces = await k8s.list_namespaces(label_selector="app=n8n")

        deployments = []
        for ns in namespaces:
            ns_name = ns.metadata.name
            created_at = ns.metadata.creation_timestamp

            # Get pods in this namespace to calculate memory
            pods = await k8s.list_pods(namespace=ns_name)
            ns_memory = 0
            mode = "regular"

            for pod in pods:
                pod_name = pod.metadata.name
                if "worker" in pod_name or "webhook" in pod_name:
                    mode = "queue"
                if pod.spec and pod.spec.containers:
                    for container in pod.spec.containers:
                        if container.resources and container.resources.requests:
                            mem_str = container.resources.requests.get("memory", "0")
                            ns_memory += k8s.parse_k8s_memory(mem_str)

            # Calculate age
            if created_at:
                now = datetime.now(created_at.tzinfo)
                age_seconds = int((now - created_at).total_seconds())
            else:
                age_seconds = 0

            deployments.append({
                "namespace": ns_name,
                "memory_mi": ns_memory // (1024 * 1024),
                "mode": mode,
                "age_seconds": age_seconds
            })

        # Sort by age (oldest first)
        deployments.sort(key=lambda d: d['age_seconds'], reverse=True)

        return {
            "memory": {
                "allocatable_mi": allocatable_mi,
                "used_mi": used_mi,
                "available_mi": available_mi,
                "utilization_percent": utilization_percent
            },
            "can_deploy": {
                "queue_mode": available_mi >= QUEUE_MODE_MEMORY,
                "regular_mode": available_mi >= REGULAR_MODE_MEMORY
            },
            "deployments": deployments
        }

    except Exception as e:
        return {
            "error": str(e),
            "memory": None,
            "can_deploy": {"queue_mode": False, "regular_mode": False},
            "deployments": []
        }
