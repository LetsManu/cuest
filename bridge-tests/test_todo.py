"""Tests for the Cuest to-do list."""

from conftest import PLAYER_ADA, PLAYER_BEN, quest

from homeassistant.core import Context
from homeassistant.exceptions import HomeAssistantError
import pytest


async def _setup(hass, client):
    client.push({
        "type": "snapshot",
        "players": [PLAYER_BEN, PLAYER_ADA],
        "quests": [quest("q1", "Dishes"), quest("q2", "Bins")],
    })
    await hass.async_block_till_done()


async def _complete(hass, uid, context=None):
    await hass.services.async_call(
        "todo", "update_item", {"entity_id": "todo.cuest_quests", "item": uid, "status": "completed"},
        blocking=True, context=context,
    )


async def test_todo_lists_quests(cuest) -> None:
    hass, client, _ = cuest
    await _setup(hass, client)
    state = hass.states.get("todo.cuest_quests")
    assert state.state == "2"
    resp = await hass.services.async_call(
        "todo", "get_items", {"entity_id": "todo.cuest_quests"}, blocking=True, return_response=True
    )
    items = resp["todo.cuest_quests"]["items"]
    assert [(i["uid"], i["summary"], i["status"]) for i in items] == [
        ("q1", "Dishes", "needs_action"), ("q2", "Bins", "needs_action")
    ]


async def test_complete_maps_user_to_player(cuest) -> None:
    hass, client, _ = cuest
    await _setup(hass, client)
    user = await hass.auth.async_create_user("Ada", group_ids=["system-admin"])
    hass.states.async_set("person.ada", "home", {"user_id": user.id})
    await _complete(hass, "q1", Context(user_id=user.id))
    assert client.api_calls == [("POST", "/api/quests/q1/done", {"playerId": "p1"})]


async def test_complete_unknown_user_uses_first_player(cuest) -> None:
    hass, client, _ = cuest
    await _setup(hass, client)
    await _complete(hass, "q1")
    assert client.api_calls == [("POST", "/api/quests/q1/done", {"playerId": "p2"})]


@pytest.mark.parametrize("status", [404, 409])
async def test_already_done_is_swallowed(cuest, status) -> None:
    hass, client, _ = cuest
    await _setup(hass, client)
    client.api_result = (status, {"error": "x"})
    await _complete(hass, "q1")
    assert client.api_calls == [("POST", "/api/quests/q1/done", {"playerId": "p2"})]


async def test_other_error_raises_friendly(cuest) -> None:
    hass, client, _ = cuest
    await _setup(hass, client)
    client.api_result = (500, None)
    with pytest.raises(HomeAssistantError, match="Cuest server could not"):
        await _complete(hass, "q1")
