"""Shared version resolution logic for docbuddy."""

from importlib.metadata import PackageNotFoundError, version


def get_version() -> str:
    """Get the installed docbuddy version.

    Returns:
        The installed version string, or 'unknown' if not found.
    """
    try:
        return version("docbuddy")
    except PackageNotFoundError:
        return "unknown"
