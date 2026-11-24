"""Tests for the Cuest bridge WebSocket client."""

from __future__ import annotations

import asyncio

from aiohttp import WSMsgType, web
from aiohttp.test_utils import TestServer
import pytest

from homeassistant.core import HomeAssistant
from homeassistant.helpers import issue_registry as ir

from custom_components.cuest.client import (
    CannotConnect,
    CuestClient,
    CuestNotConnected,
    InvalidAuth,
    async_validate,
)
from custom_components.cuest.const import DOMAIN

SECRET = "s3cret"


class FakeServer:
    """Minimal Cuest server speaking the bridge protocol."""

    def __init__(self, secret: str = SECRET) -> None:
        self.secret = secret
        self.hellos: list[dict] = []
        self.received: list[dict] = []
        self.sockets: list[web.WebSocketResponse] = []
        self.api_reply: tuple[int, object] | None = (200, [{"id": "p1"}])
        self.server: TestServer | None = None

    async def handler(self, request: web.Request) -> web.StreamResponse:
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        self.sockets.append(ws)
        first = await ws.receive_json()
        self.hellos.append(first)
        if first.get("type") != "hello" or first.get("secret") != self.secret:
            await ws.send_json({"type": "error", "reason": "unauthorized"})
            await ws.close(code=4001)
            return ws
        await ws.send_json({"type": "welcome"})
        await ws.send_json({"type": "subscribe", "entities": ["sensor.a"]})
        async for msg in ws:
            if msg.type is not WSMsgType.TEXT:
                break
            data = msg.json()
            self.received.append(data)
            if data["type"] == "api" and self.api_reply is not None:
                status, body = self.api_reply
                await ws.send_json(
                    {"type": "api_result", "id": data["id"], "status": status, "body": body}
                )
        return ws

    async def start(self) -> str:
        app = web.Application()
        app.router.add_get("/bridge", self.handler)
        self.server = TestServer(app, host="127.0.0.1")
        await self.server.start_server()
        return str(self.server.make_url("")).rstrip("/")

    async def stop(self) -> None:
        assert self.server is not None
        await self.server.close()


async def _wait_for(predicate, timeout: float = 3.0) -> None:
    async with asyncio.timeout(timeout):
        while not predicate():
            await asyncio.sleep(0.01)


@pytest.fixture
async def server(socket_enabled):
    srv = FakeServer()
    srv.url = await srv.start()
    yield srv
    await srv.stop()


def _client(hass, server, secret=SECRET) -> CuestClient:
    return CuestClient(
        hass, server.url, secret, initial_backoff=0.05, max_backoff=0.2
    )


async def test_client_authenticates_and_receives_welcome(hass: HomeAssistant, server) -> None:
    client = _client(hass, server)
    subscribed: list[dict] = []
    client.on_message("subscribe", subscribed.append)
    await client.start()
    await _wait_for(lambda: client.connected and subscribed)

    assert server.hellos[0] == {"type": "hello", "secret": SECRET, "version": "0.1.0"}
    assert subscribed[0]["entities"] == ["sensor.a"]
    await client.stop()
    assert not client.connected


async def test_client_reconnects_after_server_drop(hass: HomeAssistant, server) -> None:
    client = _client(hass, server)
    await client.start()
    await _wait_for(lambda: client.connected)

    await server.sockets[0].close()
    await _wait_for(lambda: len(server.hellos) == 2 and client.connected)
    await client.stop()


async def test_api_roundtrip(hass: HomeAssistant, server) -> None:
    client = _client(hass, server)
    await client.start()
    await _wait_for(lambda: client.connected)

    assert await client.api("GET", "/api/players") == (200, [{"id": "p1"}])
    assert server.received[0]["method"] == "GET"
    assert server.received[0]["path"] == "/api/players"
    await client.stop()


async def test_api_not_connected_and_timeout(hass: HomeAssistant, server) -> None:
    client = _client(hass, server)
    with pytest.raises(CuestNotConnected):
        await client.api("GET", "/api/players")

    await client.start()
    await _wait_for(lambda: client.connected)
    server.api_reply = None
    with pytest.raises(asyncio.TimeoutError):
        await client.api("GET", "/api/players", timeout=0.1)
    await client.stop()


async def test_pending_api_fails_when_connection_drops(hass: HomeAssistant, server) -> None:
    client = _client(hass, server)
    await client.start()
    await _wait_for(lambda: client.connected)
    server.api_reply = None

    call = asyncio.ensure_future(client.api("GET", "/api/players"))
    await _wait_for(lambda: server.received)
    await server.sockets[0].close()
    with pytest.raises(CuestNotConnected):
        await call
    await client.stop()


async def test_bad_secret_creates_repair_issue(hass: HomeAssistant, server) -> None:
    client = _client(hass, server, secret="wrong")
    await client.start()
    registry = ir.async_get(hass)
    await _wait_for(lambda: registry.async_get_issue(DOMAIN, "bad_secret") is not None)
    assert not client.connected
    # keeps retrying
    await _wait_for(lambda: len(server.hellos) >= 2)

    await client.stop()

    good = _client(hass, server)
    await good.start()
    await _wait_for(lambda: good.connected)
    assert registry.async_get_issue(DOMAIN, "bad_secret") is None
    await good.stop()


async def test_stop_cancels_reconnect_loop(hass: HomeAssistant, server) -> None:
    client = _client(hass, server)
    before = asyncio.all_tasks()
    await client.start()
    await _wait_for(lambda: client.connected)
    await client.stop()
    await hass.async_block_till_done()
    leftover = [t for t in asyncio.all_tasks() - before if not t.done()]
    # only tasks owned by the test server's handlers may remain
    assert not [t for t in leftover if "bridge client" in (t.get_name() or "")]
    assert client._task is None


def _record_sleeps(client: CuestClient) -> list[float]:
    sleeps: list[float] = []
    real = asyncio.sleep

    async def fake(delay: float) -> None:
        sleeps.append(delay)
        await real(0.005)

    client._sleep = fake
    return sleeps


async def test_welcome_callback_fires_on_each_connect(hass: HomeAssistant, server) -> None:
    client = _client(hass, server)
    welcomes: list[dict] = []
    client.on_message("welcome", welcomes.append)
    await client.start()
    await _wait_for(lambda: len(welcomes) == 1 and client.connected)
    await server.sockets[0].close()
    await _wait_for(lambda: len(welcomes) == 2)
    await client.stop()


async def test_backoff_doubles_and_caps(hass: HomeAssistant, caplog, socket_enabled) -> None:
    # nothing listens on this port, so every attempt fails
    srv = FakeServer()
    url = await srv.start()
    await srv.stop()
    client = CuestClient(hass, url, SECRET, initial_backoff=1, max_backoff=4)
    sleeps = _record_sleeps(client)
    await client.start()
    await _wait_for(lambda: len(sleeps) >= 5)
    assert sleeps[:5] == [1, 2, 4, 4, 4]
    assert len([r for r in caplog.records if r.levelname == "WARNING" and "unreachable" in r.message]) == 1
    await client.stop()


async def test_backoff_resets_after_welcome(hass: HomeAssistant, server, caplog) -> None:
    client = CuestClient(hass, server.url, SECRET, initial_backoff=1, max_backoff=4)
    sleeps = _record_sleeps(client)
    await client.start()
    await _wait_for(lambda: client.connected)
    await server.sockets[0].close()
    await _wait_for(lambda: len(sleeps) >= 1 and len(server.hellos) == 2)
    assert sleeps[0] == 1
    await _wait_for(lambda: client.connected)
    await client.stop()


async def test_replaced_close_does_not_reset_backoff(hass: HomeAssistant, server) -> None:
    client = CuestClient(hass, server.url, SECRET, initial_backoff=1, max_backoff=8)
    sleeps = _record_sleeps(client)
    await client.start()
    await _wait_for(lambda: client.connected)
    await server.sockets[0].close(code=4002)
    await _wait_for(lambda: len(server.hellos) == 2 and client.connected)
    await server.sockets[1].close(code=4002)
    await _wait_for(lambda: len(sleeps) >= 2)
    assert sleeps[:2] == [1, 2]
    await client.stop()


async def test_bad_secret_retries_at_max_backoff_and_logs_once(
    hass: HomeAssistant, server, caplog
) -> None:
    client = CuestClient(hass, server.url, "wrong", initial_backoff=1, max_backoff=4)
    sleeps = _record_sleeps(client)
    await client.start()
    await _wait_for(lambda: len(sleeps) >= 3)
    assert sleeps[:3] == [4, 4, 4]
    errors = [r for r in caplog.records if r.levelname == "ERROR"]
    assert len(errors) == 1
    await client.stop()


async def test_non_string_api_result_id_is_ignored(hass: HomeAssistant, server) -> None:
    client = _client(hass, server)
    await client.start()
    await _wait_for(lambda: client.connected)
    await server.sockets[0].send_json({"type": "api_result", "id": ["x"], "status": 200})
    await server.sockets[0].send_json({"type": "api_result", "id": {"a": 1}, "status": 200})
    assert await client.api("GET", "/api/players") == (200, [{"id": "p1"}])
    assert len(server.hellos) == 1
    await client.stop()


async def test_validate_accepts_good_secret(hass: HomeAssistant, server) -> None:
    await async_validate(hass, server.url, SECRET)
    assert server.hellos[0]["secret"] == SECRET


async def test_validate_rejects_bad_secret(hass: HomeAssistant, server) -> None:
    with pytest.raises(InvalidAuth):
        await async_validate(hass, server.url, "wrong")


async def test_validate_unreachable(hass: HomeAssistant, socket_enabled) -> None:
    with pytest.raises(CannotConnect):
        await async_validate(hass, "http://127.0.0.1:1", SECRET)
