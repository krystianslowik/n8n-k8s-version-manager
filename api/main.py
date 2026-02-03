from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response
import k8s


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: nothing needed, client lazy-initializes
    yield
    # Shutdown: close K8s client
    await k8s.close_client()


app = FastAPI(title="n8n Version Manager API", lifespan=lifespan)


# Cache-Control middleware for API responses
class CacheControlMiddleware(BaseHTTPMiddleware):
    # Cache durations by endpoint pattern (in seconds)
    CACHE_RULES = {
        "/api/available-versions": 300,  # 5 minutes - versions rarely change
        "/api/infrastructure/status": 5,  # 5 seconds - infrastructure status
        "/api/cluster/resources": 10,  # 10 seconds - cluster memory
        "/api/snapshots": 10,  # 10 seconds - snapshot list
    }

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # Only cache GET requests
        if request.method == "GET":
            path = request.url.path

            # Find matching cache rule
            for pattern, max_age in self.CACHE_RULES.items():
                if path.startswith(pattern):
                    response.headers["Cache-Control"] = f"public, max-age={max_age}"
                    break
            else:
                # Default: no cache for dynamic endpoints
                response.headers["Cache-Control"] = "no-cache"

        return response


app.add_middleware(CacheControlMiddleware)

# CORS middleware - allow Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",  # Next.js frontend container
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    """Verify API can communicate with Kubernetes cluster."""
    if await k8s.check_cluster_health():
        return {"status": "ok"}
    return {"status": "degraded", "error": "Cannot reach Kubernetes cluster"}


from versions import router as versions_router
from snapshots import router as snapshots_router
from infrastructure import router as infrastructure_router
from available_versions import router as available_versions_router
from cluster import router as cluster_router

app.include_router(versions_router)
app.include_router(snapshots_router)
app.include_router(infrastructure_router)
app.include_router(available_versions_router)
app.include_router(cluster_router)
