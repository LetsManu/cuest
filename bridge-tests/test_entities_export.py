"""Tests for the Cuest entity export."""

import asyncio
from collections.abc import Callable
from datetime import timedelta
import json

import pytest

from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.cuest.client import CuestNotConnected
from custom_components.cuest.entities_export import (
    EntityExporter,
    async_send_entities,
    build_entity_infos,
    chunk_entity_infos,
)


class FakeClient:
    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.callbacks: dict[str, Callable[[dict], None]] = {}
        self.connected = True

    def on_message(self, type: str, cb: Callable[[dict], None]) -> None:
        self.callbacks[type] = cb

    async def send(self, msg: dict) -> None:
        if not self.connected:
            raise CuestNotConnected
        self.sent.append(msg)


def _register_washer(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(domain="miele")
    entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={("miele", "w1")},
        name="Washer",
        manufacturer="Miele",
        model="WWB",
    )
    er.async_get(hass).async_get_or_create(
        "sensor",
        "miele",
        "w1_status",
        config_entry=entry,
        device_id=device.id,
        original_device_class="enum",
        translation_key="status",
        original_name="Status",
    )
    hass.states.async_set(
        "sensor.washer_status", "running", {"options": ["running", "finished"]}
    )


async def test_build_infos(hass: HomeAssistant) -> None:
    _register_washer(hass)
    registry = er.async_get(hass)
    entity_id = next(iter(registry.entities))
    # state was set under a fixed id; align with the registered id
    hass.states.async_set(entity_id, "running", {"options": ["running", "finished"]})
    hass.states.async_set("light.hall", "on")
    hass.states.async_set("sensor.template", "5", {"unit_of_measurement": "W", "friendly_name": "T"})

    infos = {i["entityId"]: i for i in build_entity_infos(hass)}
    assert "light.hall" not in infos
    washer = infos[entity_id]
    assert washer["deviceName"] == "Washer"
    assert washer["manufacturer"] == "Miele"
    assert washer["model"] == "WWB"
    assert washer["options"] == ["running", "finished"]
    assert washer["deviceClass"] == "enum"
    assert washer["platform"] == "miele"
    assert washer["translationKey"] == "status"
    assert washer["domain"] == "sensor"
    assert washer["state"] == "running"
    assert washer["name"] == "Status"
    tpl = infos["sensor.template"]
    assert tpl["unit"] == "W"
    assert tpl["name"] == "T"
    assert tpl["platform"] is None and tpl["deviceId"] is None
    assert tpl["options"] is None


def test_chunking_large_set() -> None:
    infos = [
        {"entityId": f"sensor.e{i}", "name": "x" * 40, "state": "on", "options": None}
        for i in range(3000)
    ]
    chunks = chunk_entity_infos(infos)
    assert len(chunks) > 1
    assert [e for c in chunks for e in c] == infos
    for idx, chunk in enumerate(chunks):
        msg = {"type": "entities", "chunk": idx, "last": idx == len(chunks) - 1, "entities": chunk}
        assert len(json.dumps(msg)) < 48_000


def test_chunking_empty() -> None:
    assert chunk_entity_infos([]) == [[]]


async def test_send_empty_and_last_flag(hass: HomeAssistant) -> None:
    client = FakeClient()
    await async_send_entities(hass, client)
    assert client.sent == [{"type": "entities", "chunk": 0, "last": True, "entities": []}]


async def test_send_not_connected(hass: HomeAssistant) -> None:
    client = FakeClient()
    client.connected = False
    await async_send_entities(hass, client)
    assert client.sent == []


@pytest.fixture
async def exporter(hass: HomeAssistant):
    client = FakeClient()
    exp = EntityExporter(hass, client, delay=10)
    await exp.async_start()
    yield hass, client, exp
    await exp.async_stop()


async def test_resent_on_every_welcome(exporter) -> None:
    hass, client, _ = exporter
    hass.states.async_set("sensor.a", "1")
    client.callbacks["welcome"]({"type": "welcome"})
    await hass.async_block_till_done()
    assert len(client.sent) == 1
    client.callbacks["welcome"]({"type": "welcome"})
    await hass.async_block_till_done()
    assert len(client.sent) == 2
    assert client.sent[1]["entities"][0]["entityId"] == "sensor.a"


async def test_registry_change_debounced(exporter) -> None:
    hass, client, _ = exporter
    _register_washer(hass)
    _register_washer_two(hass)
    await hass.async_block_till_done()
    assert client.sent == []
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=11))
    await hass.async_block_till_done()
    assert len(client.sent) == 1


def _register_washer_two(hass: HomeAssistant) -> None:
    er.async_get(hass).async_get_or_create("sensor", "miele", "w2_status")


async def test_stop_cancels_pending(exporter) -> None:
    hass, client, exp = exporter
    _register_washer(hass)
    await hass.async_block_till_done()
    await exp.async_stop()
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=30))
    await hass.async_block_till_done()
    assert client.sent == []


async def test_disabled_entries_skipped(hass: HomeAssistant) -> None:
    entry = MockConfigEntry(domain="miele")
    entry.add_to_hass(hass)
    er.async_get(hass).async_get_or_create(
        "sensor",
        "miele",
        "off",
        config_entry=entry,
        suggested_object_id="off",
        disabled_by=er.RegistryEntryDisabler.USER,
    )
    hass.states.async_set("sensor.off", "1")
    assert "sensor.off" not in {i["entityId"] for i in build_entity_infos(hass)}


class SlowClient(FakeClient):
    async def send(self, msg: dict) -> None:
        await asyncio.sleep(0)
        await super().send(msg)
        await asyncio.sleep(0)


async def test_overlapping_sends_do_not_interleave(hass: HomeAssistant) -> None:
    for i in range(3000):
        hass.states.async_set(f"sensor.s{i}", "x" * 20, {"friendly_name": "n" * 20})
    client = SlowClient()
    await asyncio.gather(
        async_send_entities(hass, client), async_send_entities(hass, client)
    )
    chunks = [m["chunk"] for m in client.sent]
    n = len(chunks) // 2
    assert n > 1
    assert chunks == list(range(n)) * 2
    assert [m["last"] for m in client.sent].count(True) == 2
    assert [m["chunk"] for m in client.sent if m["last"]] == [n - 1, n - 1]


def test_oversized_info_drops_options_then_skipped() -> None:
    big_opts = {"entityId": "sensor.a", "options": ["o" * 100] * 50}
    big_name = {"entityId": "sensor.b", "name": "n" * 1500, "options": None}
    ok = {"entityId": "sensor.c", "options": None}
    chunks = chunk_entity_infos([big_opts, big_name, ok], max_bytes=1000)
    flat = [e for c in chunks for e in c]
    assert [e["entityId"] for e in flat] == ["sensor.a", "sensor.c"]
    assert flat[0]["options"] is None
