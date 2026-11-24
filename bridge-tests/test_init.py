"""Tests for setting up and unloading the Cuest integration."""

from unittest.mock import AsyncMock, MagicMock, patch

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.cuest.const import CONF_SECRET, CONF_URL, DOMAIN


async def test_setup_and_unload_entry(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(
        domain=DOMAIN,
        data={CONF_URL: "http://cuest.local:8080", CONF_SECRET: "s3cret"},
    )
    entry.add_to_hass(hass)

    with patch("custom_components.cuest.CuestClient") as client_cls:
        client = MagicMock()
        client.start = AsyncMock()
        client.stop = AsyncMock()
        client_cls.return_value = client

        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        assert entry.state is ConfigEntryState.LOADED
        client_cls.assert_called_once_with(hass, "http://cuest.local:8080", "s3cret")
        client.start.assert_awaited_once()
        assert hass.data[DOMAIN][entry.entry_id]["client"] is client

        assert await hass.config_entries.async_unload(entry.entry_id)
        await hass.async_block_till_done()
        client.stop.assert_awaited_once()
        assert entry.state is ConfigEntryState.NOT_LOADED
        assert DOMAIN not in hass.data
