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


# --- Option keys, required keys and enum values come from the card sources. ---

SRC = Path(__file__).parent.parent / "frontend" / "src" / "arcane"
FILES = {
    "cuest-arcane-header": "header.ts", "cuest-orb-card": "orb.ts",
    "cuest-trail-card": "trail.ts", "cuest-rune-gauge": "rune.ts",
    "cuest-quest-board": "quest-board.ts", "cuest-allies-card": "allies.ts",
    "cuest-hero-card": "hero.ts", "cuest-rooms-card": "rooms.ts",
    "cuest-bard-card": "bard.ts", "cuest-spell-tile": "spell-tile.ts",
    "cuest-stamina-card": "stamina.ts",
}
EXTRA = {"type", "grid_options"}
CALL = re.compile(r"(?:v\.\w+|strings)\(\s*\w+,\s*'(\w+)'([^;]*?)\)")


def _source(tag: str) -> str:
    return (SRC / FILES[tag]).read_text(encoding="utf-8")


def _accepted(tag: str) -> set[str]:
    src = _source(tag)
    keys = {m.group(1) for m in CALL.finditer(src)}
    keys |= set(re.findall(r"\b(?:raw|o|r|ta|item)\.(\w+)", src))
    keys |= set(re.findall(r"\b(?:raw|o|r)\[?'(\w+)'", src))
    if tag == "cuest-arcane-header":
        keys |= _accepted("cuest-orb-card") - {"orbs"}
        keys.add("orbs")
    return keys | EXTRA


def _required(tag: str) -> set[str]:
    out = set()
    for m in CALL.finditer(_source(tag)):
        if re.search(r"\btrue\b", m.group(2)) and m.group(0).startswith(("v.str", "v.entity")):
            out.add(m.group(1))
    return out


def _enum(tag: str, key: str) -> set[str] | None:
    src = _source(tag)
    m = re.search(r"v\.oneOf\(\s*\w+,\s*'%s',\s*[^,]+,\s*(\[[^\]]*\]|\w+)" % key, src)
    if not m:
        return None
    arr = m.group(1)
    if not arr.startswith("["):
        d = re.search(r"const %s\b[^=]*=\s*(\[[^\]]*\])" % arr, src)
        arr = d.group(1)
    return set(re.findall(r"'([^']+)'", arr))


def _is_orb_item(d: dict) -> bool:
    return "preset" in d or ("label" in d and "entity" not in d and "orbs" not in d and "type" not in d)


def test_option_keys_required_keys_and_enums_match_the_card_sources():
    assert "preset" in _required("cuest-orb-card")
    assert _enum("cuest-orb-card", "preset") == {"percent", "ratio", "online", "lights", "health"}
    for b in _blocks():
        for d in _walk(parse_yaml(b)):
            t = d.get("type")
            if not (isinstance(t, str) and t.startswith("custom:cuest-")):
                continue
            tag = t.removeprefix("custom:")
            assert set(d) <= _accepted(tag), (tag, set(d) - _accepted(tag))
            if tag == "cuest-orb-card" and "orbs" not in d:
                assert "preset" in d, "a single orb needs preset"
            elif tag not in ("cuest-orb-card", "cuest-spell-tile"):
                assert _required(tag) - {"area", "name", "service", "preset"} <= set(d), tag
            for key, val in d.items():
                allowed = _enum(tag, key)
                if allowed is not None:
                    assert val in allowed, (tag, key, val)
            for orb in d.get("orbs", []):
                assert "preset" in orb and orb["preset"] in _enum("cuest-orb-card", "preset")
                assert set(orb) <= _accepted("cuest-orb-card"), set(orb)


def test_reference_tables_agree_with_the_sources():
    text = DOC.read_text(encoding="utf-8")
    ref = text.split("## 3. Card reference")[1].split("## 4. Dashboards")[0]
    for section in re.split(r"\n### ", ref)[1:]:
        tag = section.split("\n", 1)[0].strip()
        if tag not in FILES:
            continue
        rows = re.findall(r"^\| ((?:`\w+`(?:, )?)+) \| ([^|]*) \|", section, re.M)
        documented = {}
        for names, default in rows:
            for n in re.findall(r"`(\w+)`", names):
                documented[n] = default.strip()
        assert set(documented) <= _accepted(tag), (tag, set(documented) - _accepted(tag))
        for key in _required(tag):
            if key in documented and key not in ("name", "service", "area"):
                assert documented[key].startswith("required"), (tag, key, documented[key])
