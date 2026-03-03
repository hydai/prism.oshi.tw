"""Client for the Prism Admin API (Cloudflare Workers).

Fetches approved songs and streams for export to the fan-facing static site.
Requires environment variables:
  ADMIN_API_URL   — base URL of the admin Workers API (e.g. https://admin.example.com)
  ADMIN_API_TOKEN — Bearer token for authentication
"""

from __future__ import annotations

import os

import httpx


class AdminApiError(Exception):
    """Raised when the admin API returns an error."""


class AdminApiClient:
    """Synchronous client for the admin Workers API."""

    def __init__(
        self,
        base_url: str | None = None,
        token: str | None = None,
        timeout: float = 30.0,
        streamer: str = "mizuki",
    ) -> None:
        self.base_url = (base_url or os.environ.get("ADMIN_API_URL", "")).rstrip("/")
        self.token = token or os.environ.get("ADMIN_API_TOKEN", "")
        self.streamer = streamer

        if not self.base_url:
            raise AdminApiError(
                "ADMIN_API_URL is not set. "
                "Set the environment variable or pass base_url."
            )
        if not self.token:
            raise AdminApiError(
                "ADMIN_API_TOKEN is not set. "
                "Set the environment variable or pass token."
            )

        self._client = httpx.Client(
            base_url=self.base_url,
            headers={"Authorization": f"Bearer {self.token}"},
            timeout=timeout,
        )

    def _get(self, path: str) -> dict | list:
        """Make an authenticated GET request and return parsed JSON."""
        sep = "&" if "?" in path else "?"
        url = f"{path}{sep}streamer={self.streamer}"
        try:
            resp = self._client.get(url)
        except httpx.ConnectError as exc:
            raise AdminApiError(f"Cannot connect to {self.base_url}: {exc}") from exc
        except httpx.TimeoutException as exc:
            raise AdminApiError(f"Request timed out: {exc}") from exc

        if resp.status_code == 401:
            raise AdminApiError("Authentication failed (401). Check ADMIN_API_TOKEN.")
        if resp.status_code == 403:
            raise AdminApiError("Forbidden (403). Check ADMIN_API_TOKEN permissions.")
        if resp.status_code != 200:
            raise AdminApiError(
                f"API returned HTTP {resp.status_code}: {resp.text[:200]}"
            )

        try:
            return resp.json()
        except ValueError as exc:
            raise AdminApiError(f"Invalid JSON response: {exc}") from exc

    def get_approved_songs(self) -> list[dict]:
        """Fetch approved songs in fan-site format."""
        data = self._get("/api/export/songs")
        if not isinstance(data, list):
            raise AdminApiError("Expected a JSON array from /api/export/songs")
        return data

    def get_approved_streams(self) -> list[dict]:
        """Fetch approved streams in fan-site format."""
        data = self._get("/api/export/streams")
        if not isinstance(data, list):
            raise AdminApiError("Expected a JSON array from /api/export/streams")
        return data

    def get_stats(self) -> dict:
        """Fetch database statistics (counts by status)."""
        data = self._get("/api/stats")
        if not isinstance(data, dict):
            raise AdminApiError("Expected a JSON object from /api/stats")
        return data

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()
