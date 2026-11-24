"""Holds the latest Cuest snapshot and fans it out to entities."""

from __future__ import annotations

from collections.abc import Callable
import logging
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError

from .client import CuestClient, CuestNotConnected
from .const import DOMAIN, EVENT_LEVEL_UP, EVENT_QUEST_DONE, EVENT_QUEST_OPENED

_LOGGER = logging.getLogger(__name__)

KNOWN_EVENTS = frozenset({EVENT_QUEST_OPENED, EVENT_QUEST_DONE, EVENT_LEVEL_UP})


class CuestData:
    """Latest snapshot from the server plus listeners notified on each update."""

    def __init__(self, hass: HomeAssistant, client: CuestClient) -> None:
        self.hass = hass
        self.client = client
        self.snapshot: dict[str, Any] = {"players": [], "quests": []}
        self._listeners: list[Callable[[], None]] = []

    def async_start(self) -> None:
        """Register the message handlers on the client."""
        self.client.on_message("snapshot", self._handle_snapshot)
        self.client.on_message("fire_event", self._handle_fire_event)

    @property
    def players(self) -> list[dict[str, Any]]:
        return self.snapshot["players"]

    @property
    def quests(self) -> list[dict[str, Any]]:
        return self.snapshot["quests"]

    @callback
    def async_add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Call listener on every snapshot; returns an unsubscribe function."""
        self._listeners.append(listener)

        @callback
        def remove() -> None:
            if listener in self._listeners:
                self._listeners.remove(listener)

        return remove

    @callback
    def _handle_snapshot(self, msg: dict) -> None:
        players = msg.get("players")
        quests = msg.get("quests")
        self.snapshot = {
            "players": players if isinstance(players, list) else [],
            "quests": quests if isinstance(quests, list) else [],
        }
        for listener in list(self._listeners):
            try:
                listener()
            except Exception:
                _LOGGER.exception("Error updating Cuest entities")

    @callback
    def _handle_fire_event(self, msg: dict) -> None:
        event = msg.get("event")
        data = msg.get("data")
        if event not in KNOWN_EVENTS:
            _LOGGER.debug("Ignoring unknown Cuest event %s", event)
            return
        self.hass.bus.async_fire(event, data if isinstance(data, dict) else {})

    def find_player(self, player_id: str) -> dict[str, Any] | None:
        return next((p for p in self.players if p.get("id") == player_id), None)

    def player_for_person(self, person_entity_id: str) -> dict[str, Any] | None:
        """Player linked to the given person entity, or None."""
        return next(
            (p for p in self.players if p.get("haPerson") == person_entity_id), None
        )

    def player_for_user(
        self, user_id: str | None, fallback: bool = True
    ) -> dict[str, Any] | None:
        """Map a Home Assistant user to a player via the person entity.

        With ``fallback`` (default) an unlinked user gets the first player.
        """
        person_id = None
        if user_id:
            for state in self.hass.states.async_all("person"):
                if state.attributes.get("user_id") == user_id:
                    person_id = state.entity_id
                    break
        player = self.player_for_person(person_id) if person_id else None
        if player or not fallback:
            return player
        return self.players[0] if self.players else None

    def newest_quest_by_title(self, title: str) -> dict[str, Any] | None:
        wanted = title.strip().casefold()
        matches = [
            q for q in self.quests if str(q.get("title", "")).strip().casefold() == wanted
        ]
        return max(matches, key=lambda q: q.get("createdAt") or "", default=None)

    def find_quest(self, quest_id: str) -> dict[str, Any] | None:
        return next((q for q in self.quests if q.get("id") == quest_id), None)

    async def async_quest_action(
        self, action: str, quest_id: str, player_id: str
    ) -> int:
        """Call the done/start API. Returns the HTTP status; raises on transport errors."""
        try:
            status, _ = await self.client.api(
                "POST", f"/api/quests/{quest_id}/{action}", {"playerId": player_id}
            )
        except (CuestNotConnected, TimeoutError) as err:
            raise HomeAssistantError(
                translation_domain=DOMAIN, translation_key="not_connected"
            ) from err
        return status
