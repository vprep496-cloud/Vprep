# Stub models — expanded with full track CRUD/logic in Phase 3.
from enum import Enum

from pydantic import BaseModel


class TrackId(str, Enum):
    ml_ai = "ml_ai"
    web_dev = "web_dev"
    devops = "devops"
    data_science = "data_science"
    cloud = "cloud"
    mobile_dev = "mobile_dev"


class Track(BaseModel):
    id: TrackId
    name: str
    description: str
    icon: str
    color: str
    total_days: int
