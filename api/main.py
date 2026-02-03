"""
Minimal FastAPI app for file uploads only.
All other API operations use gRPC via server.py.
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import k8s


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await k8s.close_client()


app = FastAPI(
    title="n8n Version Manager - Upload API",
    description="File upload endpoint only. Use gRPC for all other operations.",
    lifespan=lifespan
)

# CORS middleware - allow Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    if await k8s.check_cluster_health():
        return {"status": "ok"}
    return {"status": "degraded", "error": "Cannot reach Kubernetes cluster"}


# Only include upload router - all other operations use gRPC
from upload import router as upload_router
app.include_router(upload_router)
