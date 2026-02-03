import re
from fastapi import HTTPException

# Kubernetes namespace naming rules: lowercase alphanumeric, hyphens allowed, max 63 chars
NAMESPACE_PATTERN = re.compile(r'^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$')

# n8n version pattern: major.minor.patch with optional pre-release suffix
# Examples: 1.85.0, 1.86.0-beta.1, 1.86.0-rc.1
VERSION_PATTERN = re.compile(r'^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$')

# Safe identifier pattern (for pod names, container names, snapshot names)
IDENTIFIER_PATTERN = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$')


def validate_namespace(namespace: str) -> str:
    """Validate Kubernetes namespace name."""
    if not namespace or not NAMESPACE_PATTERN.match(namespace):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid namespace: must be lowercase alphanumeric with hyphens, max 63 chars"
        )
    return namespace


def validate_version(version: str) -> str:
    """Validate n8n version format."""
    if not version or not VERSION_PATTERN.match(version):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid version format: expected major.minor.patch (e.g., 1.85.0)"
        )
    return version


def validate_identifier(value: str, field_name: str = "identifier") -> str:
    """Validate pod name, container name, or similar identifiers."""
    if not value or not IDENTIFIER_PATTERN.match(value):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid {field_name}: must start with alphanumeric, max 253 chars"
        )
    return value


def validate_snapshot_name(name: str) -> str:
    """Validate snapshot name (alphanumeric, hyphens, underscores)."""
    pattern = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$')
    if not name or not pattern.match(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid snapshot name: use letters, numbers, hyphens, underscores (max 63 chars)"
        )
    return name


def validate_filename(filename: str) -> str:
    """Validate snapshot filename (must end with .sql, no path traversal)."""
    if not filename or not filename.endswith('.sql'):
        raise HTTPException(status_code=400, detail="Filename must end with .sql")
    if '/' in filename or '..' in filename or '\x00' in filename:
        raise HTTPException(status_code=400, detail="Invalid filename: path traversal not allowed")
    # Strip .sql and validate the base name
    base_name = filename[:-4]
    if not base_name or not re.match(r'^[a-zA-Z0-9][a-zA-Z0-9_-]*$', base_name):
        raise HTTPException(status_code=400, detail="Invalid filename format")
    return filename
