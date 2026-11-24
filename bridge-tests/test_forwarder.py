"""Tests for the Cuest forwarder."""

from collections.abc import Callable
from datetime import UTC, datetime

import pytest

from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import async_mock_service

from custom_components.cuest.client import CuestNotConnected
from custom_components.cuest.forwarder import Forwarder


class FakeClient:
    """Records sent messages and lets tests invoke registered callbacks."""

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


@pytest.fixture
async def setup(hass: HomeAssistant):
    client = FakeClient()
    forwarder = Forwarder(hass, client)
    await forwarder.async_start()
    yield hass, client, forwarder
    await forwarder.async_stop()


def _subscribe(client: FakeClient, entities: list[str]) -> None:
    client.callbacks["subscribe"]({"type": "subscribe", "entities": entities})


async def test_state_transition_forwarded(setup) -> None:
    hass, client, _ = setup
    hass.states.async_set("sensor.washer", "running")
    _subscribe(client, ["sensor.washer"])
    await hass.async_block_till_done()
    assert client.sent == []  # no replay on subscribe

    hass.states.async_set("sensor.washer", "finished")
    await hass.async_block_till_done()
    assert len(client.sent) == 1
    msg = client.sent[0]
    last_changed = hass.states.get("sensor.washer").last_changed
    assert msg == {
        "type": "state",
        "entityId": "sensor.washer",
        "oldState": "running",
        "newState": "finished",
        "at": last_changed.isoformat(),
    }
    assert msg["at"].endswith("+00:00")


async def test_attribute_only_change_not_forwarded(setup) -> None:
    hass, client, _ = setup
    hass.states.async_set("sensor.washer", "running", {"a": 1})
    _subscribe(client, ["sensor.washer"])
    await hass.async_block_till_done()
    hass.states.async_set("sensor.washer", "running", {"a": 2})
    await hass.async_block_till_done()
    assert client.sent == []


async def test_new_entity_without_old_state_not_forwarded(setup) -> None:
    hass, client, _ = setup
    _subscribe(client, ["sensor.new"])
    hass.states.async_set("sensor.new", "on")
    await hass.async_block_till_done()
    assert client.sent == []


async def test_resubscribe_replaces_listeners(setup) -> None:
    hass, client, _ = setup
    hass.states.async_set("sensor.washer", "a")
    hass.states.async_set("sensor.dryer", "a")
    _subscribe(client, ["sensor.washer"])
    _subscribe(client, ["sensor.washer", "sensor.dryer"])
    await hass.async_block_till_done()

    hass.states.async_set("sensor.washer", "b")
    await hass.async_block_till_done()
    assert len(client.sent) == 1

    _subscribe(client, ["sensor.dryer"])
    hass.states.async_set("sensor.washer", "c")
    hass.states.async_set("sensor.dryer", "b")
    await hass.async_block_till_done()
    assert [m["entityId"] for m in client.sent] == ["sensor.washer", "sensor.dryer"]


async def test_send_while_disconnected_is_dropped(setup) -> None:
    hass, client, _ = setup
    hass.states.async_set("sensor.washer", "a")
    _subscribe(client, ["sensor.washer"])
    client.connected = False
    hass.states.async_set("sensor.washer", "b")
    await hass.async_block_till_done()
    assert client.sent == []


async def test_notification_action_forwarded(setup) -> None:
    hass, client, _ = setup
    hass.bus.async_fire("mobile_app_notification_action", {"action": "CUEST|DONE|q1|p1"})
    hass.bus.async_fire("mobile_app_notification_action", {"action": "OTHER"})
    hass.bus.async_fire("mobile_app_notification_action", {})
    await hass.async_block_till_done()
    assert len(client.sent) == 1
    msg = client.sent[0]
    assert msg["type"] == "notification_action"
    assert msg["action"] == "CUEST|DONE|q1|p1"
    assert msg["at"].endswith("+00:00")


async def test_notification_action_uses_time_fired(setup) -> None:
    hass, client, _ = setup
    fired = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    hass.bus.async_fire(
        "mobile_app_notification_action", {"action": "CUEST|DONE|q|p"}, time_fired=fired.timestamp()
    )
    await hass.async_block_till_done()
    assert client.sent[0]["at"] == fired.isoformat()


async def test_call_service_non_string_domain_refused(setup) -> None:
    hass, client, _ = setup
    client.callbacks["call_service"](
        {"type": "call_service", "id": "9", "domain": ["light"], "service": "turn_on"}
    )
    await hass.async_block_till_done()
    assert client.sent == [
        {"type": "result", "id": "9", "ok": False, "error": "domain_not_allowed"}
    ]


async def test_malformed_subscribe_ignored(setup) -> None:
    hass, client, _ = setup
    hass.states.async_set("sensor.washer", "a")
    _subscribe(client, ["sensor.washer"])
    client.callbacks["subscribe"]({"type": "subscribe", "entities": "sensor.washer"})
    hass.states.async_set("sensor.washer", "b")
    await hass.async_block_till_done()
    assert len(client.sent) == 1  # previous subscription kept


async def test_subscribe_after_stop_registers_nothing(hass: HomeAssistant) -> None:
    client = FakeClient()
    forwarder = Forwarder(hass, client)
    await forwarder.async_start()
    await forwarder.async_stop()
    hass.states.async_set("sensor.washer", "a")
    _subscribe(client, ["sensor.washer"])
    hass.states.async_set("sensor.washer", "b")
    await hass.async_block_till_done()
    assert client.sent == []


async def test_call_service_domain_not_allowed(setup) -> None:
    hass, client, _ = setup
    calls = async_mock_service(hass, "switch", "turn_on")
    client.callbacks["call_service"](
        {"type": "call_service", "id": "1", "domain": "switch", "service": "turn_on"}
    )
    await hass.async_block_till_done()
    assert calls == []
    assert client.sent == [
        {"type": "result", "id": "1", "ok": False, "error": "domain_not_allowed"}
    ]


async def test_call_service_light_executed(setup) -> None:
    hass, client, _ = setup
    calls = async_mock_service(hass, "light", "turn_on")
    client.callbacks["call_service"](
        {
            "type": "call_service",
            "id": "2",
            "domain": "light",
            "service": "turn_on",
            "data": {"brightness": 100},
            "target": {"entity_id": "light.hall"},
        }
    )
    await hass.async_block_till_done()
    assert len(calls) == 1
    assert calls[0].data["brightness"] == 100
    assert calls[0].data["entity_id"] == "light.hall"
    assert client.sent == [{"type": "result", "id": "2", "ok": True}]


async def test_call_service_unknown_service_fails(setup) -> None:
    hass, client, _ = setup
    client.callbacks["call_service"](
        {"type": "call_service", "id": "3", "domain": "notify", "service": "nope"}
    )
    await hass.async_block_till_done()
    assert len(client.sent) == 1
    assert client.sent[0]["id"] == "3"
    assert client.sent[0]["ok"] is False
    assert client.sent[0]["error"]


async def test_stop_removes_listeners(hass: HomeAssistant) -> None:
    client = FakeClient()
    forwarder = Forwarder(hass, client)
    await forwarder.async_start()
    hass.states.async_set("sensor.washer", "a")
    _subscribe(client, ["sensor.washer"])
    await forwarder.async_stop()
    hass.states.async_set("sensor.washer", "b")
    hass.bus.async_fire("mobile_app_notification_action", {"action": "CUEST|X"})
    await hass.async_block_till_done()
    assert client.sent == []
