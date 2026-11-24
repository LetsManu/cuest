"""Tests for the authenticated panel proxy endpoint."""

from conftest import PLAYER_ADA, PLAYER_BEN
import pytest

from custom_components.cuest.client import CuestNotConnected
from custom_components.cuest.const import DOMAIN


async def test_get_proxied_with_status_and_query(cuest, hass_client) -> None:
    hass, client, _ = cuest
    client.api_result = (200, [{"id": "q1"}])
    http = await hass_client()
    resp = await http.get("/api/cuest/quests?status=open&limit=5")
    assert resp.status == 200
    assert await resp.json() == [{"id": "q1"}]
    assert client.api_calls == [("GET", "/api/quests?status=open&limit=5", None)]


async def test_status_passthrough(cuest, hass_client) -> None:
    _, client, _ = cuest
    client.api_result = (409, {"error": "already_owned"})
    http = await hass_client()
    resp = await http.get("/api/cuest/shop/buy")
    assert resp.status == 409
    assert await resp.json() == {"error": "already_owned"}


async def test_post_body_forwarded(cuest, hass_client) -> None:
    _, client, _ = cuest
    client.api_result = (201, {"ok": True})
    http = await hass_client()
    resp = await http.post("/api/cuest/shop/buy", json={"itemId": "cat"})
    assert resp.status == 201
    assert client.api_calls == [("POST", "/api/shop/buy", {"itemId": "cat"})]


async def test_patch_and_delete(cuest, hass_client) -> None:
    _, client, _ = cuest
    http = await hass_client()
    await http.patch("/api/cuest/quests/q1", json={"title": "x"})
    await http.delete("/api/cuest/quests/q1")
    assert client.api_calls == [
        ("PATCH", "/api/quests/q1", {"title": "x"}),
        ("DELETE", "/api/quests/q1", None),
    ]


async def test_invalid_json_body_400(cuest, hass_client) -> None:
    _, client, _ = cuest
    http = await hass_client()
    resp = await http.post(
        "/api/cuest/quests", data="{nope", headers={"Content-Type": "application/json"}
    )
    assert resp.status == 400
    assert client.api_calls == []


async def test_non_json_server_body_wrapped(cuest, hass_client) -> None:
    _, client, _ = cuest
    client.api_result = (200, "plain")
    http = await hass_client()
    resp = await http.get("/api/cuest/health")
    assert await resp.json() == {"body": "plain"}


@pytest.mark.parametrize(
    "path",
    [
        "quests/%2e%2e%2fadmin",
        "quests/%2E%2e%2Fadmin",
        "quests%2fx",
        "quests%2Fx",
        "quests%5cx",
        "quests%5Cx",
        "quests/..%2fx",
        "Quests",
        "quests/a.b",
        "quests/a%00b",
        "quests/a%0ab",
        "quests/a b",
    ],
)
async def test_bad_paths_rejected(cuest, hass_client, path) -> None:
    _, client, _ = cuest
    http = await hass_client()
    resp = await http.get("/api/cuest/" + path)
    assert resp.status == 400
    assert client.api_calls == []


@pytest.mark.parametrize("query", ["a=%0d%0ab", "a=b%5cc", "a=%00"])
async def test_bad_query_rejected(cuest, hass_client, query) -> None:
    _, client, _ = cuest
    http = await hass_client()
    resp = await http.get("/api/cuest/quests?" + query)
    assert resp.status == 400
    assert client.api_calls == []


async def test_unauthenticated_401(cuest, hass_client_no_auth) -> None:
    _, client, _ = cuest
    http = await hass_client_no_auth()
    resp = await http.get("/api/cuest/quests")
    assert resp.status == 401
    resp = await http.get("/api/cuest_whoami")
    assert resp.status == 401
    assert client.api_calls == []


async def test_bridge_offline_503(cuest, hass_client) -> None:
    _, client, _ = cuest

    async def boom(*a, **k):
        raise CuestNotConnected

    client.api = boom
    http = await hass_client()
    resp = await http.get("/api/cuest/quests")
    assert resp.status == 503
    assert await resp.json() == {"error": "bridge_offline"}


async def test_timeout_503(cuest, hass_client) -> None:
    _, client, _ = cuest

    async def slow(*a, **k):
        raise TimeoutError

    client.api = slow
    http = await hass_client()
    resp = await http.get("/api/cuest/quests")
    assert resp.status == 503


async def test_no_entry_503(cuest, hass_client) -> None:
    hass, _, entry = cuest
    hass.data[DOMAIN].pop(entry.entry_id)
    http = await hass_client()
    resp = await http.get("/api/cuest/quests")
    assert resp.status == 503
    assert await resp.json() == {"error": "bridge_offline"}


async def _snapshot(hass, client):
    client.push({"type": "snapshot", "players": [PLAYER_BEN, PLAYER_ADA], "quests": []})
    await hass.async_block_till_done()


async def test_whoami_linked_user(cuest, hass_client, hass_admin_user) -> None:
    hass, client, _ = cuest
    await _snapshot(hass, client)
    hass.states.async_set("person.ada", "home", {"user_id": hass_admin_user.id})
    http = await hass_client()
    body = await (await http.get("/api/cuest_whoami")).json()
    assert body == {
        "playerId": "p1",
        "isAdmin": True,
        "players": [{"id": "p2", "name": "Ben"}, {"id": "p1", "name": "Ada"}],
    }


async def test_whoami_unlinked_user_null(cuest, hass_client) -> None:
    hass, client, _ = cuest
    await _snapshot(hass, client)
    http = await hass_client()
    body = await (await http.get("/api/cuest_whoami")).json()
    assert body["playerId"] is None
    assert len(body["players"]) == 2


async def test_whoami_non_admin(cuest, hass_client, hass_read_only_access_token) -> None:
    hass, client, _ = cuest
    await _snapshot(hass, client)
    http = await hass_client(hass_read_only_access_token)
    body = await (await http.get("/api/cuest_whoami")).json()
    assert body["isAdmin"] is False


async def test_whoami_no_entry(cuest, hass_client) -> None:
    hass, _, entry = cuest
    hass.data[DOMAIN].pop(entry.entry_id)
    http = await hass_client()
    resp = await http.get("/api/cuest_whoami")
    assert resp.status == 503
