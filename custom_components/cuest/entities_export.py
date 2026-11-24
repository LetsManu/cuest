"""Exports Home Assistant entities to the Cuest server for auto-detect."""

from __future__ import annotations

from collections.abc import Callable
import json
import logging
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.event import async_call_later

from .client import CuestClient, CuestNotConnected

_LOGGER = logging.getLogger(__name__)

EXPORT_DOMAINS = frozenset({"sensor", "binary_sensor", "vacuum"})
MAX_CHUNK_BYTES = 48_000
DEBOUNCE_SECONDS = 10

# Envelope of a chunk message with the widest plausible chunk number.
_ENVELOPE_BYTES = len(
    json.dumps({"type": "entities", "chunk": 999_999, "last": False, "entities": []})
)


def _str_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) and value else None


def build_entity_infos(hass: HomeAssistant) -> list[dict]:
    """Build EntityInfo dicts from the entity and device registries and states."""
    ent_reg = er.async_get(hass)
    dev_reg = dr.async_get(hass)
    infos: list[dict] = []
    seen: set[str] = set()

    for entry in ent_reg.entities.values():
        if entry.domain not in EXPORT_DOMAINS:
            continue
        seen.add(entry.entity_id)
        state = hass.states.get(entry.entity_id)
        attrs = state.attributes if state is not None else {}
        device = dev_reg.async_get(entry.device_id) if entry.device_id else None
        options = attrs.get("options")
        infos.append(
            {
                "entityId": entry.entity_id,
                "domain": entry.domain,
                "deviceId": entry.device_id,
                "deviceClass": entry.device_class or entry.original_device_class,
                "platform": entry.platform,
                "translationKey": entry.translation_key,
                "options": [str(o) for o in options]
                if isinstance(options, (list, tuple))
                else None,
                "unit": _str_or_none(attrs.get("unit_of_measurement")),
                "name": entry.name
                or entry.original_name
                or _str_or_none(attrs.get("friendly_name")),
                "deviceName": (device.name_by_user or device.name) if device else None,
                "manufacturer": device.manufacturer if device else None,
                "model": device.model if device else None,
                "state": state.state if state is not None else None,
            }
        )

    for state in hass.states.async_all():
        if state.domain not in EXPORT_DOMAINS or state.entity_id in seen:
            continue
        attrs = state.attributes
        options = attrs.get("options")
        infos.append(
            {
                "entityId": state.entity_id,
                "domain": state.domain,
                "deviceId": None,
                "deviceClass": _str_or_none(attrs.get("device_class")),
                "platform": None,
                "translationKey": None,
                "options": [str(o) for o in options]
                if isinstance(options, (list, tuple))
                else None,
                "unit": _str_or_none(attrs.get("unit_of_measurement")),
                "name": _str_or_none(attrs.get("friendly_name")),
                "deviceName": None,
                "manufacturer": None,
                "model": None,
                "state": state.state,
            }
        )
    return infos


def chunk_entity_infos(
    infos: list[dict], max_bytes: int = MAX_CHUNK_BYTES
) -> list[list[dict]]:
    """Split infos so each chunk message's JSON stays below max_bytes.

    Always returns at least one chunk (an empty list for no entities).
    """
    chunks: list[list[dict]] = []
    current: list[dict] = []
    size = _ENVELOPE_BYTES
    for info in infos:
        info_size = len(json.dumps(info)) + 2  # ", " separator
        if current and size + info_size >= max_bytes:
            chunks.append(current)
            current = []
            size = _ENVELOPE_BYTES
        current.append(info)
        size += info_size
    chunks.append(current)
    return chunks


async def async_send_entities(hass: HomeAssistant, client: CuestClient) -> None:
    """Send all exported entities to the server in chunks."""
    chunks = chunk_entity_infos(build_entity_infos(hass))
    try:
        for index, chunk in enumerate(chunks):
            await client.send(
                {
                    "type": "entities",
                    "chunk": index,
                    "last": index == len(chunks) - 1,
                    "entities": chunk,
                }
            )
    except CuestNotConnected:
        _LOGGER.debug("Not sending entities: not connected")


class EntityExporter:
    """Sends entities after each welcome and (debounced) on registry changes."""

    def __init__(
        self,
        hass: HomeAssistant,
        client: CuestClient,
        delay: float = DEBOUNCE_SECONDS,
    ) -> None:
        self._hass = hass
        self._client = client
        self._delay = delay
        self._cancel_timer: Callable[[], None] | None = None
        self._unsubs: list[Callable[[], None]] = []
        self._stopped = False

    async def async_start(self) -> None:
        """Register the welcome handler and registry listeners."""
        self._client.on_message("welcome", self._handle_welcome)
        self._unsubs.append(
            self._hass.bus.async_listen(
                er.EVENT_ENTITY_REGISTRY_UPDATED, self._handle_registry_event
            )
        )
        self._unsubs.append(
            self._hass.bus.async_listen(
                dr.EVENT_DEVICE_REGISTRY_UPDATED, self._handle_registry_event
            )
        )

    async def async_stop(self) -> None:
        """Remove listeners and cancel any pending send."""
        self._stopped = True
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        if self._cancel_timer is not None:
            self._cancel_timer()
            self._cancel_timer = None

    @callback
    def _handle_welcome(self, msg: dict) -> None:
        if self._stopped:
            return
        self._hass.async_create_task(async_send_entities(self._hass, self._client))

    @callback
    def _handle_registry_event(self, event: Event) -> None:
        if self._stopped:
            return
        if self._cancel_timer is not None:
            self._cancel_timer()
        self._cancel_timer = async_call_later(self._hass, self._delay, self._fire)

    @callback
    def _fire(self, _now: Any) -> None:
        self._cancel_timer = None
        if self._stopped:
            return
        self._hass.async_create_task(async_send_entities(self._hass, self._client))
