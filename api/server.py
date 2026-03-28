"""
gRPC server entry point for n8n Kubernetes Version Manager.

Uses grpcio.aio for async gRPC support.
Listens on 0.0.0.0:50051.
"""
import asyncio
import logging
import os
import signal
import sys
from typing import Optional

# Add generated directory to Python path for proto imports
# The generated proto files import 'n8n_manager.v1' directly
_generated_dir = os.path.join(os.path.dirname(__file__), 'generated')
if _generated_dir not in sys.path:
    sys.path.insert(0, _generated_dir)

import grpc
from grpc import aio

# Import generated servicer registration functions
from n8n_manager.v1 import version_pb2_grpc
from n8n_manager.v1 import snapshot_pb2_grpc
from n8n_manager.v1 import infrastructure_pb2_grpc
from n8n_manager.v1 import available_versions_pb2_grpc

# Import service implementations
from services.version_service import VersionServicer
from services.snapshot_service import SnapshotServicer
from services.infrastructure_service import InfrastructureServicer
from services.available_versions_service import AvailableVersionsServicer

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


async def serve() -> None:
    """Start the gRPC server and handle graceful shutdown."""
    # Create async gRPC server
    server = aio.server()

    # Add servicers to server
    version_pb2_grpc.add_VersionServiceServicer_to_server(
        VersionServicer(), server
    )
    snapshot_pb2_grpc.add_SnapshotServiceServicer_to_server(
        SnapshotServicer(), server
    )
    infrastructure_pb2_grpc.add_InfrastructureServiceServicer_to_server(
        InfrastructureServicer(), server
    )
    available_versions_pb2_grpc.add_AvailableVersionsServiceServicer_to_server(
        AvailableVersionsServicer(), server
    )

    # Bind to port
    listen_addr = f'{HOST}:{PORT}'
    server.add_insecure_port(listen_addr)

    logger.info(f"Starting gRPC server on {listen_addr}")
    await server.start()
    logger.info(f"gRPC server started on {listen_addr}")

    # Setup graceful shutdown
    async def shutdown():
        logger.info("Shutting down gRPC server...")
        await server.stop(grace=5)  # 5 second grace period

    # Handle shutdown signals
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(shutdown()))

    # Wait for termination
    await server.wait_for_termination()
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
