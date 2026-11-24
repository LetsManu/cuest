"""Tests for the Cuest config flow and options flow."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from homeassistant.config_entries import SOURCE_USER
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.cuest.client import CannotConnect, CuestNotConnected, InvalidAuth
from custom_components.cuest.const import CONF_SECRET, CONF_URL, DOMAIN

VALIDATE = "custom_components.cuest.config_flow.async_validate"


async def _start(hass: HomeAssistant, url: str, secret: str = "s3cret", side_effect=None):
    result = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_USER}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "user"
    with patch(VALIDATE, side_effect=side_effect) as validate:
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"], {CONF_URL: url, CONF_SECRET: secret}
        )
    return result, validate


async def test_user_flow_creates_entry(hass: HomeAssistant) -> None:
    result, validate = await _start(hass, "HTTP://Cuest.Local:8787/")
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Cuest"
    assert result["data"] == {CONF_URL: "http://cuest.local:8787", CONF_SECRET: "s3cret"}
    validate.assert_awaited_once_with(hass, "http://cuest.local:8787", "s3cret")
    assert result["result"].unique_id == "http://cuest.local:8787"


@pytest.mark.parametrize(
    ("error", "key"),
    [(InvalidAuth, "invalid_auth"), (CannotConnect, "cannot_connect")],
)
async def test_user_flow_errors_then_recovers(hass: HomeAssistant, error, key) -> None:
    result, _ = await _start(hass, "http://cuest.local:8787", side_effect=error)
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": key}

    with patch(VALIDATE):
        result = await hass.config_entries.flow.async_configure(
            result["flow_id"],
            {CONF_URL: "http://cuest.local:8787", CONF_SECRET: "s3cret"},
        )
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_user_flow_second_entry_aborts(hass: HomeAssistant) -> None:
    MockConfigEntry(
        domain=DOMAIN,
        unique_id="http://cuest.local:8787",
        data={CONF_URL: "http://cuest.local:8787", CONF_SECRET: "x"},
    ).add_to_hass(hass)
    result = await hass.config_entries.flow.async_init(DOMAIN, context={"source": SOURCE_USER})
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "single_instance_allowed"


# ---- options flow ----


@pytest.fixture
async def entry_and_client(hass: HomeAssistant):
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_URL: "http://cuest.local:8787", CONF_SECRET: "s3cret"},
        options={"keep": 1},
    )
    entry.add_to_hass(hass)
    with patch("custom_components.cuest.CuestClient") as client_cls:
        client = MagicMock()
        client.start = AsyncMock()
        client.stop = AsyncMock()
        client.api = AsyncMock(return_value=(200, []))
        client_cls.return_value = client
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        yield entry, client


async def _menu(hass, entry, choice):
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.MENU
    assert result["menu_options"] == ["people", "devices", "treats"]
    return await hass.config_entries.options.async_configure(
        result["flow_id"], {"next_step_id": choice}
    )


async def test_options_people_creates_player(hass: HomeAssistant, entry_and_client) -> None:
    entry, client = entry_and_client
    hass.states.async_set("person.manu", "home", {"friendly_name": "Manu"})
    hass.services.async_register("notify", "mobile_app_manus_iphone", AsyncMock())
    hass.services.async_register("notify", "persistent_notification", AsyncMock())

    result = await _menu(hass, entry, "people")
    assert result["step_id"] == "people"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"persons": ["person.manu"]}
    )
    assert result["step_id"] == "people_phone"
    assert result["description_placeholders"] == {"person": "Manu"}
    options = result["data_schema"].schema["notify_service"].config["options"]
    assert [o["value"] for o in options] == ["none", "mobile_app_manus_iphone"]

    client.api.side_effect = [(201, {"id": "p1"})]
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"notify_service": "mobile_app_manus_iphone"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert dict(entry.options) == {"keep": 1}
    assert client.api.await_args_list[0].args == ("GET", "/api/players")
    client.api.assert_awaited_with(
        "POST",
        "/api/players",
        {"name": "Manu", "haPerson": "person.manu", "notifyService": "mobile_app_manus_iphone"},
    )


async def test_options_people_updates_existing_and_allows_no_phone(
    hass: HomeAssistant, entry_and_client
) -> None:
    entry, client = entry_and_client
    hass.states.async_set("person.manu", "home", {"friendly_name": "Manu"})
    hass.states.async_set("person.anna", "home")
    client.api.side_effect = [
        (200, [{"id": "p9", "haPerson": "person.manu", "notifyService": None}]),
        (200, {"id": "p9"}),
        (201, {"id": "p10"}),
    ]
    hass.services.async_register("notify", "mobile_app_manus_iphone", AsyncMock())

    result = await _menu(hass, entry, "people")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"persons": ["person.manu", "person.anna"]}
    )
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"notify_service": "mobile_app_manus_iphone"}
    )
    assert result["step_id"] == "people_phone"
    assert result["description_placeholders"] == {"person": "person.anna"}
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"notify_service": "none"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert client.api.await_args_list[1].args == (
        "PATCH",
        "/api/players/p9",
        {"notifyService": "mobile_app_manus_iphone"},
    )
    assert client.api.await_args_list[2].args == (
        "POST",
        "/api/players",
        {"name": "person.anna", "haPerson": "person.anna", "notifyService": None},
    )


async def test_options_people_server_down(hass: HomeAssistant, entry_and_client) -> None:
    entry, client = entry_and_client
    hass.states.async_set("person.manu", "home", {"friendly_name": "Manu"})
    client.api.side_effect = CuestNotConnected
    result = await _menu(hass, entry, "people")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"persons": ["person.manu"]}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "people"
    assert result["errors"] == {"base": "cannot_connect"}
    assert dict(entry.options) == {"keep": 1}


async def test_options_devices_accepts_selected(hass: HomeAssistant, entry_and_client) -> None:
    entry, client = entry_and_client
    client.api.side_effect = [
        (
            200,
            {
                "suggestions": [
                    {
                        "key": "a",
                        "deviceName": "Washer",
                        "templates": [{"title": "Empty the washer"}],
                        "added": False,
                    },
                    {
                        "key": "b",
                        "deviceName": "Dryer",
                        "templates": [{"title": "Empty the dryer"}],
                        "added": True,
                    },
                ]
            },
        ),
        (201, {}),
    ]
    result = await _menu(hass, entry, "devices")
    assert result["step_id"] == "devices"
    options = result["data_schema"].schema["suggestions"].config["options"]
    assert options == [{"value": "a", "label": "Washer: Empty the washer"}]
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"suggestions": ["a"]}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert client.api.await_args_list[0].args == ("GET", "/api/suggestions")
    assert client.api.await_args_list[1].args == (
        "POST",
        "/api/suggestions/accept",
        {"keys": ["a"]},
    )


async def test_options_devices_none_found(hass: HomeAssistant, entry_and_client) -> None:
    entry, client = entry_and_client
    client.api.return_value = (200, {"suggestions": []})
    result = await _menu(hass, entry, "devices")
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "no_devices"
    result = await hass.config_entries.options.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_options_devices_server_down(hass: HomeAssistant, entry_and_client) -> None:
    entry, client = entry_and_client
    client.api.side_effect = TimeoutError
    result = await _menu(hass, entry, "devices")
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "cannot_connect"
    assert dict(entry.options) == {"keep": 1}


@pytest.mark.parametrize("url", ["http://host:abc", "http://host:99999", "cuest.local:8787", "ftp://x", ""])
async def test_user_flow_invalid_url(hass: HomeAssistant, url: str) -> None:
    result, validate = await _start(hass, url)
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "invalid_url"}
    validate.assert_not_awaited()


@pytest.mark.parametrize("status", [400, 404])
async def test_options_people_server_rejects(
    hass: HomeAssistant, entry_and_client, status
) -> None:
    entry, client = entry_and_client
    hass.states.async_set("person.manu", "home", {"friendly_name": "Manu"})
    client.api.side_effect = [(200, []), (status, {"error": "x"})]
    result = await _menu(hass, entry, "people")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"persons": ["person.manu"]}
    )
    result = await hass.config_entries.options.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "people_phone"
    assert result["errors"] == {"base": "server_rejected"}


async def test_options_people_keeps_existing_phone_by_default(
    hass: HomeAssistant, entry_and_client
) -> None:
    entry, client = entry_and_client
    hass.states.async_set("person.manu", "home", {"friendly_name": "Manu"})
    hass.services.async_register("notify", "mobile_app_manus_iphone", AsyncMock())
    client.api.side_effect = [
        (200, [{"id": "p9", "haPerson": "person.manu", "notifyService": "mobile_app_manus_iphone"}]),
        (200, {"id": "p9"}),
    ]
    result = await _menu(hass, entry, "people")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"persons": ["person.manu"]}
    )
    assert result["data_schema"]({}) == {"notify_service": "mobile_app_manus_iphone"}
    result = await hass.config_entries.options.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert client.api.await_args_list[1].args[2] == {
        "notifyService": "mobile_app_manus_iphone"
    }


async def test_options_people_none_available(hass: HomeAssistant, entry_and_client) -> None:
    entry, _ = entry_and_client
    result = await _menu(hass, entry, "people")
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "no_people"


async def test_options_devices_accept_fails_reshows_list_with_error(
    hass: HomeAssistant, entry_and_client
) -> None:
    entry, client = entry_and_client
    sugg = {"suggestions": [{"key": "a", "deviceName": "W", "templates": [{"title": "T"}]}]}
    client.api.side_effect = [(200, sugg), CuestNotConnected, (200, sugg)]
    result = await _menu(hass, entry, "devices")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"suggestions": ["a"]}
    )
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "devices"
    assert result["errors"] == {"base": "cannot_connect"}
    assert "suggestions" in result["data_schema"].schema


async def test_options_devices_accept_fails_then_refetch_fails_aborts(
    hass: HomeAssistant, entry_and_client
) -> None:
    entry, client = entry_and_client
    sugg = {"suggestions": [{"key": "a", "deviceName": "W", "templates": [{"title": "T"}]}]}
    client.api.side_effect = [(200, sugg), (500, {}), CuestNotConnected]
    result = await _menu(hass, entry, "devices")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"suggestions": ["a"]}
    )
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "cannot_connect"


async def test_user_flow_strips_whitespace(hass: HomeAssistant) -> None:
    result, validate = await _start(hass, "http://cuest.local:8787 ", " s3cret ")
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {CONF_URL: "http://cuest.local:8787", CONF_SECRET: "s3cret"}
    validate.assert_awaited_once_with(hass, "http://cuest.local:8787", "s3cret")


# ---- house treats ----


def _unlock(uid, entity, name="Old", cost=30, enabled=True):
    return {"id": uid, "name": name, "cost": cost, "entityId": entity, "enabled": enabled}


async def test_options_treats_creates_unlocks_and_stores_allowlist(
    hass: HomeAssistant, entry_and_client
) -> None:
    entry, client = entry_and_client
    hass.states.async_set("script.gaming_pc", "off", {"friendly_name": "Gaming PC"})
    hass.states.async_set("scene.movie", "off")
    client.api.side_effect = None
    client.api.return_value = (200, [])

    result = await _menu(hass, entry, "treats")
    assert result["step_id"] == "treats"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"entities": ["script.gaming_pc", "scene.movie"]}
    )
    assert result["step_id"] == "treats_item"
    assert result["description_placeholders"] == {"entity": "Gaming PC"}
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"name": "Gaming PC for 1 hour", "cost": 60}
    )
    assert result["step_id"] == "treats_item"
    assert result["description_placeholders"] == {"entity": "scene.movie"}
    client.api.return_value = (201, {"id": "u"})
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"name": "scene.movie", "cost": 50}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert dict(entry.options) == {"keep": 1, "treats": ["script.gaming_pc", "scene.movie"]}
    calls = [c.args for c in client.api.await_args_list]
    assert ("GET", "/api/unlocks") in calls
    assert (
        "POST",
        "/api/unlocks",
        {"name": "Gaming PC for 1 hour", "cost": 60, "entityId": "script.gaming_pc"},
    ) in calls
    assert (
        "POST",
        "/api/unlocks",
        {"name": "scene.movie", "cost": 50, "entityId": "scene.movie"},
    ) in calls


async def test_options_treats_updates_reenables_and_disables_removed(
    hass: HomeAssistant, entry_and_client
) -> None:
    entry, client = entry_and_client
    hass.config_entries.async_update_entry(
        entry, options={"keep": 1, "treats": ["script.a", "script.b"]}
    )
    client.api.side_effect = None
    client.api.return_value = (
        200,
        [
            _unlock("u1", "script.a", "Old A", 40),
            _unlock("u2", "script.b"),
            _unlock("u3", "scene.c", enabled=False),
        ],
    )
    result = await _menu(hass, entry, "treats")
    schema_default = [k for k in result["data_schema"].schema if k == "entities"][0].default()
    assert schema_default == ["script.a", "script.b"]
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"entities": ["script.a", "scene.c"]}
    )
    # existing unlock values pre-fill the form
    key = {str(k): k for k in result["data_schema"].schema}
    assert key["name"].default() == "Old A"
    assert key["cost"].default() == 40
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"name": "Movie A", "cost": 45}
    )
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"name": "Scene C", "cost": 100}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert dict(entry.options) == {"keep": 1, "treats": ["script.a", "scene.c"]}
    calls = [c.args for c in client.api.await_args_list]
    assert ("PATCH", "/api/unlocks/u1", {"name": "Movie A", "cost": 45, "enabled": True}) in calls
    assert ("PATCH", "/api/unlocks/u3", {"name": "Scene C", "cost": 100, "enabled": True}) in calls
    assert ("DELETE", "/api/unlocks/u2") in calls
    assert not any(c[0] == "POST" for c in calls)


async def test_options_treats_server_down(hass: HomeAssistant, entry_and_client) -> None:
    entry, client = entry_and_client
    hass.states.async_set("script.a", "off")
    client.api.side_effect = CuestNotConnected
    result = await _menu(hass, entry, "treats")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"entities": ["script.a"]}
    )
    assert result["step_id"] == "treats"
    assert result["errors"] == {"base": "cannot_connect"}
    client.api.side_effect = None
    client.api.return_value = (500, {})
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"entities": ["script.a"]}
    )
    assert result["errors"] == {"base": "server_rejected"}
    assert "treats" not in entry.options


async def test_options_treats_retry_after_partial_failure_no_duplicates(
    hass: HomeAssistant, entry_and_client
) -> None:
    entry, client = entry_and_client
    hass.states.async_set("script.a", "off")
    hass.states.async_set("script.b", "off")
    server: list[dict] = []
    posts: list[str] = []
    fail_next = {"b": True}

    async def api(method, path, body=None):
        if method == "GET":
            return 200, [dict(u) for u in server]
        if method == "POST":
            if body["entityId"] == "script.b" and fail_next["b"]:
                fail_next["b"] = False
                return 500, {}
            posts.append(body["entityId"])
            server.append({"id": f"id-{body['entityId']}", "enabled": True, **body})
            return 201, {}
        return 200, {}

    client.api.side_effect = api
    result = await _menu(hass, entry, "treats")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"entities": ["script.a", "script.b"]}
    )
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"name": "A", "cost": 50}
    )
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"name": "B", "cost": 50}
    )
    assert result["step_id"] == "treats_item"
    assert result["errors"] == {"base": "server_rejected"}
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"name": "B", "cost": 50}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert sorted(posts) == ["script.a", "script.b"]
    assert len(server) == 2


async def test_options_treats_empty_selection_disables_all(
    hass: HomeAssistant, entry_and_client
) -> None:
    entry, client = entry_and_client
    hass.config_entries.async_update_entry(entry, options={"keep": 1, "treats": ["script.a"]})
    client.api.side_effect = None
    client.api.return_value = (200, [_unlock("u1", "script.a")])
    result = await _menu(hass, entry, "treats")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"entities": []}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert dict(entry.options) == {"keep": 1, "treats": []}
    assert ("DELETE", "/api/unlocks/u1") in [c.args for c in client.api.await_args_list]
