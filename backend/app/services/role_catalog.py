"""Curated target-role catalog per track + role-aware difficulty.

Each track a candidate prepares for has several realistic target roles (e.g.
ML & AI → Junior ML Engineer, MLOps Engineer, AI Engineer, …). Every role
carries:

- ``seniority`` (junior | mid | senior) — the bar the candidate is interviewing
  against. This, blended with the candidate's own assessed skill level, decides
  how hard the generated/sampled questions should be. Junior roles produce
  easier questions even for a strong candidate, exactly as a real junior loop
  would.
- ``focus`` — concrete topic keywords that steer question generation so a
  "MLOps Engineer" gets pipeline/serving/monitoring questions while an "AI
  Engineer" gets LLM/RAG/prompt questions, even on the same track.

This module is pure data + helpers (no DB, no I/O) so it can be imported freely
by the tracks router, enrollment service, and interview service without any
circular-import risk.
"""
from __future__ import annotations

from typing import Literal, TypedDict

Seniority = Literal["junior", "mid", "senior"]


class Role(TypedDict):
    id: str
    label: str
    seniority: Seniority
    focus: list[str]


# Ordered: the first role with seniority "mid" is treated as the track's
# canonical default. Lists are curated to cover the common interview targets a
# candidate on each track would realistically prepare for.
ROLE_CATALOG: dict[str, list[Role]] = {
    "ml_ai": [
        {"id": "junior_ml_engineer", "label": "Junior ML Engineer", "seniority": "junior",
         "focus": ["python", "ml fundamentals", "scikit-learn", "data preprocessing", "model evaluation", "overfitting"]},
        {"id": "ml_engineer", "label": "Machine Learning Engineer", "seniority": "mid",
         "focus": ["model training", "feature engineering", "deep learning", "model deployment", "evaluation metrics", "bias-variance"]},
        {"id": "mlops_engineer", "label": "MLOps Engineer", "seniority": "mid",
         "focus": ["ml pipelines", "model serving", "ci/cd for ml", "model monitoring", "docker", "kubernetes", "experiment tracking", "feature stores"]},
        {"id": "ai_engineer", "label": "AI Engineer", "seniority": "mid",
         "focus": ["large language models", "prompt engineering", "retrieval-augmented generation", "vector databases", "embeddings", "fine-tuning", "model apis"]},
        {"id": "nlp_engineer", "label": "NLP Engineer", "seniority": "mid",
         "focus": ["transformers", "tokenization", "embeddings", "text classification", "named entity recognition", "sequence models"]},
        {"id": "computer_vision_engineer", "label": "Computer Vision Engineer", "seniority": "mid",
         "focus": ["convolutional neural networks", "image classification", "object detection", "segmentation", "opencv", "data augmentation"]},
        {"id": "senior_ml_engineer", "label": "Senior ML Engineer", "seniority": "senior",
         "focus": ["ml system design", "scalable training", "distributed systems", "model tradeoffs", "production reliability", "mentoring"]},
    ],
    "web_dev": [
        {"id": "junior_frontend_developer", "label": "Junior Frontend Developer", "seniority": "junior",
         "focus": ["html", "css", "javascript fundamentals", "the dom", "responsive design", "basic react"]},
        {"id": "frontend_developer", "label": "Frontend Developer", "seniority": "mid",
         "focus": ["react", "state management", "hooks", "typescript", "accessibility", "browser performance", "rest apis"]},
        {"id": "backend_developer", "label": "Backend Developer", "seniority": "mid",
         "focus": ["rest api design", "databases", "authentication", "caching", "node.js", "sql", "error handling"]},
        {"id": "fullstack_developer", "label": "Full-Stack Developer", "seniority": "mid",
         "focus": ["react", "rest apis", "databases", "authentication", "deployment", "end-to-end features"]},
        {"id": "react_developer", "label": "React Developer", "seniority": "mid",
         "focus": ["react", "hooks", "context", "performance optimization", "component design", "testing"]},
        {"id": "senior_fullstack_engineer", "label": "Senior Full-Stack Engineer", "seniority": "senior",
         "focus": ["web system design", "scalability", "api architecture", "security", "performance", "tradeoffs"]},
    ],
    "devops": [
        {"id": "junior_devops_engineer", "label": "Junior DevOps Engineer", "seniority": "junior",
         "focus": ["linux basics", "git", "bash scripting", "ci/cd basics", "docker basics"]},
        {"id": "devops_engineer", "label": "DevOps Engineer", "seniority": "mid",
         "focus": ["ci/cd pipelines", "docker", "kubernetes", "infrastructure as code", "monitoring", "automation"]},
        {"id": "sre", "label": "Site Reliability Engineer", "seniority": "mid",
         "focus": ["slos and slis", "incident response", "observability", "reliability", "on-call", "postmortems", "capacity planning"]},
        {"id": "platform_engineer", "label": "Platform Engineer", "seniority": "senior",
         "focus": ["internal platforms", "kubernetes", "terraform", "developer experience", "system design", "scalability"]},
        {"id": "cloud_infra_engineer", "label": "Cloud Infrastructure Engineer", "seniority": "mid",
         "focus": ["cloud networking", "terraform", "iam", "cost optimization", "high availability"]},
        {"id": "senior_devops_engineer", "label": "Senior DevOps Engineer", "seniority": "senior",
         "focus": ["platform architecture", "security", "scalability", "disaster recovery", "tradeoffs", "mentoring"]},
    ],
    "data_science": [
        {"id": "junior_data_analyst", "label": "Junior Data Analyst", "seniority": "junior",
         "focus": ["sql basics", "spreadsheets", "descriptive statistics", "data cleaning", "charts"]},
        {"id": "data_analyst", "label": "Data Analyst", "seniority": "mid",
         "focus": ["sql", "pandas", "data visualization", "a/b testing basics", "dashboards", "storytelling with data"]},
        {"id": "data_scientist", "label": "Data Scientist", "seniority": "mid",
         "focus": ["statistics", "hypothesis testing", "machine learning", "feature engineering", "experimental design", "pandas"]},
        {"id": "ml_analyst", "label": "Machine Learning Analyst", "seniority": "mid",
         "focus": ["predictive modeling", "model evaluation", "feature selection", "scikit-learn", "interpretation"]},
        {"id": "bi_analyst", "label": "Business Intelligence Analyst", "seniority": "mid",
         "focus": ["sql", "data modeling", "etl", "dashboards", "kpis", "reporting"]},
        {"id": "senior_data_scientist", "label": "Senior Data Scientist", "seniority": "senior",
         "focus": ["experimentation at scale", "causal inference", "ml system design", "stakeholder communication", "tradeoffs"]},
    ],
    "cloud": [
        {"id": "junior_cloud_engineer", "label": "Junior Cloud Engineer", "seniority": "junior",
         "focus": ["cloud basics", "compute and storage", "iam basics", "networking basics", "the cli"]},
        {"id": "cloud_engineer", "label": "Cloud Engineer", "seniority": "mid",
         "focus": ["compute", "storage", "networking", "iam", "infrastructure as code", "cost management"]},
        {"id": "cloud_solutions_architect", "label": "Cloud Solutions Architect", "seniority": "senior",
         "focus": ["cloud architecture", "high availability", "disaster recovery", "well-architected framework", "cost optimization", "tradeoffs"]},
        {"id": "cloud_security_engineer", "label": "Cloud Security Engineer", "seniority": "mid",
         "focus": ["iam", "encryption", "network security", "compliance", "threat modeling", "least privilege"]},
        {"id": "cloud_devops_engineer", "label": "Cloud DevOps Engineer", "seniority": "mid",
         "focus": ["ci/cd", "serverless", "containers", "infrastructure as code", "monitoring"]},
        {"id": "senior_cloud_architect", "label": "Senior Cloud Architect", "seniority": "senior",
         "focus": ["multi-region architecture", "scalability", "security architecture", "migration strategy", "tradeoffs"]},
    ],
    "mobile_dev": [
        {"id": "junior_mobile_developer", "label": "Junior Mobile Developer", "seniority": "junior",
         "focus": ["mobile ui basics", "components", "navigation", "state basics", "app lifecycle"]},
        {"id": "react_native_developer", "label": "React Native Developer", "seniority": "mid",
         "focus": ["react native", "navigation", "state management", "native modules", "performance", "async storage"]},
        {"id": "ios_developer", "label": "iOS Developer", "seniority": "mid",
         "focus": ["swift", "uikit or swiftui", "app lifecycle", "memory management", "concurrency", "app store"]},
        {"id": "android_developer", "label": "Android Developer", "seniority": "mid",
         "focus": ["kotlin", "activity lifecycle", "jetpack", "coroutines", "memory", "play store"]},
        {"id": "mobile_engineer", "label": "Mobile Engineer", "seniority": "mid",
         "focus": ["cross-platform", "performance optimization", "offline support", "push notifications", "release management"]},
        {"id": "senior_mobile_engineer", "label": "Senior Mobile Engineer", "seniority": "senior",
         "focus": ["mobile architecture", "scalability", "performance", "ci/cd for mobile", "tradeoffs", "mentoring"]},
    ],
}

_SENIORITY_LABELS: dict[Seniority, str] = {
    "junior": "Junior",
    "mid": "Mid-level",
    "senior": "Senior",
}

_LEVEL_SCORE = {"beginner": 1, "intermediate": 2, "advanced": 3}
_SENIORITY_SCORE: dict[Seniority, int] = {"junior": 1, "mid": 2, "senior": 3}
_SCORE_TO_DIFFICULTY = {1: "easy", 2: "medium", 3: "hard"}

# Keyword hints to infer seniority for a free-typed custom role.
_JUNIOR_HINTS = ("junior", "jr ", "jr.", "intern", "graduate", "entry", "trainee", "associate")
_SENIOR_HINTS = ("senior", "sr ", "sr.", "lead", "principal", "staff", "architect", "head of", "manager")


def seniority_label(seniority: str) -> str:
    return _SENIORITY_LABELS.get(seniority, "Mid-level")  # type: ignore[arg-type]


def infer_seniority_from_label(label: str | None) -> Seniority:
    text = f" {(label or '').lower().strip()} "
    if any(hint in text for hint in _SENIOR_HINTS):
        return "senior"
    if any(hint in text for hint in _JUNIOR_HINTS):
        return "junior"
    return "mid"


def roles_for_track(track: dict) -> list[Role]:
    """Curated roles for a track. Built-in tracks use the catalog; admin-created
    tracks get a generated junior/mid/senior trio from their name + topics so
    they still offer a meaningful choice."""
    track_id = track.get("id", "")
    if track_id in ROLE_CATALOG:
        return ROLE_CATALOG[track_id]

    name = (track.get("name") or "Track").strip()
    base = name
    if not base.lower().endswith(("engineer", "developer", "scientist", "analyst", "specialist")):
        base = f"{name} Engineer"
    topics = [str(topic) for topic in (track.get("topic_areas") or [])][:6]
    return [
        {"id": f"{track_id}_junior", "label": f"Junior {base}", "seniority": "junior", "focus": topics[:4] or [name.lower()]},
        {"id": f"{track_id}_mid", "label": base, "seniority": "mid", "focus": topics or [name.lower()]},
        {"id": f"{track_id}_senior", "label": f"Senior {base}", "seniority": "senior",
         "focus": (topics or [name.lower()]) + ["system design", "tradeoffs"]},
    ]


def default_role(track: dict) -> Role:
    """The track's canonical default role (first mid-level role, else first)."""
    roles = roles_for_track(track)
    for role in roles:
        if role["seniority"] == "mid":
            return role
    return roles[0]


def find_role(track: dict, *, role_id: str | None = None, label: str | None = None) -> Role | None:
    """Match a role by id first, then by case-insensitive label."""
    roles = roles_for_track(track)
    if role_id:
        for role in roles:
            if role["id"] == role_id:
                return role
    if label:
        wanted = label.strip().lower()
        for role in roles:
            if role["label"].lower() == wanted:
                return role
    return None


def focus_for_role(track_id: str, role_id: str | None = None, label: str | None = None) -> list[str]:
    """Focus keywords for a built-in role (by id, then label). Returns [] for
    custom roles/tracks — callers fall back to the track's topic areas."""
    roles = ROLE_CATALOG.get(track_id, [])
    if role_id:
        for role in roles:
            if role["id"] == role_id:
                return list(role["focus"])
    if label:
        wanted = label.strip().lower()
        for role in roles:
            if role["label"].lower() == wanted:
                return list(role["focus"])
    return []


def effective_difficulty(skill_level: str | None, seniority: str | None) -> str:
    """Blend the candidate's assessed skill with the role's seniority into a
    question difficulty. Role seniority is weighted slightly higher so a junior
    role stays approachable even for a strong candidate, and a senior role
    stretches even a confident one — mirroring real interview loops."""
    skill = _LEVEL_SCORE.get(str(skill_level or "").lower(), 2)
    role = _SENIORITY_SCORE.get(str(seniority or "").lower(), 2)  # type: ignore[arg-type]
    blended = round(0.55 * role + 0.45 * skill)
    blended = max(1, min(blended, 3))
    return _SCORE_TO_DIFFICULTY[blended]
