"""
gRPC Available Versions Service implementation.
Fetches n8n releases from GitHub with caching.
"""
import json
import logging
import os
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Any, Optional

# Add generated directory to Python path for proto imports
_generated_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'generated')
if _generated_dir not in sys.path:
    sys.path.insert(0, _generated_dir)

import grpc
import requests
from google.protobuf import timestamp_pb2

from n8n_manager.v1 import available_versions_pb2
from n8n_manager.v1 import available_versions_pb2_grpc

logger = logging.getLogger(__name__)

# Cache configuration
CACHE_FILE = Path("/app/cache/versions.json")
CACHE_TTL_HOURS = 6

# In-memory cache
_cache: Dict[str, Any] = {"versions": [], "last_check": None, "newest": None}


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


def is_prerelease(version: str) -> bool:
    """Check if version is a pre-release (contains alpha, beta, rc, etc.)."""
    return bool(re.search(r'[-.]?(alpha|beta|rc|pre|dev|canary)', version, re.IGNORECASE))


def fetch_page(url: str, params: dict = None) -> tuple:
    """Fetch one page of releases. Returns (releases, next_url)."""
    headers = {"Accept": "application/vnd.github+json"}
    response = requests.get(url, headers=headers, params=params, timeout=10)

    if response.status_code != 200:
        return [], None

    releases = []
    for r in response.json():
        if r.get("draft"):  # Allow pre-releases, only skip drafts
            continue
        version = extract_version(r.get("tag_name", ""))
        if version:
            releases.append({
                "version": version,
                "tag_name": r.get("tag_name", ""),
                "prerelease": r.get("prerelease", False) or is_prerelease(version),
                "published_at": r.get("published_at"),
                "release_notes_url": r.get("html_url", "")
            })

    links = parse_link_header(response.headers.get("Link", ""))
    return releases, links.get("next")


def fetch_all_releases() -> List[Dict[str, Any]]:
    """Fetch ALL releases (used on cold start)."""
    all_releases = []
    url = "https://api.github.com/repos/n8n-io/n8n/releases"
    params = {"per_page": 100}

    while url:
        releases, next_url = fetch_page(url, params)
        all_releases.extend(releases)
        url = next_url
        params = None  # Next URL has params

    return all_releases


def fetch_new_releases(known_newest: str) -> List[Dict[str, Any]]:
    """Fetch only NEW releases since known_newest. Returns new releases (newest first)."""
    new_releases = []
    url = "https://api.github.com/repos/n8n-io/n8n/releases"
    params = {"per_page": 100}

    releases, _ = fetch_page(url, params)  # Only fetch page 1

    for r in releases:
        if r["version"] == known_newest:
            break  # Reached known version, stop
        new_releases.append(r)

    return new_releases


class AvailableVersionsServicer(available_versions_pb2_grpc.AvailableVersionsServiceServicer):
    """
    gRPC service for fetching available n8n versions from GitHub.

    Provides:
    - ListAvailableVersions: Get all available n8n versions with caching
    """

    async def ListAvailableVersions(
        self,
        request: available_versions_pb2.ListAvailableVersionsRequest,
        context: grpc.aio.ServicerContext
    ) -> available_versions_pb2.ListAvailableVersionsResponse:
        """List all available n8n versions from GitHub releases."""
        global _cache
        now = datetime.utcnow()

        include_prereleases = request.include_prereleases if request.HasField('include_prereleases') else True
        limit = request.limit if request.HasField('limit') else 0

        try:
            # Try loading from file if memory cache is empty
            if not _cache["versions"]:
                load_cache_from_file()

            # Check if cache is fresh
            if _cache["last_check"] and (now - _cache["last_check"]) < timedelta(hours=CACHE_TTL_HOURS):
                pass  # Use cached data
            else:
                # Fetch versions
                if _cache["versions"] and _cache["newest"]:
                    # Incremental update - only fetch page 1
                    new_releases = fetch_new_releases(_cache["newest"])
                    if new_releases:
                        _cache["versions"] = new_releases + _cache["versions"]
                        _cache["newest"] = new_releases[0]["version"]
                else:
                    # Cold start - fetch everything
                    _cache["versions"] = fetch_all_releases()
                    _cache["newest"] = _cache["versions"][0]["version"] if _cache["versions"] else None

                _cache["last_check"] = now
                save_cache_to_file()

            # Filter and convert to proto messages
            versions = []
            for i, v in enumerate(_cache["versions"]):
                # Filter out pre-releases if not requested
                if not include_prereleases and v.get("prerelease", False):
                    continue

                version_proto = available_versions_pb2.AvailableVersion(
                    version=v.get("version", ""),
                    tag_name=v.get("tag_name", ""),
                    prerelease=v.get("prerelease", False),
                    latest=(i == 0),  # First version is latest
                    release_notes_url=v.get("release_notes_url", "")
                )

                # Parse published_at if present
                if v.get("published_at"):
                    try:
                        dt = datetime.fromisoformat(v["published_at"].replace('Z', '+00:00'))
                        version_proto.published_at.FromDatetime(dt)
                    except (ValueError, AttributeError):
                        pass

                versions.append(version_proto)

                # Apply limit if specified
                if limit > 0 and len(versions) >= limit:
                    break

            # Build response with cache timestamp
            response = available_versions_pb2.ListAvailableVersionsResponse(versions=versions)
            if _cache["last_check"]:
                response.cached_at.FromDatetime(_cache["last_check"])

            return response

        except requests.RequestException as e:
            logger.warning(f"GitHub API error: {e}")
            # Return stale cache on error
            if _cache["versions"]:
                versions = []
                for i, v in enumerate(_cache["versions"]):
                    if not include_prereleases and v.get("prerelease", False):
                        continue
                    version_proto = available_versions_pb2.AvailableVersion(
                        version=v.get("version", ""),
                        tag_name=v.get("tag_name", ""),
                        prerelease=v.get("prerelease", False),
                        latest=(i == 0),
                        release_notes_url=v.get("release_notes_url", "")
                    )
                    versions.append(version_proto)
                    if limit > 0 and len(versions) >= limit:
                        break
                return available_versions_pb2.ListAvailableVersionsResponse(versions=versions)
            await context.abort(grpc.StatusCode.UNAVAILABLE, f"Failed to fetch versions: {e}")
        except Exception as e:
            logger.error(f"ListAvailableVersions error: {e}")
            if _cache["versions"]:
                versions = []
                for i, v in enumerate(_cache["versions"]):
                    if not include_prereleases and v.get("prerelease", False):
                        continue
                    version_proto = available_versions_pb2.AvailableVersion(
                        version=v.get("version", ""),
                        tag_name=v.get("tag_name", ""),
                        prerelease=v.get("prerelease", False),
                        latest=(i == 0),
                        release_notes_url=v.get("release_notes_url", "")
                    )
                    versions.append(version_proto)
                    if limit > 0 and len(versions) >= limit:
                        break
                return available_versions_pb2.ListAvailableVersionsResponse(versions=versions)
            await context.abort(grpc.StatusCode.INTERNAL, str(e))
