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
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
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
from .const import CONF_SECRET, CONF_TREATS, CONF_URL, DOMAIN, TREAT_DOMAINS

CONF_PERSONS = "persons"
CONF_NOTIFY_SERVICE = "notify_service"
CONF_SUGGESTIONS = "suggestions"
MOBILE_APP_PREFIX = "mobile_app_"
CONF_ENTITIES = "entities"
CONF_NAME = "name"
CONF_COST = "cost"
DEFAULT_TREAT_COST = 50


NO_PHONE = "none"


class CuestRejected(Exception):
    """The Cuest server answered with an HTTP error."""


def normalize_url(url: str) -> str:
    """Lower-case scheme and host, drop trailing slashes.

    Raises ValueError when the address is not a usable http(s) URL.
    """
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    if scheme not in ("http", "https") or not parts.hostname:
        raise ValueError("not an http(s) address")
    host = parts.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    port = f":{parts.port}" if parts.port else ""  # raises ValueError if bad
    return f"{scheme}://{host}{port}{parts.path.rstrip('/')}"


class CuestConfigFlow(ConfigFlow, domain=DOMAIN):
    """Handle a config flow for Cuest."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Ask for the server address and the shared secret."""
        errors: dict[str, str] = {}
        if user_input is not None:
            secret = user_input[CONF_SECRET].strip()
            try:
                url = normalize_url(user_input[CONF_URL].strip())
            except ValueError:
                errors["base"] = "invalid_url"
            else:
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
        self._players: dict[str, dict] = {}
        self._treats: list[str] = []
        self._treat_values: dict[str, dict[str, Any]] = {}
        self._unlocks: dict[str, dict] = {}

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
            raise CuestRejected
        return data

    def _finish(self) -> ConfigFlowResult:
        return self.async_create_entry(data=dict(self.config_entry.options))

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Show the options menu."""
        return self.async_show_menu(
            step_id="init", menu_options=["people", "devices", "treats"]
        )

    # ---- people ----

    async def async_step_people(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose which people play."""
        errors: dict[str, str] = {}
        if user_input is not None and user_input.get(CONF_PERSONS):
            try:
                players = await self._api("GET", "/api/players")
            except CuestNotConnected:
                errors["base"] = "cannot_connect"
            except CuestRejected:
                errors["base"] = "server_rejected"
            else:
                self._players = {
                    p.get("haPerson"): p for p in players if isinstance(p, dict)
                }
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
        if not options:
            return self.async_abort(reason="no_people")
        return self.async_show_form(
            step_id="people",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_PERSONS): SelectSelector(
                        SelectSelectorConfig(options=options, multiple=True)
                    )
                }
            ),
            errors=errors,
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
            choice = user_input.get(CONF_NOTIFY_SERVICE, NO_PHONE)
            self._phones[person] = None if choice == NO_PHONE else choice
            if len(self._phones) == len(self._persons):
                try:
                    await self._save_players()
                except (CuestNotConnected, CuestRejected) as err:
                    # Show the last person again so the form can be resubmitted.
                    self._phones.pop(person)
                    errors["base"] = (
                        "server_rejected"
                        if isinstance(err, CuestRejected)
                        else "cannot_connect"
                    )
                else:
                    return self._finish()
        person = self._persons[len(self._phones)]
        current = (self._players.get(person) or {}).get("notifyService")
        services = {
            name
            for name in self.hass.services.async_services().get("notify", {})
            if name.startswith(MOBILE_APP_PREFIX)
        }
        if current:
            services.add(current)
        options = [SelectOptionDict(value=NO_PHONE, label="No phone")] + [
            SelectOptionDict(value=name, label=name) for name in sorted(services)
        ]
        return self.async_show_form(
            step_id="people_phone",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_NOTIFY_SERVICE, default=current or NO_PHONE
                    ): SelectSelector(
                        SelectSelectorConfig(
                            options=options, mode=SelectSelectorMode.DROPDOWN
                        )
                    )
                }
            ),
            description_placeholders={"person": self._person_name(person)},
            errors=errors,
        )

    async def _save_players(self) -> None:
        for person, service in self._phones.items():
            existing = self._players.get(person)
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
                return await self._show_devices("cannot_connect")
            except CuestRejected:
                return await self._show_devices("server_rejected")
            return self._finish()
        return await self._show_devices(None)

    async def _show_devices(self, error: str | None) -> ConfigFlowResult:
        """Fetch suggestions and show the list, optionally with an error."""
        try:
            data = await self._api("GET", "/api/suggestions")
        except CuestNotConnected:
            return self.async_abort(reason="cannot_connect")
        except CuestRejected:
            return self.async_abort(reason="server_rejected")
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
            errors={"base": error} if error else None,
        )

    async def async_step_no_devices(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Nothing new was found; close the dialog."""
        return self._finish()

    # ---- house treats ----

    async def async_step_treats(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Choose which entities may be switched on as treats."""
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                unlocks = await self._api("GET", "/api/unlocks")
                self._unlocks = {
                    u.get("entityId"): u for u in unlocks if isinstance(u, dict)
                }
                self._treats = list(user_input.get(CONF_ENTITIES, []))
                self._treat_values = {}
                if self._treats:
                    return await self.async_step_treats_item()
                await self._save_treats()
            except CuestNotConnected:
                errors["base"] = "cannot_connect"
            except CuestRejected:
                errors["base"] = "server_rejected"
            else:
                return self._finish_treats()
        current = list(self.config_entry.options.get(CONF_TREATS, []))
        return self.async_show_form(
            step_id="treats",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ENTITIES, default=current): EntitySelector(
                        EntitySelectorConfig(
                            domain=sorted(TREAT_DOMAINS), multiple=True
                        )
                    )
                }
            ),
            errors=errors,
        )

    async def async_step_treats_item(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        """Name and price one treat; repeats until all are done."""
        errors: dict[str, str] = {}
        if user_input is not None:
            entity = self._treats[len(self._treat_values)]
            self._treat_values[entity] = {
                "name": user_input[CONF_NAME].strip() or self._person_name(entity),
                "cost": int(user_input[CONF_COST]),
            }
            if len(self._treat_values) == len(self._treats):
                try:
                    await self._save_treats()
                except (CuestNotConnected, CuestRejected) as err:
                    # Show the last treat again so the form can be resubmitted.
                    self._treat_values.pop(entity)
                    errors["base"] = (
                        "server_rejected"
                        if isinstance(err, CuestRejected)
                        else "cannot_connect"
                    )
                else:
                    return self._finish_treats()
        entity = self._treats[len(self._treat_values)]
        existing = self._unlocks.get(entity) or {}
        return self.async_show_form(
            step_id="treats_item",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_NAME,
                        default=existing.get("name") or self._person_name(entity),
                    ): str,
                    vol.Required(
                        CONF_COST, default=existing.get("cost", DEFAULT_TREAT_COST)
                    ): NumberSelector(
                        NumberSelectorConfig(
                            min=5, max=1000, step=5, mode=NumberSelectorMode.BOX
                        )
                    ),
                }
            ),
            description_placeholders={"entity": self._person_name(entity)},
            errors=errors,
        )

    def _finish_treats(self) -> ConfigFlowResult:
        return self.async_create_entry(
            data={**self.config_entry.options, CONF_TREATS: self._treats}
        )

    async def _save_treats(self) -> None:
        """Create or re-enable chosen unlocks; disable the ones removed."""
        for entity, values in self._treat_values.items():
            existing = self._unlocks.get(entity)
            if existing is not None:
                await self._api(
                    "PATCH",
                    f"/api/unlocks/{existing['id']}",
                    {**values, "enabled": True},
                )
            else:
                await self._api("POST", "/api/unlocks", {**values, "entityId": entity})
        for entity in self.config_entry.options.get(CONF_TREATS, []):
            existing = self._unlocks.get(entity)
            if entity not in self._treats and existing and existing.get("enabled", True):
                await self._api("DELETE", f"/api/unlocks/{existing['id']}")
