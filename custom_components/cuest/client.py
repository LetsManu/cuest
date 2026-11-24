"""WebSocket client that connects the Home Assistant bridge to the Cuest server."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
import contextlib
import json
import logging
from typing import Any
import uuid

import aiohttp

from homeassistant.core import HomeAssistant
from homeassistant.helpers import aiohttp_client, issue_registry as ir

from .const import DOMAIN, ISSUE_BAD_SECRET, VERSION

_LOGGER = logging.getLogger(__name__)

CLOSE_BAD_AUTH = 4001
CLOSE_REPLACED = 4002
HANDSHAKE_TIMEOUT = 10


class CuestNotConnected(Exception):
    """Raised when the bridge is not connected to the Cuest server."""


class CannotConnect(Exception):
    """Raised when the Cuest server cannot be reached."""


class InvalidAuth(Exception):
    """Raised when the Cuest server rejects the secret."""


async def async_validate(hass: HomeAssistant, url: str, secret: str) -> None:
    """Open a temporary connection and complete hello/welcome, then close it."""
    session = aiohttp_client.async_get_clientsession(hass)
    try:
        async with asyncio.timeout(HANDSHAKE_TIMEOUT):
            async with session.ws_connect(_bridge_url(url)) as ws:
                await ws.send_str(
                    json.dumps(
                        {"type": "hello", "secret": secret, "version": VERSION}
                    )
                )
                async for msg in ws:
                    if msg.type is not aiohttp.WSMsgType.TEXT:
                        break
                    data = _parse(msg.data)
                    if data is None:
                        continue
                    if data.get("type") == "welcome":
                        return
                    if data.get("type") == "error":
                        raise InvalidAuth
                if ws.close_code == CLOSE_BAD_AUTH:
                    raise InvalidAuth
    except (aiohttp.ClientError, TimeoutError, OSError, ValueError) as err:
        raise CannotConnect from err
    raise CannotConnect


class CuestClient:
    """Maintains the bridge connection and tunnels API calls."""

    def __init__(
        self,
        hass: HomeAssistant,
        url: str,
        secret: str,
        *,
        initial_backoff: float = 1.0,
        max_backoff: float = 60.0,
    ) -> None:
        self._hass = hass
        self._ws_url = _bridge_url(url)
        self._secret = secret
        self._initial_backoff = initial_backoff
        self._max_backoff = max_backoff
        self._task: asyncio.Task[None] | None = None
        self._ws: aiohttp.ClientWebSocketResponse | None = None
        self._pending: dict[str, asyncio.Future[tuple[int, Any]]] = {}
        self._callbacks: dict[str, list[Callable[[dict], None]]] = {}
        self._bad_secret_logged = False
        self._unreachable_logged = False
        self._sleep = asyncio.sleep
        self.connected = False

    def on_message(self, type: str, cb: Callable[[dict], None]) -> None:
        """Register a callback for messages of the given type."""
        self._callbacks.setdefault(type, []).append(cb)

    async def start(self) -> None:
        """Start the connect/reconnect loop in the background."""
        if self._task is None:
            self._task = self._hass.async_create_background_task(
                self._run(), f"{DOMAIN} bridge client"
            )

    async def stop(self) -> None:
        """Stop the loop, close the socket and fail pending calls."""
        task, self._task = self._task, None
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        ws, self._ws = self._ws, None
        if ws is not None and not ws.closed:
            await ws.close()
        self.connected = False
        self._fail_pending()

    async def send(self, msg: dict) -> None:
        """Send a JSON message to the server."""
        if not self.connected or self._ws is None:
            raise CuestNotConnected
        try:
            await self._ws.send_str(json.dumps(msg))
        except (aiohttp.ClientError, ConnectionError) as err:
            raise CuestNotConnected from err

    async def api(
        self, method: str, path: str, body: Any | None = None, timeout: float = 10
    ) -> tuple[int, Any]:
        """Call the Cuest REST API through the tunnel."""
        if not self.connected:
            raise CuestNotConnected
        msg_id = uuid.uuid4().hex
        future: asyncio.Future[tuple[int, Any]] = (
            self._hass.loop.create_future()
        )
        self._pending[msg_id] = future
        try:
            msg: dict[str, Any] = {
                "type": "api",
                "id": msg_id,
                "method": method,
                "path": path,
            }
            if body is not None:
                msg["body"] = body
            await self.send(msg)
            async with asyncio.timeout(timeout):
                return await future
        finally:
            self._pending.pop(msg_id, None)

    async def _run(self) -> None:
        backoff = self._initial_backoff
        while True:
            welcomed = False
            close_code: int | None = None
            try:
                welcomed, close_code = await self._connect_once()
            except asyncio.CancelledError:
                raise
            except (aiohttp.ClientError, TimeoutError, OSError) as err:
                _LOGGER.debug("Cuest connection failed: %s", err)
            except Exception:
                _LOGGER.exception("Unexpected error in Cuest bridge client")
            finally:
                self.connected = False
                self._ws = None
                self._fail_pending()

            if close_code == CLOSE_BAD_AUTH:
                self._report_bad_secret()
                backoff = self._max_backoff
            else:
                self._log_unreachable()
                if welcomed and close_code != CLOSE_REPLACED:
                    backoff = self._initial_backoff
            await self._sleep(backoff)
            backoff = min(backoff * 2, self._max_backoff)

    async def _connect_once(self) -> tuple[bool, int | None]:
        """Run one connection. Returns (welcomed, close_code)."""
        session = aiohttp_client.async_get_clientsession(self._hass)
        welcomed = False
        async with session.ws_connect(self._ws_url, heartbeat=30) as ws:
            self._ws = ws
            await ws.send_str(
                json.dumps(
                    {"type": "hello", "secret": self._secret, "version": VERSION}
                )
            )
            async with asyncio.timeout(HANDSHAKE_TIMEOUT):
                async for msg in ws:
                    if msg.type is not aiohttp.WSMsgType.TEXT:
                        break
                    data = _parse(msg.data)
                    if data is not None and data.get("type") == "welcome":
                        welcomed = True
                        break
            if welcomed:
                self.connected = True
                self._on_welcome()
                self._dispatch({"type": "welcome"})
                async for msg in ws:
                    if msg.type is not aiohttp.WSMsgType.TEXT:
                        break
                    data = _parse(msg.data)
                    if data is not None:
                        self._dispatch(data)
            return welcomed, ws.close_code

    def _log_unreachable(self) -> None:
        if not self._unreachable_logged:
            self._unreachable_logged = True
            _LOGGER.warning("Cuest server is unreachable; retrying in the background")

    def _on_welcome(self) -> None:
        if self._unreachable_logged:
            _LOGGER.info("Connected to the Cuest server")
        self._unreachable_logged = False
        self._bad_secret_logged = False
        ir.async_delete_issue(self._hass, DOMAIN, ISSUE_BAD_SECRET)

    def _report_bad_secret(self) -> None:
        if not self._bad_secret_logged:
            self._bad_secret_logged = True
            _LOGGER.error(
                "The Cuest server rejected the shared secret; check the secret "
                "of the Cuest integration"
            )
        ir.async_create_issue(
            self._hass,
            DOMAIN,
            ISSUE_BAD_SECRET,
            is_fixable=False,
            severity=ir.IssueSeverity.ERROR,
            translation_key=ISSUE_BAD_SECRET,
        )

    def _dispatch(self, data: dict) -> None:
        msg_type = data.get("type")
        if msg_type == "api_result":
            msg_id = data.get("id")
            future = self._pending.get(msg_id) if isinstance(msg_id, str) else None
            if future is not None and not future.done():
                future.set_result((data.get("status", 500), data.get("body")))
            return
        for cb in self._callbacks.get(msg_type, []):
            try:
                cb(data)
            except Exception:
                _LOGGER.exception("Error in Cuest %s handler", msg_type)

    def _fail_pending(self) -> None:
        for future in self._pending.values():
            if not future.done():
                future.set_exception(CuestNotConnected())
                future.exception()  # mark retrieved; api() may no longer await it
        self._pending.clear()


def _parse(raw: str) -> dict | None:
    try:
        data = json.loads(raw)
    except ValueError:
        _LOGGER.debug("Ignoring invalid JSON from Cuest server")
        return None
    return data if isinstance(data, dict) else None


def _bridge_url(url: str) -> str:
    base = url.rstrip("/")
    if base.startswith("https://"):
        base = "wss://" + base[len("https://") :]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://") :]
    return f"{base}/bridge"
