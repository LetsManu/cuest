"""The cuest.complete_quest and cuest.start_quest services."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, SERVICE_COMPLETE_QUEST, SERVICE_START_QUEST
from .coordinator import CuestData

SERVICE_SCHEMA = vol.Schema(
    {
        vol.Optional("quest_id"): cv.string,
        vol.Optional("template_title"): cv.string,
        vol.Optional("person"): cv.entity_domain("person"),
    }
)


def _data(hass: HomeAssistant) -> CuestData:
    for entry_data in hass.data.get(DOMAIN, {}).values():
        return entry_data["data"]
    raise HomeAssistantError(translation_domain=DOMAIN, translation_key="not_connected")


async def _run(call: ServiceCall, action: str) -> None:
    data = _data(call.hass)
    quest = None
    if quest_id := call.data.get("quest_id"):
        quest = data.find_quest(quest_id)
    elif title := call.data.get("template_title"):
        quest = data.newest_quest_by_title(title)
    if quest is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="quest_not_found"
        )
    if person := call.data.get("person"):
        player = data.player_for_person(person)
    else:
        player = data.player_for_user(call.context.user_id)
    if player is None:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="no_player"
        )
    status = await data.async_quest_action(action, quest["id"], player["id"])
    if status == 404:
        raise ServiceValidationError(
            translation_domain=DOMAIN, translation_key="quest_not_found"
        )
    if status >= 400 and status != 409:
        raise HomeAssistantError(
            translation_domain=DOMAIN, translation_key="action_failed"
        )


def async_register_services(hass: HomeAssistant) -> None:
    """Register once per Home Assistant."""
    if hass.services.has_service(DOMAIN, SERVICE_COMPLETE_QUEST):
        return

    async def complete(call: ServiceCall) -> None:
        await _run(call, "done")

    async def start(call: ServiceCall) -> None:
        await _run(call, "start")

    hass.services.async_register(DOMAIN, SERVICE_COMPLETE_QUEST, complete, SERVICE_SCHEMA)
    hass.services.async_register(DOMAIN, SERVICE_START_QUEST, start, SERVICE_SCHEMA)


def async_remove_services(hass: HomeAssistant) -> None:
    hass.services.async_remove(DOMAIN, SERVICE_COMPLETE_QUEST)
    hass.services.async_remove(DOMAIN, SERVICE_START_QUEST)
