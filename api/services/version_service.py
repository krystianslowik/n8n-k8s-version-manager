"""
gRPC Version Service implementation.
Handles deployment lifecycle, status streaming, and log retrieval.
"""
import asyncio
import logging
import os
import re
import subprocess
import sys
import tempfile
from typing import AsyncIterator, Dict, Any, Optional

# Add generated directory to Python path for proto imports
_generated_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'generated')
if _generated_dir not in sys.path:
    sys.path.insert(0, _generated_dir)

import grpc
import yaml
from google.protobuf import timestamp_pb2
from kubernetes_asyncio import client, watch

import k8s
from deployment_phase import calculate_phase
from n8n_manager.v1 import version_pb2
from n8n_manager.v1 import version_pb2_grpc
from n8n_manager.v1 import common_pb2

logger = logging.getLogger(__name__)


def _create_timestamp(dt) -> timestamp_pb2.Timestamp:
    """Convert datetime to protobuf Timestamp."""
    ts = timestamp_pb2.Timestamp()
    if dt:
        ts.FromDatetime(dt)
    return ts


def _create_deployment_phase(phase_info: Dict) -> common_pb2.DeploymentPhase:
    """Convert phase dict to protobuf DeploymentPhase."""
    return common_pb2.DeploymentPhase(
        phase=phase_info.get("phase", "unknown"),
        label=phase_info.get("label", "Unknown"),
        pods=[]  # Pods can be added separately if needed
    )


def _create_pod_status(pod_data: Dict) -> common_pb2.PodStatus:
    """Convert pod dict to protobuf PodStatus."""
    containers = pod_data.get("containers", [])
    ready = all(c.get("ready", False) for c in containers) if containers else False
    restart_count = sum(c.get("restart_count", 0) for c in containers)

    return common_pb2.PodStatus(
        name=pod_data.get("name", ""),
        phase=pod_data.get("phase", "Unknown"),
        ready=ready,
        restart_count=restart_count
    )


def _create_deployment(
    namespace: str,
    version: str,
    mode: str,
    phase_info: Dict,
    url: str,
    created_at=None,
    pods_data: list = None
) -> common_pb2.Deployment:
    """Create a Deployment proto message."""
    # Calculate port from version
    port = 0
    if version != 'unknown':
        try:
            version_parts = version.split('.')
            port = 30000 + (int(version_parts[0]) * 1000) + (int(version_parts[1]) * 10) + int(version_parts[2])
        except (ValueError, IndexError):
            pass

    # Create phase with pod statuses
    phase_proto = common_pb2.DeploymentPhase(
        phase=phase_info.get("phase", "unknown"),
        label=phase_info.get("label", "Unknown"),
        pods=[_create_pod_status(p) for p in (pods_data or [])]
    )

    deployment = common_pb2.Deployment(
        namespace=namespace,
        version=version,
        mode=mode,
        status=phase_info.get("phase", "unknown"),
        port=port,
        url=url,
        phase=phase_proto
    )

    if created_at:
        deployment.created_at.CopyFrom(_create_timestamp(created_at))

    return deployment


class VersionServicer(version_pb2_grpc.VersionServiceServicer):
    """
    gRPC service for n8n version/deployment management.

    Provides:
    - List: Get all deployed n8n instances
    - Get: Get single deployment details
    - Deploy: Deploy new n8n version (streaming events)
    - Delete: Remove a deployment
    - WatchStatus: Stream deployment phase updates
    - StreamLogs: Stream pod logs
    - GetConfig: Get ConfigMap data
    - GetEvents: Get K8s events
    """

    async def List(
        self,
        request: version_pb2.ListDeploymentsRequest,
        context: grpc.aio.ServicerContext
    ) -> version_pb2.ListDeploymentsResponse:
        """List all deployed n8n versions."""
        try:
            # Get all n8n namespaces
            namespaces = await k8s.list_namespaces()
            deployments = []

            for ns in namespaces:
                name = ns.metadata.name
                if not name.startswith('n8n-') or name == 'n8n-system':
                    continue

                # Extract version from namespace name
                version_match = re.search(r'n8n-v(\d+)-(\d+)-(\d+)', name)
                version = f"{version_match.group(1)}.{version_match.group(2)}.{version_match.group(3)}" if version_match else 'unknown'

                # Get pods for status
                pods = await k8s.list_pods(namespace=name)
                pods_data = [k8s.pod_to_dict(p) for p in pods]

                # Get config to determine mode
                config_data = await k8s.get_configmap(name, "n8n-config")
                is_queue_mode = config_data.get("EXECUTIONS_MODE") == "queue"
                mode = "queue" if is_queue_mode else "regular"

                # Calculate phase
                phase_info = calculate_phase(pods_data, is_queue_mode)

                # Calculate URL from version
                if version != 'unknown':
                    version_parts = version.split('.')
                    port = 30000 + (int(version_parts[0]) * 1000) + (int(version_parts[1]) * 10) + int(version_parts[2])
                    url = f"http://localhost:{port}"
                else:
                    url = ""

                deployment = _create_deployment(
                    namespace=name,
                    version=version,
                    mode=mode,
                    phase_info=phase_info,
                    url=url,
                    created_at=ns.metadata.creation_timestamp,
                    pods_data=pods_data
                )
                deployments.append(deployment)

            return version_pb2.ListDeploymentsResponse(deployments=deployments)

        except Exception as e:
            logger.error(f"List error: {e}")
            await context.abort(grpc.StatusCode.INTERNAL, str(e))

    async def Get(
        self,
        request: version_pb2.GetDeploymentRequest,
        context: grpc.aio.ServicerContext
    ) -> version_pb2.GetDeploymentResponse:
        """Get single deployment details by namespace."""
        namespace = request.namespace

        try:
            # Validate namespace exists
            if not await k8s.namespace_exists(namespace):
                await context.abort(grpc.StatusCode.NOT_FOUND, f"Namespace {namespace} not found")

            # Get pods
            pods = await k8s.list_pods(namespace=namespace)
            pods_data = [k8s.pod_to_dict(p) for p in pods]

            # Get config
            config_data = await k8s.get_configmap(namespace, "n8n-config")
            is_queue_mode = config_data.get("EXECUTIONS_MODE") == "queue"

            # Calculate phase
            phase_info = calculate_phase(pods_data, is_queue_mode)

            # Extract version
            version_match = re.search(r'n8n-v(\d+)-(\d+)-(\d+)', namespace)
            version = f"{version_match.group(1)}.{version_match.group(2)}.{version_match.group(3)}" if version_match else 'unknown'

            # Calculate URL
            if version != 'unknown':
                version_parts = version.split('.')
                port = 30000 + (int(version_parts[0]) * 1000) + (int(version_parts[1]) * 10) + int(version_parts[2])
                url = f"http://localhost:{port}"
            else:
                url = ""

            # Get namespace details for created_at
            ns = await k8s.get_namespace(namespace)
            created_at = ns.metadata.creation_timestamp if ns else None

            deployment = _create_deployment(
                namespace=namespace,
                version=version,
                mode="queue" if is_queue_mode else "regular",
                phase_info=phase_info,
                url=url,
                created_at=created_at,
                pods_data=pods_data
            )

            return version_pb2.GetDeploymentResponse(deployment=deployment)

        except grpc.aio.AbortError:
            raise
        except Exception as e:
            logger.error(f"Get error: {e}")
            await context.abort(grpc.StatusCode.INTERNAL, str(e))

    async def Deploy(
        self,
        request: version_pb2.DeployRequest,
        context: grpc.aio.ServicerContext
    ) -> AsyncIterator[version_pb2.DeployResponse]:
        """
        Deploy a new n8n version.
        Streams deployment events back to client.
        """
        version = request.version
        mode = request.mode
        snapshot = request.snapshot if request.HasField('snapshot') else None

        values_file = None

        try:
            # Send initial event
            yield version_pb2.DeployResponse(
                phase="started",
                message=f"Starting deployment of n8n {version}",
                completed=False,
                success=False
            )

            # Build command
            mode_flag = "--queue" if mode == "queue" else "--regular"
            cmd = ["/workspace/scripts/deploy-version.sh", version, mode_flag]

            if snapshot:
                cmd.extend(["--snapshot", snapshot])

            yield version_pb2.DeployResponse(
                phase="helm_install",
                message="Running Helm install...",
                completed=False,
                success=False
            )

            # Run deployment
            result = subprocess.run(cmd, capture_output=True, text=True, cwd="/workspace", timeout=120)

            if result.returncode != 0:
                error_msg = result.stderr.strip() if result.stderr.strip() else result.stdout.strip()
                if not error_msg:
                    error_msg = "Deployment failed with no error message"

                # Check for false-positive namespace error
                if "already exists" in error_msg.lower() and "namespace" in error_msg.lower():
                    logger.warning(f"Helm reported namespace error but deployment likely succeeded: {error_msg}")
                else:
                    yield version_pb2.DeployResponse(
                        phase="failed",
                        message=error_msg,
                        completed=True,
                        success=False,
                        error=error_msg
                    )
                    return

            # Calculate namespace and URL
            namespace = f"n8n-v{version.replace('.', '-')}"

            version_parts = version.split('.')
            port = 30000 + (int(version_parts[0]) * 1000) + (int(version_parts[1]) * 10) + int(version_parts[2])
            url = f"http://localhost:{port}"

            yield version_pb2.DeployResponse(
                phase="helm_complete",
                message="Helm install complete, waiting for pods...",
                completed=False,
                success=False
            )

            # Watch for deployment completion
            final_phase = "unknown"
            async for phase_event in self._watch_deployment_internal(namespace):
                yield version_pb2.DeployResponse(
                    phase=phase_event.get("phase", "unknown"),
                    message=phase_event.get("message", phase_event.get("label", "")),
                    completed=False,
                    success=False
                )

                final_phase = phase_event.get("phase", "unknown")
                if final_phase in ["running", "failed"]:
                    break

            if final_phase == "running":
                # Get final deployment details
                pods = await k8s.list_pods(namespace=namespace)
                pods_data = [k8s.pod_to_dict(p) for p in pods]
                config_data = await k8s.get_configmap(namespace, "n8n-config")
                is_queue_mode = config_data.get("EXECUTIONS_MODE") == "queue"
                phase_info = calculate_phase(pods_data, is_queue_mode)

                deployment = _create_deployment(
                    namespace=namespace,
                    version=version,
                    mode="queue" if is_queue_mode else "regular",
                    phase_info=phase_info,
                    url=url,
                    pods_data=pods_data
                )

                yield version_pb2.DeployResponse(
                    phase="completed",
                    message=f"Deployment complete: {url}",
                    completed=True,
                    success=True,
                    deployment=deployment
                )
            else:
                yield version_pb2.DeployResponse(
                    phase="failed",
                    message=phase_event.get("reason", "Deployment failed"),
                    completed=True,
                    success=False,
                    error=phase_event.get("reason", "Deployment failed")
                )

        except subprocess.TimeoutExpired:
            yield version_pb2.DeployResponse(
                phase="failed",
                message="Deployment timed out",
                completed=True,
                success=False,
                error="Deployment timed out"
            )
        except Exception as e:
            logger.error(f"Deploy error: {e}")
            yield version_pb2.DeployResponse(
                phase="failed",
                message=str(e),
                completed=True,
                success=False,
                error=str(e)
            )
        finally:
            if values_file and os.path.exists(values_file):
                os.unlink(values_file)

    async def Delete(
        self,
        request: version_pb2.DeleteDeploymentRequest,
        context: grpc.aio.ServicerContext
    ) -> version_pb2.DeleteDeploymentResponse:
        """Delete a deployment by namespace."""
        namespace = request.namespace

        try:
            # Check if namespace exists
            if not await k8s.namespace_exists(namespace):
                await context.abort(grpc.StatusCode.NOT_FOUND, f"Namespace {namespace} not found")

            # Uninstall Helm release
            helm_result = subprocess.run(
                ["helm", "uninstall", namespace, "--namespace", namespace, "--wait"],
                capture_output=True,
                text=True,
                timeout=60
            )
            if helm_result.returncode != 0 and "not found" not in helm_result.stderr.lower():
                logger.warning(f"Helm uninstall warning: {helm_result.stderr}")

            # Delete namespace
            await k8s.delete_namespace(namespace, wait=True, timeout=60)

            return version_pb2.DeleteDeploymentResponse(
                success=True,
                message=f"Namespace {namespace} removed"
            )

        except grpc.aio.AbortError:
            raise
        except subprocess.TimeoutExpired:
            await context.abort(grpc.StatusCode.DEADLINE_EXCEEDED, "Helm uninstall timed out")
        except Exception as e:
            logger.error(f"Delete error: {e}")
            await context.abort(grpc.StatusCode.INTERNAL, str(e))

    async def WatchStatus(
        self,
        request: version_pb2.WatchStatusRequest,
        context: grpc.aio.ServicerContext
    ) -> AsyncIterator[version_pb2.WatchStatusResponse]:
        """Stream deployment phase updates via K8s watch."""
        namespace = request.namespace

        try:
            async for phase_event in self._watch_deployment_internal(namespace):
                # Get current deployment state
                pods = await k8s.list_pods(namespace=namespace)
                pods_data = [k8s.pod_to_dict(p) for p in pods]
                config_data = await k8s.get_configmap(namespace, "n8n-config")
                is_queue_mode = config_data.get("EXECUTIONS_MODE") == "queue"

                # Extract version
                version_match = re.search(r'n8n-v(\d+)-(\d+)-(\d+)', namespace)
                version = f"{version_match.group(1)}.{version_match.group(2)}.{version_match.group(3)}" if version_match else 'unknown'

                # Calculate URL
                if version != 'unknown':
                    version_parts = version.split('.')
                    port = 30000 + (int(version_parts[0]) * 1000) + (int(version_parts[1]) * 10) + int(version_parts[2])
                    url = f"http://localhost:{port}"
                else:
                    url = ""

                deployment = _create_deployment(
                    namespace=namespace,
                    version=version,
                    mode="queue" if is_queue_mode else "regular",
                    phase_info=phase_event,
                    url=url,
                    pods_data=pods_data
                )

                response = version_pb2.WatchStatusResponse(deployment=deployment)
                response.timestamp.GetCurrentTime()
                yield response

                if phase_event.get("phase") in ["running", "failed"]:
                    break

        except grpc.aio.AbortError:
            raise
        except Exception as e:
            logger.error(f"WatchStatus error: {e}")
            await context.abort(grpc.StatusCode.INTERNAL, str(e))

    async def _watch_deployment_internal(self, namespace: str) -> AsyncIterator[Dict[str, Any]]:
        """Internal method to watch deployment phase changes."""
        w = watch.Watch()
        api = await k8s.get_client()
        v1 = client.CoreV1Api(api)

        try:
            # Send initial phase
            pods = await k8s.list_pods(namespace=namespace)
            pods_data = [k8s.pod_to_dict(p) for p in pods]
            config_data = await k8s.get_configmap(namespace, "n8n-config")
            is_queue_mode = config_data.get("EXECUTIONS_MODE") == "queue"
            phase_info = calculate_phase(pods_data, is_queue_mode)
            yield phase_info

            # Watch for changes
            async for event in w.stream(
                v1.list_namespaced_pod,
                namespace=namespace,
                timeout_seconds=300
            ):
                pods = await k8s.list_pods(namespace=namespace)
                pods_data = [k8s.pod_to_dict(p) for p in pods]
                config_data = await k8s.get_configmap(namespace, "n8n-config")
                is_queue_mode = config_data.get("EXECUTIONS_MODE") == "queue"
                phase_info = calculate_phase(pods_data, is_queue_mode)
                yield phase_info

                if phase_info.get("phase") in ["running", "failed"]:
                    break

        except asyncio.CancelledError:
            pass
        finally:
            await w.close()

    async def StreamLogs(
        self,
        request: version_pb2.StreamLogsRequest,
        context: grpc.aio.ServicerContext
    ) -> AsyncIterator[version_pb2.LogEntry]:
        """Stream logs from pods in a namespace."""
        namespace = request.namespace
        pod_name = request.pod_name if request.HasField('pod_name') else None
        container = request.container if request.HasField('container') else None
        tail_lines = request.tail_lines if request.HasField('tail_lines') else 100
        follow = request.follow if request.HasField('follow') else False

        try:
            if not await k8s.namespace_exists(namespace):
                await context.abort(grpc.StatusCode.NOT_FOUND, f"Namespace {namespace} not found")

            if pod_name:
                # Stream specific pod logs
                if follow:
                    async for log_line in self._stream_pod_logs(namespace, pod_name, container, tail_lines):
                        entry = version_pb2.LogEntry(
                            pod_name=pod_name,
                            container=container or "",
                            message=log_line
                        )
                        entry.timestamp.GetCurrentTime()
                        yield entry
                else:
                    logs = await k8s.get_pod_logs(namespace, pod_name, container, tail_lines)
                    for line in logs.split('\n'):
                        if line:
                            entry = version_pb2.LogEntry(
                                pod_name=pod_name,
                                container=container or "",
                                message=line
                            )
                            entry.timestamp.GetCurrentTime()
                            yield entry
            else:
                # Get logs from all pods
                pods = await k8s.list_pods(namespace=namespace)
                for p in pods:
                    logs = await k8s.get_pod_logs(namespace, p.metadata.name, container, tail_lines)
                    for line in logs.split('\n'):
                        if line:
                            entry = version_pb2.LogEntry(
                                pod_name=p.metadata.name,
                                container=container or "",
                                message=line
                            )
                            entry.timestamp.GetCurrentTime()
                            yield entry

        except grpc.aio.AbortError:
            raise
        except Exception as e:
            logger.error(f"StreamLogs error: {e}")
            await context.abort(grpc.StatusCode.INTERNAL, str(e))

    async def _stream_pod_logs(
        self,
        namespace: str,
        pod_name: str,
        container: Optional[str],
        tail_lines: int
    ) -> AsyncIterator[str]:
        """Stream logs from a pod using kubectl (async generator)."""
        cmd = ["kubectl", "logs", "-f", pod_name, "-n", namespace, f"--tail={tail_lines}"]
        if container:
            cmd.extend(["-c", container])

        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        try:
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                yield line.decode('utf-8').rstrip('\n')
        finally:
            process.terminate()
            await process.wait()

    async def GetConfig(
        self,
        request: version_pb2.GetConfigRequest,
        context: grpc.aio.ServicerContext
    ) -> version_pb2.GetConfigResponse:
        """Get ConfigMap environment variables for a deployment."""
        namespace = request.namespace

        try:
            if not await k8s.namespace_exists(namespace):
                await context.abort(grpc.StatusCode.NOT_FOUND, f"Namespace {namespace} not found")

            config_data = await k8s.get_configmap(namespace, "n8n-config")
            return version_pb2.GetConfigResponse(config=config_data)

        except grpc.aio.AbortError:
            raise
        except Exception as e:
            logger.error(f"GetConfig error: {e}")
            await context.abort(grpc.StatusCode.INTERNAL, str(e))

    async def GetEvents(
        self,
        request: version_pb2.GetEventsRequest,
        context: grpc.aio.ServicerContext
    ) -> version_pb2.GetEventsResponse:
        """Get K8s events for a deployment namespace."""
        namespace = request.namespace
        limit = request.limit if request.HasField('limit') else 50

        try:
            if not await k8s.namespace_exists(namespace):
                await context.abort(grpc.StatusCode.NOT_FOUND, f"Namespace {namespace} not found")

            events_data = await k8s.list_events(namespace, limit=limit)

            events = []
            for e in events_data:
                event = version_pb2.Event(
                    type=e.get("type", ""),
                    reason=e.get("reason", ""),
                    message=e.get("message", ""),
                    object=f"{e.get('object', {}).get('kind', '')}/{e.get('object', {}).get('name', '')}",
                    count=e.get("count", 1)
                )
                # Parse timestamp if present
                if e.get("timestamp"):
                    try:
                        from datetime import datetime
                        dt = datetime.fromisoformat(e["timestamp"].replace('Z', '+00:00'))
                        event.last_timestamp.FromDatetime(dt)
                        event.first_timestamp.FromDatetime(dt)
                    except (ValueError, AttributeError):
                        pass
                events.append(event)

            return version_pb2.GetEventsResponse(events=events)

        except grpc.aio.AbortError:
            raise
        except Exception as e:
            logger.error(f"GetEvents error: {e}")
            await context.abort(grpc.StatusCode.INTERNAL, str(e))
