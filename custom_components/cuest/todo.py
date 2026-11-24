"""The Cuest quests to-do list."""

from __future__ import annotations

from homeassistant.components.todo import (
    TodoItem,
    TodoItemStatus,
    TodoListEntity,
    TodoListEntityFeature,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import CuestData
from .sensor import device_info


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Set up the quests to-do list."""
    async_add_entities([CuestQuestsTodo(hass.data[DOMAIN][entry.entry_id]["data"], entry)])


class CuestQuestsTodo(TodoListEntity):
    """Quests from the latest snapshot; ticking one off completes it."""

    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_translation_key = "quests"
    _attr_supported_features = TodoListEntityFeature.UPDATE_TODO_ITEM

    def __init__(self, data: CuestData, entry: ConfigEntry) -> None:
        self._data = data
        self._attr_unique_id = "cuest_quests"
        self._attr_device_info = device_info(entry)

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._data.async_add_listener(self._refresh))

    @callback
    def _refresh(self) -> None:
        self.async_write_ha_state()

    @property
    def todo_items(self) -> list[TodoItem]:
        return [
            TodoItem(
                uid=q["id"],
                summary=q.get("title", ""),
                status=TodoItemStatus.NEEDS_ACTION,
            )
            for q in self._data.quests
            if isinstance(q.get("id"), str)
        ]

    async def async_update_todo_item(self, item: TodoItem) -> None:
        if item.status != TodoItemStatus.COMPLETED or item.uid is None:
            return
        player = self._data.player_for_user(self._context.user_id if self._context else None)
        if player is None:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="no_player"
            )
        status = await self._data.async_quest_action("done", item.uid, player["id"])
        if status in (404, 409):
            # Already done or gone; the next snapshot corrects the list.
            self.async_write_ha_state()
            return
        if status >= 400:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="action_failed"
            )
