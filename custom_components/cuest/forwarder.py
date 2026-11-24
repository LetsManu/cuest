"""Forwards state transitions and notification buttons to the Cuest server."""

from __future__ import annotations

from collections.abc import Callable
import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event

from .client import CuestClient, CuestNotConnected
from .const import ALLOWED_DOMAINS, CONF_TREATS, TREAT_DOMAINS

_LOGGER = logging.getLogger(__name__)

NOTIFICATION_ACTION_EVENT = "mobile_app_notification_action"
ACTION_PREFIX = "CUEST|"


class Forwarder:
    """Bridges Home Assistant events to the server and runs allowed service calls."""

    def __init__(
        self, hass: HomeAssistant, client: CuestClient, entry: ConfigEntry
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._client = client
        self._unsub_states: Callable[[], None] | None = None
        self._unsub_action: Callable[[], None] | None = None
        self._stopped = False

    async def async_start(self) -> None:
        """Register message handlers and the notification action listener."""
        self._client.on_message("subscribe", self._handle_subscribe)
        self._client.on_message("call_service", self._handle_call_service)
        self._unsub_action = self._hass.bus.async_listen(
            NOTIFICATION_ACTION_EVENT, self._handle_notification_action
        )

    async def async_stop(self) -> None:
        """Remove all listeners."""
        self._stopped = True
        self._clear_state_listener()
        if self._unsub_action is not None:
            self._unsub_action()
            self._unsub_action = None

    def _clear_state_listener(self) -> None:
        if self._unsub_states is not None:
            self._unsub_states()
            self._unsub_states = None

    async def _send(self, msg: dict[str, Any]) -> None:
        try:
            await self._client.send(msg)
        except CuestNotConnected:
            _LOGGER.debug("Dropping %s message: not connected", msg.get("type"))

    @callback
    def _handle_subscribe(self, msg: dict) -> None:
        if self._stopped:
            return
        entities = msg.get("entities")
        if not isinstance(entities, list) or not all(
            isinstance(e, str) for e in entities
        ):
            _LOGGER.debug("Ignoring malformed subscribe message")
            return
        self._clear_state_listener()
        if entities:
            self._unsub_states = async_track_state_change_event(
                self._hass, entities, self._handle_state_change
            )

    @callback
    def _handle_state_change(self, event: Event[EventStateChangedData]) -> None:
        old = event.data["old_state"]
        new = event.data["new_state"]
        if old is None or new is None or old.state == new.state:
            return
        self._hass.async_create_task(
            self._send(
                {
                    "type": "state",
                    "entityId": new.entity_id,
                    "oldState": old.state,
                    "newState": new.state,
                    "at": new.last_changed.isoformat(),
                }
            )
        )

    @callback
    def _handle_notification_action(self, event: Event) -> None:
        if self._stopped:
            return
        action = event.data.get("action")
        if not isinstance(action, str) or not action.startswith(ACTION_PREFIX):
            return
        self._hass.async_create_task(
            self._send(
                {
                    "type": "notification_action",
                    "action": action,
                    "at": event.time_fired.isoformat(),
                }
            )
        )

    @callback
    def _handle_call_service(self, msg: dict) -> None:
        self._hass.async_create_task(self._call_service(msg))

    def _is_allowed(self, domain: Any, service: Any, target: Any) -> bool:
        """Allow fixed domains, or turn_on of one owner-chosen treat entity."""
        if not (isinstance(domain, str) and isinstance(service, str)):
            return False
        if domain in ALLOWED_DOMAINS:
            return True
        if service != "turn_on" or domain not in TREAT_DOMAINS:
            return False
        if not isinstance(target, dict) or set(target) != {"entity_id"}:
            return False
        entity_id = target["entity_id"]
        treats = self._entry.options.get(CONF_TREATS, [])
        return (
            isinstance(entity_id, str)
            and entity_id.startswith(f"{domain}.")
            and entity_id in treats
        )

    async def _call_service(self, msg: dict) -> None:
        call_id = msg.get("id")
        domain = msg.get("domain")
        service = msg.get("service")
        data: Any = msg.get("data") or {}
        target: Any = msg.get("target")
        if not self._is_allowed(domain, service, target):
            await self._send(
                {"type": "result", "id": call_id, "ok": False, "error": "not_allowed"}
            )
            return
        if domain not in ALLOWED_DOMAINS:
            # Treat call: rebuild so only the one listed entity can be hit.
            data = {}
            target = {"entity_id": target["entity_id"]}
        try:
            await self._hass.services.async_call(
                domain,
                service,
                data,
                target=target,
                blocking=True,
            )
        except Exception as err:  # noqa: BLE001 - report any failure to the server
            _LOGGER.debug("Service call %s.%s failed: %s", domain, service, err)
            await self._send(
                {"type": "result", "id": call_id, "ok": False, "error": str(err) or type(err).__name__}
            )
            return
        await self._send({"type": "result", "id": call_id, "ok": True})
