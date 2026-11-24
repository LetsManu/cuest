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
    client.api_result = (404, {"error": "not_found"})
    http = await hass_client()
    resp = await http.get("/api/cuest/quests/zzz")
    assert resp.status == 404
    assert await resp.json() == {"error": "not_found"}


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
        "quests//x",
        "quests/",
    ],
)
async def test_bad_paths_rejected(cuest, hass_client, path) -> None:
    _, client, _ = cuest
    http = await hass_client()
    resp = await http.get("/api/cuest/" + path)
    assert resp.status == 400
    assert client.api_calls == []


@pytest.mark.parametrize("query", ["a=%0d%0ab", "a=b%5cc", "a=%00", "a=%5C"])
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


async def test_empty_body_forwarded_as_none(cuest, hass_client) -> None:
    _, client, _ = cuest
    http = await hass_client()
    resp = await http.post("/api/cuest/quests/q1/later")
    assert resp.status == 200
    assert client.api_calls == [("POST", "/api/quests/q1/later", None)]


async def test_body_too_large_413(cuest, hass_client) -> None:
    _, client, _ = cuest
    http = await hass_client()
    resp = await http.post(
        "/api/cuest/quests", data=b'{"a":"' + b"x" * 70000 + b'"}',
        headers={"Content-Type": "application/json"},
    )
    assert resp.status == 413
    assert await resp.json() == {"error": "too_large"}
    assert client.api_calls == []


async def test_put_405(cuest, hass_client) -> None:
    http = await hass_client()
    resp = await http.put("/api/cuest/quests/q1", json={})
    assert resp.status == 405


async def test_non_admin_may_play(cuest, hass_client, hass_read_only_access_token) -> None:
    _, client, _ = cuest
    http = await hass_client(hass_read_only_access_token)
    assert (await http.get("/api/cuest/quests")).status == 200
    plays = (
        "quests/q1/start", "quests/q1/done", "quests/q1/later", "shop/buy", "shop/equip",
        "shop/open-chest", "sprint/start", "sprint/log", "sprint/finish", "dice/accept",
    )
    for p in plays:
        assert (await http.post("/api/cuest/" + p, json={})).status == 200
    assert len(client.api_calls) == 1 + len(plays)


@pytest.mark.parametrize(
    "method,path",
    [
        ("patch", "unlocks/u1"),
        ("delete", "quests/q1"),
        ("post", "templates"),
        ("post", "players"),
        ("post", "suggestions"),
        ("post", "quests/q1/done/x"),
        ("patch", "settings"),
        ("post", "settings"),
        ("post", "sprint/start/x"),
        ("post", "sprint"),
        ("post", "dice"),
        ("post", "dice/roll"),
        ("post", "shop/open-chest/x"),
    ],
)
async def test_non_admin_writes_403(
    cuest, hass_client, hass_read_only_access_token, method, path
) -> None:
    _, client, _ = cuest
    http = await hass_client(hass_read_only_access_token)
    resp = await getattr(http, method)("/api/cuest/" + path)
    assert resp.status == 403
    assert await resp.json() == {"error": "admin_only"}
    assert client.api_calls == []


async def test_admin_patch_unlocks_forwarded(cuest, hass_client) -> None:
    _, client, _ = cuest
    http = await hass_client()
    resp = await http.patch("/api/cuest/unlocks/u1", json={"cost": 5})
    assert resp.status == 200
    assert client.api_calls == [("PATCH", "/api/unlocks/u1", {"cost": 5})]


@pytest.mark.parametrize("q", ["a=%2e%2e", "a=%2E", "a=%2f", "a=%2F"])
def test_query_encoded_dots_slashes_rejected(q) -> None:
    from aiohttp.test_utils import make_mocked_request

    from custom_components.cuest.http import _valid_query

    assert not _valid_query(make_mocked_request("GET", "/api/cuest/x?" + q))
    assert _valid_query(make_mocked_request("GET", "/api/cuest/x?a=b&c=d"))


_BOUND = [
    "quests/q1/start", "quests/q1/done", "shop/buy", "shop/equip", "shop/open-chest",
    "sprint/start", "sprint/log", "sprint/finish", "dice/accept",
]


@pytest.mark.parametrize("path", _BOUND)
async def test_linked_non_admin_must_use_own_player(
    cuest, hass_client, hass_read_only_user, hass_read_only_access_token, path
) -> None:
    hass, client, _ = cuest
    await _snapshot(hass, client)
    hass.states.async_set("person.ada", "home", {"user_id": hass_read_only_user.id})
    http = await hass_client(hass_read_only_access_token)
    for body in ({"playerId": "p2"}, {}):
        resp = await http.post("/api/cuest/" + path, json=body)
        assert resp.status == 403
        assert await resp.json() == {"error": "not_your_player"}
    assert client.api_calls == []
    assert (await http.post("/api/cuest/" + path, json={"playerId": "p1"})).status == 200
    assert len(client.api_calls) == 1


async def test_linked_admin_and_unlinked_non_admin_may_pick_any_player(
    cuest, hass_client, hass_admin_user, hass_read_only_access_token
) -> None:
    hass, client, _ = cuest
    await _snapshot(hass, client)
    hass.states.async_set("person.ada", "home", {"user_id": hass_admin_user.id})
    admin = await hass_client()
    assert (await admin.post("/api/cuest/shop/buy", json={"playerId": "p2"})).status == 200
    shared = await hass_client(hass_read_only_access_token)
    assert (await shared.post("/api/cuest/shop/buy", json={"playerId": "p2"})).status == 200


async def test_admin_patch_settings_forwarded(cuest, hass_client) -> None:
    _, client, _ = cuest
    http = await hass_client()
    body = {"celebrationLights": ["light.hall"], "sprintScene": None}
    assert (await http.patch("/api/cuest/settings", json=body)).status == 200
    assert client.api_calls == [("PATCH", "/api/settings", body)]


async def test_non_admin_can_read_settings_but_not_write(
    cuest, hass_client, hass_read_only_access_token
) -> None:
    _, client, _ = cuest
    http = await hass_client(hass_read_only_access_token)
    assert (await http.get("/api/cuest/settings")).status == 200
    assert (await http.patch("/api/cuest/settings", json={"sprintScene": None})).status == 403
    assert client.api_calls == [("GET", "/api/settings", None)]
