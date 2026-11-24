"""Config flow for Cuest (placeholder; the flow steps arrive in a later task)."""

from __future__ import annotations

from homeassistant.config_entries import ConfigFlow

from .const import DOMAIN


class CuestConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Cuest."""

    VERSION = 1
