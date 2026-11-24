"""Shared fixtures for the Cuest bridge tests."""

import pytest
from unittest.mock import patch

from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.cuest.const import CONF_SECRET, CONF_URL, DOMAIN


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Enable loading custom integrations in all tests."""
    yield


class FakeCuestClient:
    """Stands in for CuestClient: records callbacks and api calls."""

    def __init__(self) -> None:
        self.callbacks = {}
        self.api_calls = []
        self.api_result = (200, {})
        self.connected = True

    def on_message(self, type, cb):
        self.callbacks[type] = cb

    async def start(self):
        pass

    async def stop(self):
        pass

    async def send(self, msg):
        pass

    async def api(self, method, path, body=None, timeout=10):
        self.api_calls.append((method, path, body))
        return self.api_result

    def push(self, msg):
        self.callbacks[msg["type"]](msg)


PLAYER_ADA = {
    "id": "p1", "name": "Ada", "haPerson": "person.ada", "level": 3,
    "title": "Squire", "xp": 120, "gold": 15, "intoLevel": 20, "toNext": 80,
}
PLAYER_BEN = {
    "id": "p2", "name": "Ben", "haPerson": None, "level": 1,
    "title": "Page", "xp": 5, "gold": 0, "intoLevel": 5, "toNext": 95,
}


def quest(qid, title, created="2026-01-01T10:00:00.000Z", status="open"):
    return {
        "id": qid, "title": title, "status": status, "claimedBy": None,
        "xp": 10, "minutes": 5, "templateId": None, "createdAt": created,
    }


@pytest.fixture
async def cuest(hass):
    """A set-up Cuest entry backed by a fake client."""
    client = FakeCuestClient()
    entry = MockConfigEntry(domain=DOMAIN, data={CONF_URL: "http://x:1", CONF_SECRET: "s"})
    entry.add_to_hass(hass)
    with patch("custom_components.cuest.CuestClient", return_value=client):
        assert await hass.config_entries.async_setup(entry.entry_id)
        await hass.async_block_till_done()
        yield hass, client, entry
        await hass.config_entries.async_unload(entry.entry_id)
        await hass.async_block_till_done()
