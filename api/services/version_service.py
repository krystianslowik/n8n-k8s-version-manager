"""
gRPC Version Service implementation.
Handles deployment lifecycle, status streaming, and log retrieval.
"""
import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
from typing import AsyncIterator, Dict, Any, Optional

import yaml
from grpclib import GRPCError, Status
from kubernetes_asyncio import client, watch

import k8s
from deployment_phase import calculate_phase

# Placeholder imports - will be generated from protos
# from generated.n8n_manager.v1 import version_pb2
# from generated.n8n_manager.v1.version_grpc import VersionServiceBase

logger = logging.getLogger(__name__)


class VersionServiceBase:
    """Placeholder base class - will be replaced by generated code."""
    pass


class VersionService(VersionServiceBase):
    """
    gRPC service for n8n version/deployment management.

    Provides:
    - ListDeployments: Get all deployed n8n instances
    - GetDeployment: Get single deployment details
    - DeployVersion: Deploy new n8n version (streaming events)
    - DeleteDeployment: Remove a deployment
    - WatchDeploymentStatus: Stream deployment phase updates
    - StreamLogs: Stream pod logs
    - GetDeploymentConfig: Get ConfigMap data
    - GetDeploymentEvents: Get K8s events
    """

    async def ListDeployments(self, stream) -> None:
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
                    port = 30000 + (int(version_parts[0]) * 100) + (int(version_parts[1]) * 10) + int(version_parts[2])
                    url = f"http://localhost:{port}"
                else:
                    url = ""

                deployments.append({
                    "namespace": name,
                    "version": version,
                    "mode": mode,
                    "phase": phase_info.get("phase", "unknown"),
                    "phase_label": phase_info.get("label", "Unknown"),
                    "url": url,
                    "pods_ready": len([p for p in pods_data if p.get("phase") == "Running"]),
                    "pods_total": len(pods_data),
                    "created_at": ns.metadata.creation_timestamp.isoformat() if ns.metadata.creation_timestamp else None,
                })

            # Send response
            # await stream.send_message(ListDeploymentsResponse(deployments=deployments))
            # Placeholder: return dict for now
            return {"deployments": deployments}

        except Exception as e:
            logger.error(f"ListDeployments error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def GetDeployment(self, stream) -> None:
        """Get single deployment details by namespace."""
        request = await stream.recv_message()
        namespace = request.namespace

        try:
            # Validate namespace exists
            if not await k8s.namespace_exists(namespace):
                raise GRPCError(Status.NOT_FOUND, f"Namespace {namespace} not found")

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
                port = 30000 + (int(version_parts[0]) * 100) + (int(version_parts[1]) * 10) + int(version_parts[2])
                url = f"http://localhost:{port}"
            else:
                url = ""

            deployment = {
                "namespace": namespace,
                "version": version,
                "mode": "queue" if is_queue_mode else "regular",
                "phase": phase_info.get("phase", "unknown"),
                "phase_label": phase_info.get("label", "Unknown"),
                "phase_message": phase_info.get("message", ""),
                "url": url,
                "pods": pods_data,
                "config": config_data,
            }

            # await stream.send_message(GetDeploymentResponse(deployment=deployment))
            return deployment

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"GetDeployment error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def DeployVersion(self, stream) -> AsyncIterator[Dict[str, Any]]:
        """
        Deploy a new n8n version.
        Streams deployment events back to client.
        """
        request = await stream.recv_message()
        version = request.version
        mode = request.mode
        name = getattr(request, 'name', None)
        snapshot = getattr(request, 'snapshot', None)
        helm_values = getattr(request, 'helm_values', None)

        values_file = None

        try:
            # Send initial event
            await stream.send_message({
                "event_type": "started",
                "message": f"Starting deployment of n8n {version}",
            })

            # Build command
            mode_flag = "--queue" if mode == "queue" else "--regular"
            cmd = ["/workspace/scripts/deploy-version.sh", version, mode_flag]

            if name:
                cmd.extend(["--name", name])

            if snapshot:
                cmd.extend(["--snapshot", snapshot])

            # Handle helm values
            if helm_values:
                helm_values_dict = self._build_helm_values(helm_values)
                if helm_values_dict:
                    fd, values_file = tempfile.mkstemp(suffix='.yaml', prefix='helm-values-')
                    with os.fdopen(fd, 'w') as f:
                        yaml.dump(helm_values_dict, f)
                    cmd.extend(["--values-file", values_file])

            await stream.send_message({
                "event_type": "progress",
                "message": "Running Helm install...",
            })

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
                    await stream.send_message({
                        "event_type": "error",
                        "message": error_msg,
                    })
                    raise GRPCError(Status.INTERNAL, error_msg)

            # Calculate namespace and URL
            if name:
                namespace = name
            else:
                namespace = f"n8n-v{version.replace('.', '-')}"

            version_parts = version.split('.')
            port = 30000 + (int(version_parts[0]) * 100) + (int(version_parts[1]) * 10) + int(version_parts[2])
            url = f"http://localhost:{port}"

            await stream.send_message({
                "event_type": "helm_complete",
                "message": "Helm install complete, waiting for pods...",
                "namespace": namespace,
                "url": url,
            })

            # Watch for deployment completion
            async for phase_event in self._watch_deployment_internal(namespace):
                await stream.send_message({
                    "event_type": "phase_update",
                    "phase": phase_event.get("phase"),
                    "label": phase_event.get("label"),
                    "message": phase_event.get("message", ""),
                })

                if phase_event.get("phase") in ["running", "failed"]:
                    break

            final_phase = phase_event.get("phase", "unknown")
            if final_phase == "running":
                await stream.send_message({
                    "event_type": "completed",
                    "message": f"Deployment complete: {url}",
                    "namespace": namespace,
                    "url": url,
                })
            else:
                await stream.send_message({
                    "event_type": "failed",
                    "message": phase_event.get("reason", "Deployment failed"),
                    "namespace": namespace,
                })

        except GRPCError:
            raise
        except subprocess.TimeoutExpired:
            await stream.send_message({
                "event_type": "error",
                "message": "Deployment timed out",
            })
            raise GRPCError(Status.DEADLINE_EXCEEDED, "Deployment timed out")
        except Exception as e:
            logger.error(f"DeployVersion error: {e}")
            await stream.send_message({
                "event_type": "error",
                "message": str(e),
            })
            raise GRPCError(Status.INTERNAL, str(e))
        finally:
            if values_file and os.path.exists(values_file):
                os.unlink(values_file)

    async def DeleteDeployment(self, stream) -> None:
        """Delete a deployment by namespace."""
        request = await stream.recv_message()
        namespace = request.namespace

        try:
            # Check if namespace exists
            if not await k8s.namespace_exists(namespace):
                raise GRPCError(Status.NOT_FOUND, f"Namespace {namespace} not found")

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

            # await stream.send_message(DeleteDeploymentResponse(success=True, message=f"Namespace {namespace} removed"))
            return {"success": True, "message": f"Namespace {namespace} removed"}

        except GRPCError:
            raise
        except subprocess.TimeoutExpired:
            raise GRPCError(Status.DEADLINE_EXCEEDED, "Helm uninstall timed out")
        except Exception as e:
            logger.error(f"DeleteDeployment error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def WatchDeploymentStatus(self, stream) -> AsyncIterator[Dict[str, Any]]:
        """Stream deployment phase updates via K8s watch."""
        request = await stream.recv_message()
        namespace = request.namespace

        try:
            async for phase_event in self._watch_deployment_internal(namespace):
                await stream.send_message(phase_event)

                if phase_event.get("phase") in ["running", "failed"]:
                    break

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"WatchDeploymentStatus error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

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

    async def StreamLogs(self, stream) -> AsyncIterator[Dict[str, Any]]:
        """Stream logs from pods in a namespace."""
        request = await stream.recv_message()
        namespace = request.namespace
        pod_name = getattr(request, 'pod', None)
        container = getattr(request, 'container', None)
        tail_lines = getattr(request, 'tail_lines', 100)
        follow = getattr(request, 'follow', False)

        try:
            if not await k8s.namespace_exists(namespace):
                raise GRPCError(Status.NOT_FOUND, f"Namespace {namespace} not found")

            if pod_name:
                # Stream specific pod logs
                if follow:
                    async for log_line in self._stream_pod_logs(namespace, pod_name, container, tail_lines):
                        await stream.send_message({
                            "pod": pod_name,
                            "container": container,
                            "line": log_line,
                        })
                else:
                    logs = await k8s.get_pod_logs(namespace, pod_name, container, tail_lines)
                    for line in logs.split('\n'):
                        await stream.send_message({
                            "pod": pod_name,
                            "container": container,
                            "line": line,
                        })
            else:
                # Get logs from all pods
                pods = await k8s.list_pods(namespace=namespace)
                for p in pods:
                    logs = await k8s.get_pod_logs(namespace, p.metadata.name, container, tail_lines)
                    for line in logs.split('\n'):
                        await stream.send_message({
                            "pod": p.metadata.name,
                            "container": container,
                            "line": line,
                        })

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"StreamLogs error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

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

    async def GetDeploymentConfig(self, stream) -> None:
        """Get ConfigMap environment variables for a deployment."""
        request = await stream.recv_message()
        namespace = request.namespace

        try:
            if not await k8s.namespace_exists(namespace):
                raise GRPCError(Status.NOT_FOUND, f"Namespace {namespace} not found")

            config_data = await k8s.get_configmap(namespace, "n8n-config")
            # await stream.send_message(GetDeploymentConfigResponse(config=config_data))
            return {"config": config_data}

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"GetDeploymentConfig error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def GetDeploymentEvents(self, stream) -> None:
        """Get K8s events for a deployment namespace."""
        request = await stream.recv_message()
        namespace = request.namespace
        limit = getattr(request, 'limit', 50)

        try:
            if not await k8s.namespace_exists(namespace):
                raise GRPCError(Status.NOT_FOUND, f"Namespace {namespace} not found")

            events = await k8s.list_events(namespace, limit=limit)
            # await stream.send_message(GetDeploymentEventsResponse(events=events))
            return {"events": events}

        except GRPCError:
            raise
        except Exception as e:
            logger.error(f"GetDeploymentEvents error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    def _build_helm_values(self, helm_values) -> Dict[str, Any]:
        """Convert helm values to dictionary."""
        values = {}

        if hasattr(helm_values, 'database') and helm_values.database:
            db = {}
            if helm_values.database.isolated:
                isolated = {}
                if helm_values.database.isolated.image:
                    isolated['image'] = helm_values.database.isolated.image
                if helm_values.database.isolated.storage_size:
                    isolated['storage'] = {'size': helm_values.database.isolated.storage_size}
                if isolated:
                    db['isolated'] = isolated
            if db:
                values['database'] = db

        if hasattr(helm_values, 'redis') and helm_values.redis:
            redis = {}
            if helm_values.redis.host:
                redis['host'] = helm_values.redis.host
            if helm_values.redis.port:
                redis['port'] = helm_values.redis.port
            if redis:
                values['redis'] = redis

        if hasattr(helm_values, 'n8n_config') and helm_values.n8n_config:
            n8n_config = {}
            if helm_values.n8n_config.encryption_key:
                n8n_config['encryptionKey'] = helm_values.n8n_config.encryption_key
            if helm_values.n8n_config.timezone:
                n8n_config['timezone'] = helm_values.n8n_config.timezone
            if helm_values.n8n_config.webhook_url:
                n8n_config['webhookUrl'] = helm_values.n8n_config.webhook_url
            if n8n_config:
                values['n8nConfig'] = n8n_config

        if hasattr(helm_values, 'extra_env') and helm_values.extra_env:
            values['extraEnv'] = dict(helm_values.extra_env)

        if hasattr(helm_values, 'raw_yaml') and helm_values.raw_yaml:
            try:
                raw_values = yaml.safe_load(helm_values.raw_yaml)
                if isinstance(raw_values, dict):
                    values = self._deep_merge(values, raw_values)
            except yaml.YAMLError:
                pass

        return values

    def _deep_merge(self, base: dict, override: dict) -> dict:
        """Deep merge two dictionaries."""
        result = base.copy()
        for key, value in override.items():
            if key in result and isinstance(result[key], dict) and isinstance(value, dict):
                result[key] = self._deep_merge(result[key], value)
            else:
                result[key] = value
        return result
