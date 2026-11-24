"""The Cuest bridge integration."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .client import CuestClient
from .const import CONF_SECRET, CONF_URL, DOMAIN
from .coordinator import CuestData
from .entities_export import EntityExporter
from .forwarder import Forwarder
from .services import async_register_services, async_remove_services

PLATFORMS = ["sensor", "todo"]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Cuest from a config entry."""
    client = CuestClient(hass, entry.data[CONF_URL], entry.data[CONF_SECRET])
    forwarder = Forwarder(hass, client)
    exporter = EntityExporter(hass, client)
    data = CuestData(hass, client)
    data.async_start()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = {
        "client": client,
        "forwarder": forwarder,
        "exporter": exporter,
        "data": data,
    }
    await forwarder.async_start()
    await exporter.async_start()
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    async_register_services(hass)
    await client.start()
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    if not await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        return False
    domain_data = hass.data.get(DOMAIN, {})
    entry_data = domain_data.pop(entry.entry_id, None)
    if entry_data is not None:
        await entry_data["exporter"].async_stop()
        await entry_data["forwarder"].async_stop()
        await entry_data["client"].stop()
    if not domain_data:
        hass.data.pop(DOMAIN, None)
        async_remove_services(hass)
    return True
