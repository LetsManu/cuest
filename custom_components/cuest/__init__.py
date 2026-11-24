"""The Cuest bridge integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .client import CuestClient
from .const import CONF_SECRET, CONF_URL, DOMAIN
from .entities_export import EntityExporter
from .forwarder import Forwarder


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Cuest from a config entry."""
    client = CuestClient(hass, entry.data[CONF_URL], entry.data[CONF_SECRET])
    forwarder = Forwarder(hass, client)
    exporter = EntityExporter(hass, client)
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {
        "client": client,
        "forwarder": forwarder,
        "exporter": exporter,
    }
    await forwarder.async_start()
    await exporter.async_start()
    await client.start()
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    domain_data = hass.data.get(DOMAIN, {})
    entry_data = domain_data.pop(entry.entry_id, None)
    if entry_data is not None:
        await entry_data["exporter"].async_stop()
        await entry_data["forwarder"].async_stop()
        await entry_data["client"].stop()
    if not domain_data:
        hass.data.pop(DOMAIN, None)
    return True
