"""
gRPC server entry point for n8n Kubernetes Version Manager.

Uses grpclib for async gRPC support.
Listens on 0.0.0.0:50051.
"""
import asyncio
import logging
import signal
from typing import Optional

from grpclib.server import Server
from grpclib.utils import graceful_exit

# Import service implementations
from services.version_service import VersionService
from services.snapshot_service import SnapshotService
from services.infrastructure_service import InfrastructureService
from services.available_versions_service import AvailableVersionsService

# Import k8s client for cleanup
import k8s

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Server configuration
HOST = '0.0.0.0'
PORT = 50051


async def create_server() -> Server:
    """Create and configure the gRPC server with all services."""
    # Instantiate all services
    version_service = VersionService()
    snapshot_service = SnapshotService()
    infrastructure_service = InfrastructureService()
    available_versions_service = AvailableVersionsService()

    # Create server with all service handlers
    # Note: Once proto files are generated, services will be passed as handlers
    # server = Server([version_service, snapshot_service, infrastructure_service, available_versions_service])

    # For now, create server with placeholder - will be updated when protos are generated
    server = Server([
        version_service,
        snapshot_service,
        infrastructure_service,
        available_versions_service,
    ])

    return server


async def serve() -> None:
    """Start the gRPC server and handle graceful shutdown."""
    server = await create_server()

    # Use graceful_exit context manager for clean shutdown
    with graceful_exit([server]):
        await server.start(HOST, PORT)
        logger.info(f"gRPC server started on {HOST}:{PORT}")

        # Keep server running until shutdown signal
        await server.wait_closed()

    logger.info("gRPC server stopped")


async def main() -> None:
    """Main entry point with K8s client lifecycle management."""
    try:
        logger.info("Starting n8n Kubernetes Version Manager gRPC server")
        await serve()
    except KeyboardInterrupt:
        logger.info("Received shutdown signal")
    except Exception as e:
        logger.error(f"Server error: {e}")
        raise
    finally:
        # Clean up K8s client
        await k8s.close_client()
        logger.info("Cleanup complete")


def run_server() -> None:
    """Synchronous entry point for running the server."""
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    run_server()
