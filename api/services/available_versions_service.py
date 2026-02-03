"""
gRPC Available Versions Service implementation.
Fetches n8n releases from GitHub with caching.
"""
import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional

import requests
from grpclib import GRPCError, Status

# Placeholder imports - will be generated from protos
# from generated.n8n_manager.v1 import available_versions_pb2
# from generated.n8n_manager.v1.available_versions_grpc import AvailableVersionsServiceBase

logger = logging.getLogger(__name__)

# Cache configuration
CACHE_FILE = Path("/app/cache/versions.json")
CACHE_TTL_HOURS = 6

# In-memory cache
_cache: Dict[str, Any] = {"versions": [], "last_check": None, "newest": None}


class AvailableVersionsServiceBase:
    """Placeholder base class - will be replaced by generated code."""
    pass


def load_cache_from_file() -> bool:
    """Load cached versions from file. Returns True if loaded."""
    global _cache
    if CACHE_FILE.exists():
        try:
            data = json.loads(CACHE_FILE.read_text())
            _cache = {
                "versions": data.get("versions", []),
                "last_check": datetime.fromisoformat(data["last_check"]) if data.get("last_check") else None,
                "newest": data.get("newest")
            }
            return bool(_cache["versions"])
        except (json.JSONDecodeError, KeyError, ValueError):
            pass
    return False


def save_cache_to_file():
    """Persist cache to file."""
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        data = {
            "versions": _cache["versions"],
            "last_check": _cache["last_check"].isoformat() if _cache["last_check"] else None,
            "newest": _cache["newest"]
        }
        CACHE_FILE.write_text(json.dumps(data))
    except Exception as e:
        logger.warning(f"Failed to save cache: {e}")


def parse_link_header(link_header: str) -> Dict[str, str]:
    """Parse GitHub's Link header for pagination."""
    links = {}
    if not link_header:
        return links
    for part in link_header.split(','):
        match = re.match(r'<([^>]+)>;\s*rel="([^"]+)"', part.strip())
        if match:
            links[match.group(2)] = match.group(1)
    return links


def extract_version(tag: str) -> Optional[str]:
    """Extract version number from tag name."""
    version = tag.replace("n8n@", "").replace("v", "")
    if version and re.match(r'^\d+\.\d+\.\d+', version):
        return version
    return None


def fetch_page(url: str, params: dict = None) -> tuple:
    """Fetch one page of releases. Returns (versions, next_url)."""
    headers = {"Accept": "application/vnd.github+json"}
    response = requests.get(url, headers=headers, params=params, timeout=10)

    if response.status_code != 200:
        return [], None

    versions = []
    for r in response.json():
        if r.get("draft"):  # Allow pre-releases, only skip drafts
            continue
        version = extract_version(r.get("tag_name", ""))
        if version:
            versions.append(version)

    links = parse_link_header(response.headers.get("Link", ""))
    return versions, links.get("next")


def fetch_all_releases() -> List[str]:
    """Fetch ALL releases (used on cold start)."""
    all_versions = []
    url = "https://api.github.com/repos/n8n-io/n8n/releases"
    params = {"per_page": 100}

    while url:
        versions, next_url = fetch_page(url, params)
        all_versions.extend(versions)
        url = next_url
        params = None  # Next URL has params

    return all_versions


def fetch_new_releases(known_newest: str) -> List[str]:
    """Fetch only NEW releases since known_newest. Returns new versions (newest first)."""
    new_versions = []
    url = "https://api.github.com/repos/n8n-io/n8n/releases"
    params = {"per_page": 100}

    versions, _ = fetch_page(url, params)  # Only fetch page 1

    for v in versions:
        if v == known_newest:
            break  # Reached known version, stop
        new_versions.append(v)

    return new_versions


class AvailableVersionsService(AvailableVersionsServiceBase):
    """
    gRPC service for fetching available n8n versions from GitHub.

    Provides:
    - ListAvailableVersions: Get all available n8n versions with caching
    - RefreshVersions: Force refresh the version cache
    - GetLatestVersion: Get the latest stable version
    """

    async def ListAvailableVersions(self, stream) -> None:
        """List all available n8n versions from GitHub releases."""
        global _cache
        now = datetime.utcnow()

        try:
            # Try loading from file if memory cache is empty
            if not _cache["versions"]:
                load_cache_from_file()

            # Check if cache is fresh
            if _cache["last_check"] and (now - _cache["last_check"]) < timedelta(hours=CACHE_TTL_HOURS):
                return {"versions": _cache["versions"]}

            # Fetch versions
            if _cache["versions"] and _cache["newest"]:
                # Incremental update - only fetch page 1
                new_versions = fetch_new_releases(_cache["newest"])
                if new_versions:
                    _cache["versions"] = new_versions + _cache["versions"]
                    _cache["newest"] = new_versions[0]
            else:
                # Cold start - fetch everything
                _cache["versions"] = fetch_all_releases()
                _cache["newest"] = _cache["versions"][0] if _cache["versions"] else None

            _cache["last_check"] = now
            save_cache_to_file()

            return {"versions": _cache["versions"]}

        except requests.RequestException as e:
            logger.warning(f"GitHub API error: {e}")
            # Return stale cache on error
            if _cache["versions"]:
                return {"versions": _cache["versions"]}
            raise GRPCError(Status.UNAVAILABLE, f"Failed to fetch versions: {e}")
        except Exception as e:
            logger.error(f"ListAvailableVersions error: {e}")
            if _cache["versions"]:
                return {"versions": _cache["versions"]}
            raise GRPCError(Status.INTERNAL, str(e))

    async def RefreshVersions(self, stream) -> None:
        """Force refresh the version cache from GitHub."""
        global _cache

        try:
            # Force full refresh
            _cache["versions"] = fetch_all_releases()
            _cache["newest"] = _cache["versions"][0] if _cache["versions"] else None
            _cache["last_check"] = datetime.utcnow()
            save_cache_to_file()

            return {
                "success": True,
                "versions_count": len(_cache["versions"]),
                "newest": _cache["newest"]
            }

        except requests.RequestException as e:
            logger.warning(f"GitHub API error during refresh: {e}")
            raise GRPCError(Status.UNAVAILABLE, f"Failed to refresh versions: {e}")
        except Exception as e:
            logger.error(f"RefreshVersions error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))

    async def GetLatestVersion(self, stream) -> None:
        """Get the latest stable n8n version."""
        global _cache

        try:
            # Ensure cache is populated
            if not _cache["versions"]:
                load_cache_from_file()

            if not _cache["versions"]:
                # Need to fetch
                _cache["versions"] = fetch_all_releases()
                _cache["newest"] = _cache["versions"][0] if _cache["versions"] else None
                _cache["last_check"] = datetime.utcnow()
                save_cache_to_file()

            # Find latest stable version (no pre-release suffix)
            latest_stable = None
            for version in _cache["versions"]:
                # Stable versions have no suffix after major.minor.patch
                if re.match(r'^\d+\.\d+\.\d+$', version):
                    latest_stable = version
                    break

            if not latest_stable:
                latest_stable = _cache["newest"]  # Fallback to newest

            return {
                "version": latest_stable,
                "is_prerelease": latest_stable != _cache["newest"] if _cache["newest"] else False
            }

        except Exception as e:
            logger.error(f"GetLatestVersion error: {e}")
            raise GRPCError(Status.INTERNAL, str(e))
