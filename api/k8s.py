"""
Kubernetes async client wrapper.
Provides typed, async access to K8s API without subprocess overhead.
"""
from typing import Optional, List, Dict, Any
from kubernetes_asyncio import client, config
from kubernetes_asyncio.client.api_client import ApiClient
from kubernetes_asyncio.client.exceptions import ApiException
from fastapi import HTTPException
import logging

logger = logging.getLogger(__name__)

# Global client - initialized on first use
_api_client: Optional[ApiClient] = None


async def get_client() -> ApiClient:
    """Get or create the shared API client."""
    global _api_client
    if _api_client is None:
        try:
            # Try in-cluster config first (when running in K8s)
            config.load_incluster_config()
        except config.ConfigException:
            # Fall back to kubeconfig (local development)
            await config.load_kube_config()
        _api_client = ApiClient()
    return _api_client


async def close_client():
    """Close the API client (call on shutdown)."""
    global _api_client
    if _api_client:
        await _api_client.close()
        _api_client = None


def handle_api_exception(e: ApiException, resource: str = "resource") -> None:
    """Convert K8s API exceptions to FastAPI HTTPExceptions."""
    if e.status == 404:
        raise HTTPException(status_code=404, detail=f"{resource} not found")
    elif e.status == 409:
        raise HTTPException(status_code=409, detail=f"{resource} conflict: {e.reason}")
    else:
        logger.error(f"K8s API error: {e.status} {e.reason}")
        raise HTTPException(status_code=500, detail=f"Kubernetes error: {e.reason}")


# =============================================================================
# Namespace Operations
# =============================================================================

async def list_namespaces(label_selector: str = None) -> List[client.V1Namespace]:
    """List namespaces, optionally filtered by label."""
    api = await get_client()
    v1 = client.CoreV1Api(api)
    try:
        result = await v1.list_namespace(label_selector=label_selector)
        return result.items
    except ApiException as e:
        handle_api_exception(e, "namespaces")


async def get_namespace(name: str) -> Optional[client.V1Namespace]:
    """Get a namespace by name, returns None if not found."""
    api = await get_client()
    v1 = client.CoreV1Api(api)
    try:
        return await v1.read_namespace(name=name)
    except ApiException as e:
        if e.status == 404:
            return None
        handle_api_exception(e, f"namespace {name}")


async def namespace_exists(name: str) -> bool:
    """Check if a namespace exists."""
    ns = await get_namespace(name)
    return ns is not None


async def delete_namespace(name: str, wait: bool = True, timeout: int = 60) -> bool:
    """
    Delete a namespace.
    If wait=True, polls until namespace is gone or timeout reached.
    Returns True if deleted, False if not found.
    """
    import asyncio
    api = await get_client()
    v1 = client.CoreV1Api(api)

    try:
        await v1.delete_namespace(
            name=name,
            body=client.V1DeleteOptions(propagation_policy="Foreground")
        )
    except ApiException as e:
        if e.status == 404:
            return False
        handle_api_exception(e, f"namespace {name}")

    if wait:
        for _ in range(timeout):
            if not await namespace_exists(name):
                return True
            await asyncio.sleep(1)
        raise HTTPException(status_code=504, detail="Namespace deletion timed out")

    return True
