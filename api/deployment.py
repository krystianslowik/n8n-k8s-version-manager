"""
Deployment operations using kubernetes-asyncio and Helm.
Replaces deploy-version.sh shell script logic.
"""
import asyncio
import logging
import os
import tempfile
from typing import Dict, Any, Optional, AsyncIterator

import yaml
from kubernetes_asyncio import client

import k8s

logger = logging.getLogger(__name__)

# Resource requirements
REGULAR_MODE_MEMORY_MI = 512  # n8n main
QUEUE_MODE_MEMORY_MI = 1280   # main + workers + webhook
DB_MEMORY_MI = 256            # PostgreSQL


def calculate_port(version: str) -> int:
    """
    Calculate NodePort from version string.
    Formula: 30000 + (major * 1000) + (minor * 10) + patch
    Handles pre-release versions like 1.76.8-exp.
    """
    if version == 'unknown':
        return 0
    try:
        parts = version.split('.')
        major = int(parts[0])
        minor = int(parts[1])
        patch_str = parts[2].split('-')[0]  # Strip pre-release suffix
        patch = int(patch_str)
        return 30000 + (major * 1000) + (minor * 10) + patch
    except (ValueError, IndexError):
        return 0


def version_to_namespace(version: str) -> str:
    """Convert version string to Kubernetes namespace name."""
    return f"n8n-v{version.replace('.', '-')}"


async def check_cluster_capacity(is_queue_mode: bool) -> Dict[str, Any]:
    """
    Check if cluster has enough memory for deployment.
    Returns dict with 'can_deploy', 'available_mi', 'required_mi'.
    """
    api = await k8s.get_client()
    v1 = client.CoreV1Api(api)

    # Get node allocatable memory
    nodes = await v1.list_node()
    if not nodes.items:
        return {"can_deploy": False, "error": "No nodes found"}

    # Sum allocatable memory across all nodes
    total_allocatable_mi = 0
    for node in nodes.items:
        mem_str = node.status.allocatable.get("memory", "0")
        if mem_str.endswith("Ki"):
            total_allocatable_mi += int(mem_str[:-2]) // 1024
        elif mem_str.endswith("Mi"):
            total_allocatable_mi += int(mem_str[:-2])
        elif mem_str.endswith("Gi"):
            total_allocatable_mi += int(mem_str[:-2]) * 1024

    # Get current memory usage from running pods
    pods = await v1.list_pod_for_all_namespaces()
    used_mi = 0
    for pod in pods.items:
        if pod.status.phase not in ["Running", "Pending"]:
            continue
        for container in pod.spec.containers:
            mem_req = container.resources.requests.get("memory", "0") if container.resources and container.resources.requests else "0"
            if mem_req.endswith("Mi"):
                used_mi += int(mem_req[:-2])
            elif mem_req.endswith("Gi"):
                used_mi += int(mem_req[:-2]) * 1024

    available_mi = total_allocatable_mi - used_mi
    required_mi = (QUEUE_MODE_MEMORY_MI if is_queue_mode else REGULAR_MODE_MEMORY_MI) + DB_MEMORY_MI

    return {
        "can_deploy": available_mi >= required_mi,
        "available_mi": available_mi,
        "required_mi": required_mi,
        "total_mi": total_allocatable_mi,
        "used_mi": used_mi,
    }


async def namespace_exists(namespace: str) -> bool:
    """Check if namespace exists."""
    api = await k8s.get_client()
    v1 = client.CoreV1Api(api)
    try:
        await v1.read_namespace(namespace)
        return True
    except client.ApiException as e:
        if e.status == 404:
            return False
        raise


async def create_namespace(namespace: str) -> None:
    """Create a Kubernetes namespace."""
    api = await k8s.get_client()
    v1 = client.CoreV1Api(api)

    ns = client.V1Namespace(
        metadata=client.V1ObjectMeta(
            name=namespace,
            labels={"app.kubernetes.io/managed-by": "n8n-manager"}
        )
    )
    await v1.create_namespace(ns)
    logger.info(f"Created namespace {namespace}")


async def delete_namespace(namespace: str) -> None:
    """Delete a Kubernetes namespace."""
    api = await k8s.get_client()
    v1 = client.CoreV1Api(api)

    await v1.delete_namespace(namespace)
    logger.info(f"Deleted namespace {namespace}")


async def helm_install(
    release_name: str,
    namespace: str,
    chart_path: str,
    values: Dict[str, Any],
) -> AsyncIterator[str]:
    """
    Install Helm chart and yield progress messages.
    Uses subprocess since there's no good async Helm SDK.
    """
    # Write values to temp file
    with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
        yaml.dump(values, f)
        values_file = f.name

    try:
        cmd = [
            "helm", "install", release_name, chart_path,
            "--namespace", namespace,
            "--create-namespace",
            "--values", values_file,
            "--wait",
            "--timeout", "5m",
        ]

        yield f"Running: helm install {release_name}"

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            error_msg = stderr.decode() if stderr else "Unknown error"
            raise RuntimeError(f"Helm install failed: {error_msg}")

        yield "Helm install completed"

    finally:
        os.unlink(values_file)


async def helm_uninstall(release_name: str, namespace: str) -> None:
    """Uninstall a Helm release."""
    cmd = ["helm", "uninstall", release_name, "--namespace", namespace]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        error_msg = stderr.decode() if stderr else "Unknown error"
        raise RuntimeError(f"Helm uninstall failed: {error_msg}")

    logger.info(f"Uninstalled release {release_name} from {namespace}")


async def get_helm_release_status(release_name: str, namespace: str) -> Optional[str]:
    """Get Helm release status. Returns None if not found."""
    cmd = ["helm", "status", release_name, "--namespace", namespace, "-o", "json"]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    stdout, stderr = await proc.communicate()

    if proc.returncode != 0:
        return None

    import json
    try:
        data = json.loads(stdout.decode())
        return data.get("info", {}).get("status")
    except json.JSONDecodeError:
        return None
