"""Tests for Cuest sensors and events."""

from conftest import PLAYER_ADA, PLAYER_BEN, quest
from pytest_homeassistant_custom_component.common import async_capture_events

from homeassistant.helpers import entity_registry as er


async def _push(hass, client, players, quests):
    client.push({"type": "snapshot", "players": players, "quests": quests})
    await hass.async_block_till_done()


def _entity(hass, unique_id):
    reg = er.async_get(hass)
    eid = next(e.entity_id for e in reg.entities.values() if e.unique_id == unique_id)
    return hass.states.get(eid)


async def test_snapshot_creates_and_updates_sensors(cuest) -> None:
    hass, client, _ = cuest
    assert _entity(hass, "cuest_open_quests").state == "0"
    await _push(hass, client, [PLAYER_ADA], [quest("q1", "Dishes"), quest("q2", "Bins", status="whenever")])

    level = _entity(hass, "cuest_p1_level")
    assert level.state == "3"
    assert level.attributes["title"] == "Squire"
    assert level.attributes["into_level"] == 20
    assert level.attributes["to_next"] == 80
    assert level.attributes["player_name"] == "Ada"
    assert level.attributes["cuest_player_id"] == "p1"
    assert level.attributes["ha_person"] == "person.ada"
    assert _entity(hass, "cuest_p1_xp").state == "120"
    assert _entity(hass, "cuest_p1_gold").state == "15"
    assert _entity(hass, "cuest_p1_gold").attributes["cuest_player_id"] == "p1"
    open_q = _entity(hass, "cuest_open_quests")
    assert open_q.state == "1"
    assert open_q.attributes["quests"] == ["Dishes"]

    await _push(hass, client, [{**PLAYER_ADA, "xp": 130, "level": 4}], [])
    assert _entity(hass, "cuest_p1_xp").state == "130"
    assert _entity(hass, "cuest_p1_level").state == "4"
    assert _entity(hass, "cuest_open_quests").state == "0"


async def test_new_player_adds_sensors_once(cuest) -> None:
    hass, client, _ = cuest
    await _push(hass, client, [PLAYER_ADA], [])
    await _push(hass, client, [PLAYER_ADA, PLAYER_BEN], [])
    await _push(hass, client, [PLAYER_ADA, PLAYER_BEN], [])
    reg = er.async_get(hass)
    ids = [e.unique_id for e in reg.entities.values() if e.platform == "cuest"]
    assert len(ids) == len(set(ids))
    assert sorted(i for i in ids if i.startswith("cuest_p")) == sorted(
        f"cuest_{p}_{k}" for p in ("p1", "p2") for k in ("level", "xp", "gold")
    )
    ben = _entity(hass, "cuest_p2_level")
    assert ben.attributes["ha_person"] is None


async def test_fire_event_reaches_bus(cuest) -> None:
    hass, client, _ = cuest
    events = async_capture_events(hass, "cuest_level_up")
    other = async_capture_events(hass, "evil_event")
    client.push({"type": "fire_event", "event": "cuest_level_up", "data": {"playerId": "p1", "level": 4}})
    client.push({"type": "fire_event", "event": "evil_event", "data": {}})
    await hass.async_block_till_done()
    assert [e.data for e in events] == [{"playerId": "p1", "level": 4}]
    assert other == []
