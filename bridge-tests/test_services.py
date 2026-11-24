"""Tests for cuest.complete_quest and cuest.start_quest."""

from conftest import PLAYER_ADA, PLAYER_BEN, quest
import pytest

from homeassistant.exceptions import ServiceValidationError

from custom_components.cuest.const import DOMAIN


async def _setup(hass, client):
    client.push({
        "type": "snapshot",
        "players": [PLAYER_BEN, PLAYER_ADA],
        "quests": [
            quest("q1", "Empty the washer", "2026-01-01T10:00:00.000Z"),
            quest("q2", "Empty the washer", "2026-01-02T10:00:00.000Z"),
        ],
    })
    await hass.async_block_till_done()


async def test_complete_by_template_title_newest_and_person(cuest) -> None:
    hass, client, _ = cuest
    await _setup(hass, client)
    await hass.services.async_call(
        DOMAIN, "complete_quest",
        {"template_title": "empty THE washer", "person": "person.ada"}, blocking=True,
    )
    assert client.api_calls == [("POST", "/api/quests/q2/done", {"playerId": "p1"})]


async def test_start_by_quest_id(cuest) -> None:
    hass, client, _ = cuest
    await _setup(hass, client)
    await hass.services.async_call(DOMAIN, "start_quest", {"quest_id": "q1"}, blocking=True)
    assert client.api_calls == [("POST", "/api/quests/q1/start", {"playerId": "p2"})]


@pytest.mark.parametrize("data", [{"template_title": "Nope"}, {"quest_id": "zzz"}, {}])
async def test_unknown_quest_raises(cuest, data) -> None:
    hass, client, _ = cuest
    await _setup(hass, client)
    with pytest.raises(ServiceValidationError) as err:
        await hass.services.async_call(DOMAIN, "complete_quest", data, blocking=True)
    assert err.value.translation_key == "quest_not_found"
    assert client.api_calls == []


async def test_services_removed_on_unload(cuest) -> None:
    hass, _, entry = cuest
    assert hass.services.has_service(DOMAIN, "complete_quest")
    await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert not hass.services.has_service(DOMAIN, "complete_quest")
