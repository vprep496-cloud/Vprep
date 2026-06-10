from pydantic import BaseModel


# Tracks are now admin-extensible, so IDs are validated against the runtime
# catalog rather than a hardcoded enum. The six built-ins still use their
# original string ids.
TrackId = str


class Track(BaseModel):
    id: TrackId
    name: str
    description: str
    icon: str
    color: str
    total_days: int
    topic_areas: list[str] = []
