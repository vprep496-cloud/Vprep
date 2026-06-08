"""
V-Prep demo data seed script.

Creates 5 realistic candidate users with enrollments, assessment results, and
completed mock-interview sessions so the app looks active during the FYP
presentation.

Usage:
    python scripts/seed_demo_data.py

Design constraints (Phase 7 Agent Rule #4):
  - Idempotent: running twice produces the same state, not doubled data.
    Each demo user is identified by email; every dependent document is keyed by
    (user_id, track_id) so re-running simply skips already-present records.
  - No real Firebase auth: users are created directly in the `users` collection
    with a fake `firebase_uid` (uuid4 prefix + email slug) that will never
    collide with a real Google UID.
"""

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

# ---------------------------------------------------------------------------
# Bootstrap: add the backend root to sys.path so `app.*` imports work when
# the script is run from *either* the `backend/` root or the project root.
# ---------------------------------------------------------------------------
_script_dir = os.path.dirname(os.path.abspath(__file__))
_backend_root = os.path.dirname(_script_dir)
if _backend_root not in sys.path:
    sys.path.insert(0, _backend_root)

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402 (post-sys-path import)

# ---------------------------------------------------------------------------
# Configuration — loaded from the same .env the FastAPI app uses.
# ---------------------------------------------------------------------------
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_backend_root, ".env"))
except ImportError:
    pass  # python-dotenv not installed; rely on environment variables directly

MONGODB_URL = os.environ.get("MONGODB_URL", "mongodb://localhost:27017")
MONGODB_DB_NAME = os.environ.get("MONGODB_DB_NAME", "vprep")

# ---------------------------------------------------------------------------
# Demo candidates definition
# ---------------------------------------------------------------------------
# score_range: (min, max) overall_score for sessions
# current_day: enrollment progress snapshot
# assessment_score: 0-100 overall assessment score

DEMO_CANDIDATES: list[dict[str, Any]] = [
    {
        "name": "Ahmad Raza",
        "email": "ahmad.raza@demo.vprep",
        "track_id": "ml_ai",
        "skill_level": "intermediate",
        "current_day": 12,
        "assessment_score": 68,
        "average_score": 67.0,
        "session_scores": [72, 65, 64],
    },
    {
        "name": "Fatima Malik",
        "email": "fatima.malik@demo.vprep",
        "track_id": "web_dev",
        "skill_level": "beginner",
        "current_day": 4,
        "assessment_score": 49,
        "average_score": 50.0,
        "session_scores": [48, 52],
    },
    {
        "name": "Usman Khan",
        "email": "usman.khan@demo.vprep",
        "track_id": "devops",
        "skill_level": "advanced",
        "current_day": 18,
        "assessment_score": 84,
        "average_score": 83.0,
        "session_scores": [85, 80, 84],
    },
    {
        "name": "Sara Ahmed",
        "email": "sara.ahmed@demo.vprep",
        "track_id": "data_science",
        "skill_level": "intermediate",
        "current_day": 9,
        "assessment_score": 70,
        "average_score": 65.5,
        "session_scores": [63, 68],
    },
    {
        "name": "Ali Hassan",
        "email": "ali.hassan@demo.vprep",
        "track_id": "ml_ai",
        "skill_level": "beginner",
        "current_day": 3,
        "assessment_score": 45,
        "average_score": 47.0,
        "session_scores": [50, 44, 47],
    },
]

# ---------------------------------------------------------------------------
# Per-track topic areas (used to build realistic assessment breakdowns).
# Mirrors the rubric keys the Gemini service actually uses so that the admin
# portal's assessment tab renders recognisable labels.
# ---------------------------------------------------------------------------
TOPIC_AREAS: dict[str, list[str]] = {
    "ml_ai": ["Machine Learning", "Deep Learning", "Model Evaluation", "Python & Libraries", "MLOps"],
    "web_dev": ["HTML & CSS", "JavaScript", "React", "REST APIs", "Performance"],
    "devops": ["CI/CD", "Containerisation", "Infrastructure as Code", "Monitoring", "Cloud Platforms"],
    "data_science": ["Statistics", "Data Wrangling", "Visualisation", "Feature Engineering", "SQL"],
    "cloud": ["Architecture", "Compute", "Networking", "Security", "Cost Optimisation"],
    "mobile_dev": ["React Native", "State Management", "Native APIs", "Performance", "Testing"],
}

PHASE_MODES: dict[str, list[str]] = {
    "hr": ["hr"],
    "technical": ["technical"],
    "behavioral": ["behavioral"],
    "full_mock": ["hr", "technical", "behavioral"],
}

SESSION_MODES = ["full_mock", "technical", "hr"]


def _fake_uid(email: str) -> str:
    """Generate a deterministic-but-fake Firebase UID for a demo email."""
    slug = email.replace("@", "_").replace(".", "_")
    return f"demo_{slug}_{uuid.uuid5(uuid.NAMESPACE_DNS, email).hex[:8]}"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _days_ago(days: float) -> datetime:
    return _now_utc() - timedelta(days=days)


def _build_assessment_breakdown(
    track_id: str, overall_score: int, skill_level: str
) -> dict[str, int]:
    """
    Produce a realistic per-topic breakdown that averages to `overall_score`.
    Beginners get higher variance; advanced candidates get tighter scores.
    """
    topics = TOPIC_AREAS.get(track_id, ["General"])[:5]
    variance = {"beginner": 18, "intermediate": 12, "advanced": 7}[skill_level]
    import random
    rng = random.Random(f"{track_id}_{overall_score}")
    raw = [max(0, min(100, overall_score + rng.randint(-variance, variance))) for _ in topics]
    # Nudge so average matches overall_score closely
    diff = overall_score - (sum(raw) // len(raw))
    raw[0] = max(0, min(100, raw[0] + diff))
    return dict(zip(topics, raw))


def _build_phase_results(
    phases: list[str], overall_score: int
) -> list[dict[str, Any]]:
    """Build a realistic phase_results list for a session document."""
    import random
    rng = random.Random(str(overall_score) + str(phases))
    results = []
    for phase in phases:
        phase_score = max(0, min(100, overall_score + rng.randint(-10, 10)))
        q_count = {"hr": 4, "technical": 5, "behavioral": 4}.get(phase, 4)
        answers = []
        for i in range(q_count):
            q_score = max(0, min(100, phase_score + rng.randint(-15, 15)))
            answers.append({
                "question_id": f"demo_q_{phase}_{i}",
                "question_text": f"Demo {phase.title()} question {i + 1}",
                "answer_type": "text",
                "user_text_answer": "This is a demo answer for the FYP presentation.",
                "transcription": None,
                "score": q_score,
                "feedback": "Good structure. Could elaborate on edge cases.",
                "model_answer": "A strong answer would cover X, Y, and Z with concrete examples.",
                "criteria_scores": {},
            })
        results.append({
            "phase": phase,
            "phase_score": phase_score,
            "answers": answers,
        })
    return results


async def seed(db_url: str, db_name: str) -> None:
    client: AsyncIOMotorClient = AsyncIOMotorClient(db_url)
    db = client[db_name]

    counters = {"users": 0, "enrollments": 0, "assessments": 0, "sessions": 0, "skipped": 0}

    for candidate in DEMO_CANDIDATES:
        email = candidate["email"]
        firebase_uid = _fake_uid(email)
        track_id = candidate["track_id"]
        skill_level = candidate["skill_level"]

        # ------------------------------------------------------------------
        # 1. User — skip if already exists (idempotency check by email).
        # ------------------------------------------------------------------
        existing_user = await db["users"].find_one({"email": email})
        if existing_user:
            user_id = str(existing_user["_id"])
            print(f"  ⏭  Skipping existing user: {email} (id={user_id})")
            counters["skipped"] += 1
        else:
            user_doc = {
                "firebase_uid": firebase_uid,
                "email": email,
                "display_name": candidate["name"],
                "photo_url": None,
                "role": "candidate",
                "created_at": _days_ago(20),
            }
            result = await db["users"].insert_one(user_doc)
            user_id = str(result.inserted_id)
            counters["users"] += 1
            print(f"  ✔  Created user: {email} (id={user_id})")

        # ------------------------------------------------------------------
        # 2. Enrollment — idempotency: (user_id, track_id) compound key.
        # ------------------------------------------------------------------
        from bson import ObjectId  # noqa: PLC0415 — local import to avoid top-level failure
        obj_user_id = ObjectId(user_id)
        existing_enrollment = await db["enrollments"].find_one(
            {"user_id": user_id, "track_id": track_id}
        )
        if not existing_enrollment:
            enrollment_doc = {
                "user_id": user_id,
                "track_id": track_id,
                "skill_level": skill_level,
                "start_date": _days_ago(20),
                "current_day": candidate["current_day"],
                "average_score": candidate["average_score"],
                "total_sessions": len(candidate["session_scores"]),
                "plan_exists": True,
                "updated_at": _days_ago(1),
            }
            await db["enrollments"].insert_one(enrollment_doc)
            counters["enrollments"] += 1

        # ------------------------------------------------------------------
        # 3. Assessment result — idempotency: (user_id, track_id).
        # ------------------------------------------------------------------
        existing_assessment = await db["assessments"].find_one(
            {"user_id": user_id, "track_id": track_id}
        )
        if not existing_assessment:
            breakdown = _build_assessment_breakdown(
                track_id, candidate["assessment_score"], skill_level
            )
            assessment_doc = {
                "user_id": user_id,
                "track_id": track_id,
                "skill_level": skill_level,
                "score": candidate["assessment_score"],
                "breakdown": breakdown,
                "per_question_feedback": [],  # omit for demo brevity
                "created_at": _days_ago(19),
            }
            await db["assessments"].insert_one(assessment_doc)
            counters["assessments"] += 1

        # ------------------------------------------------------------------
        # 4. Completed sessions — idempotency: check count already matching.
        # ------------------------------------------------------------------
        existing_sessions_count = await db["sessions"].count_documents(
            {"user_id": user_id, "track_id": track_id, "status": "completed"}
        )
        target_count = len(candidate["session_scores"])

        if existing_sessions_count < target_count:
            for idx, score in enumerate(candidate["session_scores"]):
                if idx < existing_sessions_count:
                    continue  # already seeded on a prior run
                mode = SESSION_MODES[idx % len(SESSION_MODES)]
                phases = PHASE_MODES[mode]
                phase_results = _build_phase_results(phases, score)
                days_offset = (target_count - idx) * 3.5  # spread over last 14 days
                session_doc = {
                    "user_id": user_id,
                    "track_id": track_id,
                    "mode": mode,
                    "status": "completed",
                    "overall_score": score,
                    "phase_results": phase_results,
                    "started_at": _days_ago(days_offset + 0.05),
                    "completed_at": _days_ago(days_offset),
                    "duration_seconds": 600 + (idx * 120),
                    "questions": {},
                }
                await db["sessions"].insert_one(session_doc)
                counters["sessions"] += 1

    client.close()

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    print("\n" + "=" * 52)
    print("  V-Prep demo seed complete")
    print("=" * 52)
    print(f"  Users created     : {counters['users']}")
    print(f"  Enrollments added : {counters['enrollments']}")
    print(f"  Assessments added : {counters['assessments']}")
    print(f"  Sessions added    : {counters['sessions']}")
    print(f"  Users skipped (already existed): {counters['skipped']}")
    print("=" * 52)


if __name__ == "__main__":
    print(f"Seeding demo data into {MONGODB_DB_NAME} @ {MONGODB_URL[:40]}...")
    asyncio.run(seed(MONGODB_URL, MONGODB_DB_NAME))
