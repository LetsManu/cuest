"""Authenticated HTTP endpoints the Cuest panel talks to.

The panel never reaches the Cuest server directly: every request goes through
Home Assistant (which authenticates it) and is tunnelled over the bridge.
"""

from __future__ import annotations

import json
import re
from typing import Any

from aiohttp import web

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .client import CuestNotConnected
from .const import DOMAIN

_HTTP_REGISTERED = f"{DOMAIN}_http_registered"

_SAFE_PATH = re.compile(r"^[a-z0-9_/\-]+$")
_ENCODED_BAD = re.compile(r"%(2e|2f|5c)", re.IGNORECASE)
_CONTROL_OR_BACKSLASH = re.compile(r"[\x00-\x1f\x7f\\]")

_OFFLINE = {"error": "bridge_offline"}


def _find(hass: HomeAssistant) -> tuple[Any, Any] | None:
    """Return (client, data) of the loaded entry (looked up per request)."""
    for entry_data in hass.data.get(DOMAIN, {}).values():
        if isinstance(entry_data, dict) and entry_data.get("client") is not None:
            return entry_data["client"], entry_data.get("data")
    return None


def _valid_path(request: web.Request, path: str) -> bool:
    if ".." in path or not _SAFE_PATH.match(path):
        return False
    # aiohttp decodes match_info; also reject encoded dots/slashes/backslashes
    # in the raw request target.
    return not _ENCODED_BAD.search(request.raw_path.split("?", 1)[0])


def _valid_query(request: web.Request) -> bool:
    raw = request.rel_url.raw_query_string
    return not (
        _CONTROL_OR_BACKSLASH.search(request.query_string)
        or _CONTROL_OR_BACKSLASH.search(raw)
        or re.search(r"%(5c|0[0-9a-f]|1[0-9a-f]|7f)", raw, re.IGNORECASE)
    )


class CuestProxyView(HomeAssistantView):
    """Proxy /api/cuest/<path> to the Cuest server's /api/<path>.

    Responses are always JSON; a non-JSON body from the server is wrapped as
    ``{"body": ...}``.
    """

    url = "/api/cuest/{path:.+}"
    name = "api:cuest"
    requires_auth = True

    async def _proxy(
        self, request: web.Request, path: str, method: str, with_body: bool
    ) -> web.Response:
        if not _valid_path(request, path) or not _valid_query(request):
            return self.json({"error": "bad_path"}, status_code=400)
        body = None
        if with_body:
            try:
                body = await request.json()
            except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
                return self.json({"error": "invalid_json"}, status_code=400)
        found = _find(request.app["hass"])
        if found is None:
            return self.json(_OFFLINE, status_code=503)
        target = "/api/" + path
        if request.rel_url.raw_query_string:
            target += "?" + request.rel_url.raw_query_string
        try:
            status, result = await found[0].api(method, target, body)
        except (CuestNotConnected, TimeoutError):
            return self.json(_OFFLINE, status_code=503)
        if not isinstance(result, (dict, list)):
            result = {"body": result}
        return self.json(result, status_code=status)

    async def get(self, request: web.Request, path: str) -> web.Response:
        return await self._proxy(request, path, "GET", False)

    async def post(self, request: web.Request, path: str) -> web.Response:
        return await self._proxy(request, path, "POST", True)

    async def patch(self, request: web.Request, path: str) -> web.Response:
        return await self._proxy(request, path, "PATCH", True)

    async def delete(self, request: web.Request, path: str) -> web.Response:
        return await self._proxy(request, path, "DELETE", False)


class CuestWhoAmIView(HomeAssistantView):
    """Tell the panel which player the signed-in HA user is."""

    url = "/api/cuest_whoami"
    name = "api:cuest_whoami"
    requires_auth = True

    async def get(self, request: web.Request) -> web.Response:
        found = _find(request.app["hass"])
        if found is None or found[1] is None:
            return self.json(_OFFLINE, status_code=503)
        data = found[1]
        user = request["hass_user"]
        player = data.player_for_user(user.id, fallback=False)
        return self.json(
            {
                "playerId": player.get("id") if player else None,
                "isAdmin": bool(user.is_admin),
                "players": [
                    {"id": p.get("id"), "name": p.get("name")} for p in data.players
                ],
            }
        )


def async_register_http(hass: HomeAssistant) -> None:
    """Register the panel endpoints once per HA run."""
    if hass.data.get(_HTTP_REGISTERED):
        return
    hass.http.register_view(CuestProxyView())
    hass.http.register_view(CuestWhoAmIView())
    hass.data[_HTTP_REGISTERED] = True
