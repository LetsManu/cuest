"""Cuest sensors: per-player level, XP, gold and streak, plus open quest count."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorEntity, SensorStateClass
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import CuestData


def device_info(entry: ConfigEntry) -> DeviceInfo:
    """One Cuest service device per config entry."""
    return DeviceInfo(
        entry_type=DeviceEntryType.SERVICE,
        identifiers={(DOMAIN, entry.entry_id)},
        name="Cuest",
        manufacturer="Cuest",
    )


async def async_setup_entry(
    hass: HomeAssistant, entry: ConfigEntry, async_add_entities: AddEntitiesCallback
) -> None:
    """Create the global sensor and keep adding sensors for new players."""
    data: CuestData = hass.data[DOMAIN][entry.entry_id]["data"]
    created: set[str] = set()

    @callback
    def add_new_players() -> None:
        new: list[SensorEntity] = []
        for player in data.players:
            pid = player.get("id")
            if not isinstance(pid, str) or pid in created:
                continue
            created.add(pid)
            new.extend(
                [
                    CuestLevelSensor(data, entry, pid),
                    CuestXpSensor(data, entry, pid),
                    CuestGoldSensor(data, entry, pid),
                    CuestStreakSensor(data, entry, pid),
                ]
            )
        if new:
            async_add_entities(new)

    async_add_entities([CuestOpenQuestsSensor(data, entry)])
    add_new_players()
    entry.async_on_unload(data.async_add_listener(add_new_players))


class CuestSensor(SensorEntity):
    """Base: refreshes whenever a snapshot arrives."""

    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, data: CuestData, entry: ConfigEntry) -> None:
        self._data = data
        self._attr_device_info = device_info(entry)

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self._data.async_add_listener(self._refresh))

    @callback
    def _refresh(self) -> None:
        self.async_write_ha_state()


class CuestOpenQuestsSensor(CuestSensor):
    _attr_translation_key = "open_quests"
    _attr_native_unit_of_measurement = "quests"

    def __init__(self, data: CuestData, entry: ConfigEntry) -> None:
        super().__init__(data, entry)
        self._attr_unique_id = "cuest_open_quests"

    def _open(self) -> list[dict[str, Any]]:
        return [q for q in self._data.quests if q.get("status") in ("open", "active")]

    @property
    def native_value(self) -> int:
        return len(self._open())

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"quests": [q.get("title") for q in self._open()]}


class CuestPlayerSensor(CuestSensor):
    """Base for per-player sensors."""

    _key = ""

    def __init__(self, data: CuestData, entry: ConfigEntry, player_id: str) -> None:
        super().__init__(data, entry)
        self._player_id = player_id
        self._attr_unique_id = f"cuest_{player_id}_{self._key}"
        player = data.find_player(player_id) or {}
        self._attr_translation_placeholders = {"player": str(player.get("name", ""))}

    @property
    def _player(self) -> dict[str, Any] | None:
        return self._data.find_player(self._player_id)

    @property
    def available(self) -> bool:
        return self._player is not None

    @property
    def native_value(self) -> int | None:
        player = self._player
        return player.get(self._key) if player else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        player = self._player or {}
        return {
            "cuest_kind": self._key,
            "cuest_player_id": self._player_id,
            "ha_person": player.get("haPerson"),
        }


class CuestLevelSensor(CuestPlayerSensor):
    _key = "level"
    _attr_translation_key = "level"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        player = self._player or {}
        return {
            **super().extra_state_attributes,
            "player_name": player.get("name"),
            "title": player.get("title"),
            "into_level": player.get("intoLevel"),
            "to_next": player.get("toNext"),
            "outfit_palette": dict((player.get("outfit") or {}).get("palette") or {}),
            "decor": list(player.get("decor") or []),
            "rest_tokens": player.get("restTokens") or 0,
            "boost_until": player.get("boostUntil"),
        }


class CuestXpSensor(CuestPlayerSensor):
    _key = "xp"
    _attr_translation_key = "xp"
    _attr_state_class = SensorStateClass.TOTAL_INCREASING
    _attr_native_unit_of_measurement = "XP"


class CuestGoldSensor(CuestPlayerSensor):
    _key = "gold"
    _attr_translation_key = "gold"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "gold"


class CuestStreakSensor(CuestPlayerSensor):
    _key = "streak"
    _attr_translation_key = "streak"
    _attr_state_class = SensorStateClass.MEASUREMENT
    _attr_native_unit_of_measurement = "days"

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        player = self._player or {}
        return {
            **super().extra_state_attributes,
            "best_streak": player.get("bestStreak") or 0,
            "chest_keys": player.get("chestKeys") or 0,
        }
