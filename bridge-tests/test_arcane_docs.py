"""The Arcane dashboards doc: every YAML block parses and only uses real Cuest cards."""

import re
from pathlib import Path

from homeassistant.util.yaml import parse_yaml

DOC = Path(__file__).parent.parent / "docs" / "arcane-dashboards.md"
TAGS = {
    "cuest-arcane-header", "cuest-orb-card", "cuest-trail-card", "cuest-rune-gauge",
    "cuest-quest-board", "cuest-allies-card", "cuest-hero-card", "cuest-rooms-card",
    "cuest-bard-card", "cuest-spell-tile", "cuest-stamina-card",
}
BLOCK = re.compile(r"```yaml\n(.*?)```", re.S)


def _blocks() -> list[str]:
    return BLOCK.findall(DOC.read_text(encoding="utf-8"))


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def test_every_yaml_block_parses():
    blocks = _blocks()
    assert len(blocks) >= 8
    for b in blocks:
        parse_yaml(b)


def test_only_known_cuest_cards():
    seen = set()
    for b in _blocks():
        for d in _walk(parse_yaml(b)):
            t = d.get("type")
            if isinstance(t, str) and t.startswith("custom:cuest-"):
                assert t.removeprefix("custom:") in TAGS, t
                seen.add(t.removeprefix("custom:"))
    assert seen == TAGS


def test_doc_text_mentions_only_real_card_names():
    text = DOC.read_text(encoding="utf-8")
    assert "arcane-orb-card" not in text.replace("cuest-orb-card", "")
    for name in set(re.findall(r"custom:(cuest-[a-z-]+)", text)):
        assert name in TAGS, name


def test_theme_block():
    for b in _blocks():
        data = parse_yaml(b)
        if isinstance(data, dict) and "Cuest Arcane" in data:
            assert data["Cuest Arcane"]["primary-background-color"] == "#14172A"
            return
    raise AssertionError("no Cuest Arcane theme block")


ORB = {
    "preset", "color", "entity", "max", "label", "sublabel",
    "domains", "integrations", "exclude", "battery_threshold",
}
KEYS = {
    "cuest-arcane-header": {"type", "title", "mood", "outside", "inside", "variant", "orbs", "grid_options"},
    "cuest-orb-card": {"type", "orbs"} | ORB,
    "cuest-trail-card": {"type", "entity", "entity2", "name", "name2", "hours", "title"},
    "cuest-rune-gauge": {"type", "entity", "rune", "name", "controls", "min", "max"},
    "cuest-quest-board": {
        "type", "title", "variant", "limit", "battery_threshold", "exclude",
        "more_path", "show_summary", "allow_add",
    },
    "cuest-allies-card": {"type", "title", "limit", "min_entities", "ignore", "names"},
    "cuest-hero-card": {"type", "player"},
    "cuest-rooms-card": {"type", "title", "heading", "areas", "path", "battery_threshold"},
    "cuest-bard-card": {"type", "entity", "variant", "name", "sources"},
    "cuest-spell-tile": {
        "type", "variant", "entity", "name", "icon", "tone", "state_text", "tap_action",
    },
    "cuest-stamina-card": {"type", "title", "entities", "exclude", "limit", "threshold"},
}


def test_option_keys_are_accepted_by_the_cards():
    for b in _blocks():
        for d in _walk(parse_yaml(b)):
            t = d.get("type")
            if isinstance(t, str) and t.startswith("custom:cuest-"):
                tag = t.removeprefix("custom:")
                assert set(d) <= KEYS[tag], (tag, set(d) - KEYS[tag])
            if "preset" in d:
                assert set(d) <= ORB, set(d) - ORB
