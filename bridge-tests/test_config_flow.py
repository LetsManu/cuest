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


async def test_user_flow_duplicate_url_aborts(hass: HomeAssistant) -> None:
    MockConfigEntry(
        domain=DOMAIN,
        unique_id="http://cuest.local:8787",
        data={CONF_URL: "http://cuest.local:8787", CONF_SECRET: "x"},
    ).add_to_hass(hass)
    result, validate = await _start(hass, "http://CUEST.local:8787/")
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "already_configured"
    validate.assert_not_awaited()


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
    assert result["menu_options"] == ["people", "devices"]
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
    assert options == ["mobile_app_manus_iphone"]

    client.api.side_effect = [(200, []), (201, {"id": "p1"})]
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"notify_service": "mobile_app_manus_iphone"}
    )
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert dict(entry.options) == {"keep": 1}
    client.api.assert_any_await("GET", "/api/players")
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
    result = await hass.config_entries.options.async_configure(result["flow_id"], {})
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
    result = await hass.config_entries.options.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.FORM
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
    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "cannot_connect"}
    assert dict(entry.options) == {"keep": 1}
