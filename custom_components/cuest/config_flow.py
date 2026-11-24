"""Config flow and options flow for Cuest."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
)

from .client import (
    CannotConnect,
    CuestClient,
    CuestNotConnected,
    InvalidAuth,
    async_validate,
)
from .const import CONF_SECRET, CONF_URL, DOMAIN

CONF_PERSONS = "persons"
CONF_NOTIFY_SERVICE = "notify_service"
CONF_SUGGESTIONS = "suggestions"
MOBILE_APP_PREFIX = "mobile_app_"


def normalize_url(url: str) -> str:
    """Lower-case scheme and host, drop trailing slashes."""
    parts = urlsplit(url.strip())
    if not parts.scheme or not parts.hostname:
        return url.strip().rstrip("/")
    host = parts.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    port = f":{parts.port}" if parts.port else ""
    return f"{parts.scheme.lower()}://{host}{port}{parts.path.rstrip('/')}"


class CuestConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Cuest."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for the server address and the shared secret."""
        errors: dict[str, str] = {}
        if user_input is not None:
            url = normalize_url(user_input[CONF_URL])
            secret = user_input[CONF_SECRET]
            await self.async_set_unique_id(url)
            self._abort_if_unique_id_configured()
            try:
                await async_validate(self.hass, url, secret)
            except InvalidAuth:
                errors["base"] = "invalid_auth"
            except CannotConnect:
                errors["base"] = "cannot_connect"
            else:
                return self.async_create_entry(
                    title="Cuest", data={CONF_URL: url, CONF_SECRET: secret}
                )
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_URL,
                        default=(user_input or {}).get(CONF_URL, vol.UNDEFINED),
                    ): str,
                    vol.Required(CONF_SECRET): str,
                }
            ),
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> CuestOptionsFlow:
        """Return the options flow."""
        return CuestOptionsFlow()


class CuestOptionsFlow(OptionsFlow):
    """Link people to their phones and pick auto-detected devices."""

    def __init__(self) -> None:
        self._persons: list[str] = []
        self._phones: dict[str, str | None] = {}

    def _client(self) -> CuestClient:
        try:
            return self.hass.data[DOMAIN][self.config_entry.entry_id]["client"]
        except KeyError as err:
            raise CuestNotConnected from err

    async def _api(self, method: str, path: str, body: Any | None = None) -> Any:
        """Call the server; any failure raises CuestNotConnected."""
        try:
            client = self._client()
            status, data = await (
                client.api(method, path)
                if body is None
                else client.api(method, path, body)
            )
        except (CuestNotConnected, TimeoutError) as err:
            raise CuestNotConnected from err
        if status >= 400:
            raise CuestNotConnected
        return data

    def _finish(self) -> ConfigFlowResult:
        return self.async_create_entry(data=dict(self.config_entry.options))

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show the options menu."""
        return self.async_show_menu(step_id="init", menu_options=["people", "devices"])

    # ---- people ----

    async def async_step_people(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose which people play."""
        if user_input is not None and user_input.get(CONF_PERSONS):
            self._persons = list(user_input[CONF_PERSONS])
            self._phones = {}
            return await self.async_step_people_phone()
        options = [
            SelectOptionDict(
                value=state.entity_id,
                label=state.attributes.get("friendly_name", state.entity_id),
            )
            for state in self.hass.states.async_all("person")
        ]
        return self.async_show_form(
            step_id="people",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_PERSONS): SelectSelector(
                        SelectSelectorConfig(options=options, multiple=True)
                    )
                }
            ),
        )

    def _person_name(self, entity_id: str) -> str:
        state = self.hass.states.get(entity_id)
        return state.attributes.get("friendly_name", entity_id) if state else entity_id

    async def async_step_people_phone(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Pick the phone for the next person; repeats until all are done."""
        errors: dict[str, str] = {}
        if user_input is not None:
            person = self._persons[len(self._phones)]
            self._phones[person] = user_input.get(CONF_NOTIFY_SERVICE)
            if len(self._phones) == len(self._persons):
                try:
                    await self._save_players()
                except CuestNotConnected:
                    # Show the last person again so the form can be resubmitted.
                    self._phones.pop(person)
                    errors["base"] = "cannot_connect"
                else:
                    return self._finish()
        person = self._persons[len(self._phones)]
        services = sorted(
            name
            for name in self.hass.services.async_services().get("notify", {})
            if name.startswith(MOBILE_APP_PREFIX)
        )
        return self.async_show_form(
            step_id="people_phone",
            data_schema=vol.Schema(
                {
                    vol.Optional(CONF_NOTIFY_SERVICE): SelectSelector(
                        SelectSelectorConfig(
                            options=services, mode=SelectSelectorMode.DROPDOWN
                        )
                    )
                }
            ),
            description_placeholders={"person": self._person_name(person)},
            errors=errors,
        )

    async def _save_players(self) -> None:
        players = await self._api("GET", "/api/players")
        by_person = {p.get("haPerson"): p for p in players if isinstance(p, dict)}
        for person, service in self._phones.items():
            existing = by_person.get(person)
            if existing is not None:
                await self._api(
                    "PATCH", f"/api/players/{existing['id']}", {"notifyService": service}
                )
            else:
                await self._api(
                    "POST",
                    "/api/players",
                    {
                        "name": self._person_name(person),
                        "haPerson": person,
                        "notifyService": service,
                    },
                )

    # ---- devices ----

    async def async_step_devices(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Pick auto-detected devices to add."""
        if user_input is not None and user_input.get(CONF_SUGGESTIONS):
            try:
                await self._api(
                    "POST",
                    "/api/suggestions/accept",
                    {"keys": list(user_input[CONF_SUGGESTIONS])},
                )
            except CuestNotConnected:
                return self.async_show_form(
                    step_id="devices", errors={"base": "cannot_connect"}
                )
            return self._finish()

        try:
            data = await self._api("GET", "/api/suggestions")
        except CuestNotConnected:
            return self.async_show_form(
                step_id="devices", errors={"base": "cannot_connect"}
            )
        options = [
            SelectOptionDict(
                value=s["key"],
                label=f"{s.get('deviceName', s['key'])}: "
                f"{(s.get('templates') or [{}])[0].get('title', '')}",
            )
            for s in data.get("suggestions", [])
            if not s.get("added")
        ]
        if not options:
            return self.async_show_form(step_id="no_devices")
        return self.async_show_form(
            step_id="devices",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_SUGGESTIONS): SelectSelector(
                        SelectSelectorConfig(options=options, multiple=True)
                    )
                }
            ),
        )

    async def async_step_no_devices(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Nothing new was found; close the dialog."""
        return self._finish()
