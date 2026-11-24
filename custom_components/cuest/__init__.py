"""The Cuest bridge integration."""

from __future__ import annotations

from pathlib import Path

from homeassistant.components import frontend
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .client import CuestClient
from .const import CONF_SECRET, CONF_URL, DOMAIN
from .coordinator import CuestData
from .entities_export import EntityExporter
from .forwarder import Forwarder
from .http import async_register_http
from .services import async_register_services, async_remove_services

PLATFORMS = ["sensor", "todo"]

CARD_URL = "/cuest/cuest-card.js"
CARD_PATH = Path(__file__).parent / "frontend" / "cuest-card.js"
_CARD_REGISTERED = f"{DOMAIN}_card_registered"

PANEL_URL = "/cuest/cuest-panel.js"
PANEL_PATH = Path(__file__).parent / "frontend" / "cuest-panel.js"
PANEL_URL_PATH = "cuest"
_PANEL_STATIC = f"{DOMAIN}_panel_static"


async def _async_register_card(hass: HomeAssistant) -> None:
    """Serve the dashboard card and load it in the frontend, once per HA run."""
    if hass.data.get(_CARD_REGISTERED):
        return
    await hass.http.async_register_static_paths(
        [StaticPathConfig(CARD_URL, str(CARD_PATH), cache_headers=False)]
    )
    frontend.add_extra_js_url(hass, CARD_URL)
    hass.data[_CARD_REGISTERED] = True


async def _async_register_panel(hass: HomeAssistant) -> None:
    """Serve the panel module (once per HA run) and add the sidebar panel."""
    if not hass.data.get(_PANEL_STATIC):
        await hass.http.async_register_static_paths(
            [StaticPathConfig(PANEL_URL, str(PANEL_PATH), cache_headers=False)]
        )
        hass.data[_PANEL_STATIC] = True
    if PANEL_URL_PATH in hass.data.get(frontend.DATA_PANELS, {}):
        return
    frontend.async_register_built_in_panel(
        hass,
        "custom",
        sidebar_title="Cuest",
        sidebar_icon="mdi:sword",
        frontend_url_path=PANEL_URL_PATH,
        config={
            "_panel_custom": {
                "name": "cuest-panel",
                "module_url": PANEL_URL,
                "embed_iframe": False,
                "trust_external": False,
            }
        },
        require_admin=False,
    )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up Cuest from a config entry."""
    await _async_register_card(hass)
    await _async_register_panel(hass)
    async_register_http(hass)
    client = CuestClient(hass, entry.data[CONF_URL], entry.data[CONF_SECRET])
    forwarder = Forwarder(hass, client, entry)
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
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True
