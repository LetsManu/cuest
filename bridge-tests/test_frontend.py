"""The dashboard card is served and the NFC blueprint is valid."""

from pathlib import Path

from homeassistant.util.yaml import load_yaml

ROOT = Path(__file__).parent.parent


async def test_card_served(cuest, hass_client):
    client = await hass_client()
    resp = await client.get("/cuest/cuest-card.js")
    assert resp.status == 200
    text = await resp.text()
    assert '"cuest-card"' in text
    assert "customElements.define" in text
    assert "customCards" in text


ARCANE_TAGS = [
    "cuest-arcane-header", "cuest-orb-card", "cuest-trail-card", "cuest-rune-gauge",
    "cuest-quest-board", "cuest-allies-card", "cuest-hero-card", "cuest-rooms-card",
    "cuest-bard-card", "cuest-spell-tile", "cuest-stamina-card",
]


async def test_arcane_bundle_served(cuest, hass_client):
    client = await hass_client()
    resp = await client.get("/cuest/cuest-arcane.js")
    assert resp.status == 200
    text = await resp.text()
    for tag in ARCANE_TAGS:
        assert tag in text, tag
    assert "customCards" in text


async def test_arcane_registered_as_extra_js(cuest):
    hass, _, _ = cuest
    from homeassistant.components.frontend import DATA_EXTRA_MODULE_URL

    assert "/cuest/cuest-arcane.js" in hass.data[DATA_EXTRA_MODULE_URL].urls


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
    assert list(hass.data[DATA_EXTRA_MODULE_URL].urls).count("/cuest/cuest-arcane.js") == 1


async def test_panel_served(cuest, hass_client):
    client = await hass_client()
    resp = await client.get("/cuest/cuest-panel.js")
    assert resp.status == 200
    assert "cuest-panel" in await resp.text()


async def test_panel_registered_once_and_removed_on_last_unload(cuest):
    hass, _, entry = cuest
    panels = hass.data["frontend_panels"]
    assert "cuest" in panels
    panel = panels["cuest"]
    assert panel.frontend_url_path == "cuest"
    assert panel.sidebar_title == "Cuest"
    assert panel.sidebar_icon == "mdi:sword"
    assert panel.require_admin is False
    assert panel.config["_panel_custom"] == {
        "name": "cuest-panel",
        "module_url": "/cuest/cuest-panel.js",
        "embed_iframe": False,
        "trust_external": False,
    }

    assert await hass.config_entries.async_reload(entry.entry_id)
    await hass.async_block_till_done()
    assert "cuest" in hass.data["frontend_panels"]

    assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()
    assert "cuest" not in hass.data["frontend_panels"]
