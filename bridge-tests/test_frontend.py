"""The dashboard card is served and the NFC blueprint is valid."""

from pathlib import Path

from homeassistant.util.yaml import load_yaml

ROOT = Path(__file__).parent.parent


async def test_card_served(cuest, hass_client):
    client = await hass_client()
    resp = await client.get("/cuest/cuest-card.js")
    assert resp.status == 200
    text = await resp.text()
    assert "customElements.define('cuest-card'" in text
    assert "customCards" in text


async def test_card_registered_as_extra_js(cuest):
    hass, _, _ = cuest
    from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL

    assert "/cuest/cuest-card.js" in hass.data[DATA_EXTRA_MODULE_URL].urls


def test_blueprint_parses():
    bp = load_yaml(str(ROOT / "blueprints/automation/cuest/nfc_complete_quest.yaml"))
    assert bp["blueprint"]["domain"] == "automation"
    assert set(bp["blueprint"]["input"]) == {"tag", "quest_title"}
    assert bp["actions"][0]["action"] == "cuest.complete_quest"


async def test_reload_does_not_register_card_twice(cuest):
    hass, _, entry = cuest
    from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert list(hass.data[DATA_EXTRA_MODULE_URL].urls).count("/cuest/cuest-card.js") == 1
