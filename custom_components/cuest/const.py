"""Constants for the Cuest bridge."""

DOMAIN = "cuest"

EVENT_QUEST_OPENED = "cuest_quest_opened"
EVENT_QUEST_DONE = "cuest_quest_done"
EVENT_LEVEL_UP = "cuest_level_up"

SERVICE_COMPLETE_QUEST = "complete_quest"
SERVICE_START_QUEST = "start_quest"

ALLOWED_DOMAINS = frozenset({"notify", "light"})

CONF_URL = "url"
CONF_SECRET = "secret"
