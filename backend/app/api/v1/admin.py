# Phase 6 — full admin portal backend: dashboard stats, candidate directory +
# detail, question-bank CRUD, analytics, and session review. Routers stay
# thin; all aggregation pipelines are inlined here (this is a brand-new file,
# so there's no existing service-module split to mirror — and every route is
# a single, self-contained read or write with no multi-step orchestration that
# would benefit from extraction, unlike interview_service/assessment_service).
#
# Agent Rule #3: every route below requires at least `require_role("admin",
# "superadmin")`; the four question-mutation routes additionally narrow to
# `require_role("superadmin")`.
# Agent Rule #4: every aggregate computation (`$group`/`$count`/`$avg`/`$max`/
# `$facet`) runs as a MongoDB pipeline — nothing is loaded in bulk and reduced
# in Python.
import math
from datetime import datetime, timedelta, timezone

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel
from pymongo import ReturnDocument

from app.api.v1.tracks import TRACKS_BY_ID
from app.core.database import get_db
from app.core.dependencies import require_role
from app.services.interview_service import to_session_result

router = APIRouter()

_VALID_PHASES = {"hr", "technical", "behavioral"}
# Phase -> the only `answer_type` the spec allows for it (POST/PUT validation).
_ANSWER_TYPE_BY_PHASE = {"hr": "voice", "behavioral": "voice", "technical": "text"}
_TRACK_IDS = list(TRACKS_BY_ID.keys())


# ---------------------------------------------------------------------------
# Request models — kept local to this router rather than added to
# app/models/*.py: there is no pre-existing `Question` Pydantic model anywhere
# in the codebase (the `questions` collection has only ever been handled as
# raw dicts, in interview_service.py's sampling/sanitization), so introducing
# one would mean either inventing a new models file or modifying an unrelated
# Phase 1-5 one — both overreach for two small admin-only request bodies.
# Defining them here keeps this brand-new file fully self-contained and
# Agent-Rule-#1-clean.
# ---------------------------------------------------------------------------


class QuestionCreate(BaseModel):
    track_id: str
    phase: str
    question_text: str
    answer_type: str
    difficulty: str
    scoring_criteria: list[str]
    model_answer: str
    tags: list[str] = []


class QuestionUpdate(BaseModel):
    track_id: str | None = None
    phase: str | None = None
    question_text: str | None = None
    answer_type: str | None = None
    difficulty: str | None = None
    scoring_criteria: list[str] | None = None
    model_answer: str | None = None
    tags: list[str] | None = None


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _object_id_or_404(raw_id: str, not_found_detail: str) -> ObjectId:
    try:
        return ObjectId(raw_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)


def _serialize(doc: dict) -> dict:
    """Convert a Mongo document's `_id` -> string `id` (a `_serialize_user`-
    style helper, mirrored locally per Agent Rule #1 rather than importing
    users.py's private one)."""
    serialized = dict(doc)
    serialized["id"] = str(serialized.pop("_id"))
    return serialized


def _validate_question_fields(phase: str | None, answer_type: str | None) -> None:
    """Shared POST/PUT validation: `phase` must be one of the three known
    phases, and `answer_type` (when both are known) must match the phase's
    fixed answer modality — voice for HR/Behavioral, text for Technical."""
    if phase is not None and phase not in _VALID_PHASES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="phase must be one of: hr, technical, behavioral.",
        )
    if phase is not None and answer_type is not None:
        expected = _ANSWER_TYPE_BY_PHASE[phase]
        if answer_type != expected:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"answer_type for '{phase}' questions must be '{expected}'.",
            )


# ---------------------------------------------------------------------------
# GET /stats — dashboard summary
# ---------------------------------------------------------------------------


@router.get("/stats")
async def get_stats(
    _current_user: dict = Depends(require_role("admin", "superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Single-aggregation-per-collection dashboard summary. Each collection is
    visited exactly once via `$facet`, computing every metric that collection
    owns in one pipeline pass — `$count`/`$avg`/`$group` throughout, never a
    bulk load-and-reduce in Python (Agent Rule #4)."""

    users_facets = await db["users"].aggregate([
        {"$facet": {
            "candidates": [{"$match": {"role": "candidate"}}, {"$count": "n"}],
            "admins": [{"$match": {"role": {"$in": ["admin", "superadmin"]}}}, {"$count": "n"}],
        }}
    ]).to_list(length=1)

    sessions_facets = await db["sessions"].aggregate([
        {"$facet": {
            "active": [{"$match": {"status": "in_progress"}}, {"$count": "n"}],
            "completed": [{"$match": {"status": "completed"}}, {"$count": "n"}],
            "avg_score": [
                {"$match": {"status": "completed"}},
                {"$group": {"_id": None, "avg": {"$avg": "$overall_score"}}},
            ],
        }}
    ]).to_list(length=1)

    enrollments_facets = await db["enrollments"].aggregate([
        {"$facet": {
            "total": [{"$count": "n"}],
            "by_track": [{"$group": {"_id": "$track_id", "n": {"$sum": 1}}}],
        }}
    ]).to_list(length=1)

    def _count(facet_result: list[dict], key: str) -> int:
        bucket = facet_result[0][key] if facet_result else []
        return bucket[0]["n"] if bucket else 0

    avg_bucket = sessions_facets[0]["avg_score"] if sessions_facets else []
    average_overall_score = round(avg_bucket[0]["avg"], 1) if avg_bucket and avg_bucket[0]["avg"] is not None else 0.0

    # Seed every known track with 0 so the dashboard's distribution bar always
    # renders all six tracks, not just the ones with at least one enrollment.
    track_distribution: dict[str, int] = {track_id: 0 for track_id in _TRACK_IDS}
    for bucket in (enrollments_facets[0]["by_track"] if enrollments_facets else []):
        if bucket["_id"] in track_distribution:
            track_distribution[bucket["_id"]] = bucket["n"]

    return {
        "total_candidates": _count(users_facets, "candidates"),
        "total_admins": _count(users_facets, "admins"),
        "active_sessions": _count(sessions_facets, "active"),
        "completed_sessions": _count(sessions_facets, "completed"),
        "average_overall_score": average_overall_score,
        "total_enrollments": _count(enrollments_facets, "total"),
        "track_distribution": track_distribution,
    }


# ---------------------------------------------------------------------------
# GET /candidates — searchable / filterable directory
# ---------------------------------------------------------------------------


@router.get("/candidates")
async def list_candidates(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    role: str | None = Query(None),
    search: str | None = Query(None),
    track_id: str | None = Query(None),
    _current_user: dict = Depends(require_role("admin", "superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    query: dict = {}
    if role:
        query["role"] = role
    if search:
        pattern = {"$regex": search, "$options": "i"}
        query["$or"] = [{"email": pattern}, {"display_name": pattern}]

    if track_id:
        # `enrollments.user_id` stores the stringified user ObjectId — collect
        # the matching ids first (a single `distinct`, a Mongo-side command,
        # not an in-memory scan), then narrow the user query by `_id`.
        enrolled_user_ids = await db["enrollments"].distinct("user_id", {"track_id": track_id})
        object_ids: list[ObjectId] = []
        for raw_id in enrolled_user_ids:
            try:
                object_ids.append(ObjectId(raw_id))
            except (InvalidId, TypeError):
                continue
        query["_id"] = {"$in": object_ids}

    total = await db["users"].count_documents(query)
    pages = max(math.ceil(total / limit), 1)

    cursor = (
        db["users"]
        .find(query)
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )

    candidates: list[dict] = []
    async for user in cursor:
        user_id = str(user["_id"])

        enrollment_count = await db["enrollments"].count_documents({"user_id": user_id})
        session_count = await db["sessions"].count_documents({"user_id": user_id, "status": "completed"})

        avg_bucket = await db["sessions"].aggregate([
            {"$match": {"user_id": user_id, "status": "completed"}},
            {"$group": {"_id": None, "avg": {"$avg": "$overall_score"}}},
        ]).to_list(length=1)
        average_score = round(avg_bucket[0]["avg"], 1) if avg_bucket and avg_bucket[0]["avg"] is not None else None

        enriched = _serialize(user)
        enriched["enrollment_count"] = enrollment_count
        enriched["session_count"] = session_count
        enriched["average_score"] = average_score
        candidates.append(enriched)

    return {"candidates": candidates, "total": total, "page": page, "pages": pages}


# ---------------------------------------------------------------------------
# GET /candidates/{candidate_id} — full profile for the detail page
# ---------------------------------------------------------------------------


@router.get("/candidates/{candidate_id}")
async def get_candidate(
    candidate_id: str,
    _current_user: dict = Depends(require_role("admin", "superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    object_id = _object_id_or_404(candidate_id, "Candidate not found.")
    user = await db["users"].find_one({"_id": object_id})
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Candidate not found.")

    # --- Enrollments, enriched with the static track catalog entry (mirrors
    # enrollment_service.get_all_enrollments's `_attach_track_data` shape, but
    # re-implemented locally — that helper is keyed to db lookups for "the
    # current user" and isn't reusable for an arbitrary candidate_id without
    # an awkward call-as-another-user shape). ---
    enrollments: list[dict] = []
    async for enrollment in db["enrollments"].find({"user_id": candidate_id}).sort("updated_at", -1):
        enriched = _serialize(enrollment)
        enriched["track"] = TRACKS_BY_ID.get(enriched["track_id"])
        plan = await db["plans"].find_one({"user_id": candidate_id, "track_id": enriched["track_id"]}, {"_id": 1})
        enriched["plan_exists"] = plan is not None
        enrollments.append(enriched)

    # --- Most recent assessment result per track — single aggregation: sort
    # newest-first, group by track_id keeping only the first (`$first`) doc
    # per group, then flatten back to a document stream (Agent Rule #4: no
    # in-memory "keep the newest per track" loop over a full result set). ---
    assessments: list[dict] = []
    async for doc in db["assessments"].aggregate([
        {"$match": {"user_id": candidate_id}},
        {"$sort": {"created_at": -1}},
        {"$group": {"_id": "$track_id", "doc": {"$first": "$$ROOT"}}},
        {"$replaceRoot": {"newRoot": "$doc"}},
        {"$sort": {"created_at": -1}},
    ]):
        assessments.append(_serialize(doc))

    # --- Completed sessions, newest-first, capped at 20 ---
    sessions: list[dict] = []
    async for doc in (
        db["sessions"]
        .find({"user_id": candidate_id, "status": "completed"})
        .sort("completed_at", -1)
        .limit(20)
    ):
        doc["id"] = str(doc.pop("_id"))
        sessions.append(to_session_result(doc))

    # --- Aggregate session stats in one pass: count + avg + max together ---
    session_stats_bucket = await db["sessions"].aggregate([
        {"$match": {"user_id": candidate_id, "status": "completed"}},
        {"$group": {
            "_id": None,
            "total": {"$sum": 1},
            "avg": {"$avg": "$overall_score"},
            "best": {"$max": "$overall_score"},
        }},
    ]).to_list(length=1)

    if session_stats_bucket:
        bucket = session_stats_bucket[0]
        total_sessions = bucket["total"]
        average_score = round(bucket["avg"], 1) if bucket["avg"] is not None else 0.0
        best_score = bucket["best"] if bucket["best"] is not None else 0
    else:
        total_sessions, average_score, best_score = 0, 0.0, 0

    # `total_study_days` sums `current_day` across this candidate's (at most
    # six — one per track) already-fetched enrollments. A `$group`/`$sum`
    # pipeline over that same bounded handful of documents would cost an
    # extra round trip for no accuracy or performance gain, so the sum is
    # taken in-memory over the small list assembled above — not a bulk-
    # collection load, just a final reduction over data already required for
    # the response.
    total_study_days = sum(enrollment.get("current_day", 0) for enrollment in enrollments)

    return {
        "user": _serialize(user),
        "enrollments": enrollments,
        "assessments": assessments,
        "sessions": sessions,
        "stats": {
            "total_sessions": total_sessions,
            "average_score": average_score,
            "best_score": best_score,
            "total_study_days": total_study_days,
        },
    }


# ---------------------------------------------------------------------------
# Question bank — GET (list), POST/PUT/DELETE (superadmin only)
# ---------------------------------------------------------------------------


@router.get("/questions")
async def list_questions(
    phase: str | None = Query(None),
    track_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=100),
    _current_user: dict = Depends(require_role("admin", "superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Paginated question list. Unlike the candidate-facing sanitization in
    interview_service.sanitize_question, `model_answer` is included here —
    admins need to review it (spec: "admins need to see it for review")."""
    query: dict = {}
    if phase:
        query["phase"] = phase
    if track_id:
        query["track_id"] = track_id

    total = await db["questions"].count_documents(query)
    pages = max(math.ceil(total / limit), 1)

    cursor = (
        db["questions"]
        .find(query)
        .sort("_id", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    questions = [_serialize(doc) async for doc in cursor]

    return {"questions": questions, "total": total, "page": page, "pages": pages}


@router.post("/questions", status_code=status.HTTP_201_CREATED)
async def create_question(
    payload: QuestionCreate,
    _current_user: dict = Depends(require_role("superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    _validate_question_fields(payload.phase, payload.answer_type)

    now = datetime.now(timezone.utc)
    document = {**payload.model_dump(), "created_at": now, "updated_at": now}
    result = await db["questions"].insert_one(dict(document))
    document["id"] = str(result.inserted_id)
    return document


@router.put("/questions/{question_id}")
async def update_question(
    question_id: str,
    payload: QuestionUpdate,
    _current_user: dict = Depends(require_role("superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    object_id = _object_id_or_404(question_id, "Question not found.")
    existing = await db["questions"].find_one({"_id": object_id})
    if existing is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found.")

    updates = payload.model_dump(exclude_none=True)

    # Validate the *resulting* phase/answer_type combination — each field is
    # independently optional on PUT, so a partial update must be checked
    # against whichever value (new or pre-existing) will end up persisted.
    resulting_phase = updates.get("phase", existing.get("phase"))
    resulting_answer_type = updates.get("answer_type", existing.get("answer_type"))
    _validate_question_fields(resulting_phase, resulting_answer_type)

    if not updates:
        return _serialize(existing)

    updates["updated_at"] = datetime.now(timezone.utc)
    updated = await db["questions"].find_one_and_update(
        {"_id": object_id},
        {"$set": updates},
        return_document=ReturnDocument.AFTER,
    )
    return _serialize(updated)


@router.delete("/questions/{question_id}")
async def delete_question(
    question_id: str,
    _current_user: dict = Depends(require_role("superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    object_id = _object_id_or_404(question_id, "Question not found.")

    # Agent Rule #5: never skip the usage check — a question that has already
    # been asked (and scored) in a completed session must be preserved so that
    # candidate's results page can keep rendering its `model_answer`/feedback.
    used = await db["sessions"].find_one(
        {"status": "completed", "answers.question_id": question_id},
        {"_id": 1},
    )
    if used is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete a question that has been used in completed sessions.",
        )

    result = await db["questions"].delete_one({"_id": object_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found.")

    return {"message": "Question deleted"}


# ---------------------------------------------------------------------------
# GET /analytics — score trend, track distribution, session completion
# ---------------------------------------------------------------------------


@router.get("/analytics")
async def get_analytics(
    days: int = Query(30, ge=1, le=365),
    track_id: str | None = Query(None),
    _current_user: dict = Depends(require_role("admin", "superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    since = datetime.now(timezone.utc) - timedelta(days=days)
    track_match: dict = {"track_id": track_id} if track_id else {}

    # --- score_trend: daily average score + session count for completed
    # sessions, grouped by `completed_at` truncated to a day string. ---
    score_trend_raw = await db["sessions"].aggregate([
        {"$match": {"status": "completed", "completed_at": {"$gte": since}, **track_match}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$completed_at"}},
            "average_score": {"$avg": "$overall_score"},
            "session_count": {"$sum": 1},
        }},
        {"$sort": {"_id": 1}},
    ]).to_list(length=None)
    score_trend = [
        {
            "date": bucket["_id"],
            "average_score": round(bucket["average_score"], 1) if bucket["average_score"] is not None else 0.0,
            "session_count": bucket["session_count"],
        }
        for bucket in score_trend_raw
    ]

    # --- track_distribution: enrollment counts within the window, anchored
    # to `start_date` (an enrollment's "happened within this window" field). ---
    distribution_match: dict = {"start_date": {"$gte": since}, **track_match}
    distribution_raw = await db["enrollments"].aggregate([
        {"$match": distribution_match},
        {"$group": {"_id": "$track_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]).to_list(length=None)
    track_distribution = [
        {
            "track_id": bucket["_id"],
            "track_name": TRACKS_BY_ID[bucket["_id"]]["name"] if bucket["_id"] in TRACKS_BY_ID else bucket["_id"],
            "count": bucket["count"],
        }
        for bucket in distribution_raw
    ]

    # --- session_completion: started vs. completed counts per day. These are
    # two different date fields (`started_at` vs. `completed_at`) on the same
    # collection, so a single `$group` can't produce both — `$facet` runs both
    # grouped pipelines in one aggregation pass, and the two small per-day
    # count lists (bounded by `days`, e.g. <=90 entries each) are merged into
    # the unified `{date, started, completed}` shape the chart expects. This
    # merge is response-shaping over already-aggregated, bounded data — not
    # the bulk in-memory computation Agent Rule #4 prohibits. ---
    completion_facets = await db["sessions"].aggregate([
        {"$facet": {
            "started": [
                {"$match": {"started_at": {"$gte": since}, **track_match}},
                {"$group": {
                    "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$started_at"}},
                    "count": {"$sum": 1},
                }},
            ],
            "completed": [
                {"$match": {"status": "completed", "completed_at": {"$gte": since}, **track_match}},
                {"$group": {
                    "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$completed_at"}},
                    "count": {"$sum": 1},
                }},
            ],
        }}
    ]).to_list(length=1)

    by_date: dict[str, dict[str, int]] = {}
    if completion_facets:
        for bucket in completion_facets[0]["started"]:
            by_date.setdefault(bucket["_id"], {"started": 0, "completed": 0})["started"] = bucket["count"]
        for bucket in completion_facets[0]["completed"]:
            by_date.setdefault(bucket["_id"], {"started": 0, "completed": 0})["completed"] = bucket["count"]

    session_completion = [
        {"date": date, "started": counts["started"], "completed": counts["completed"]}
        for date, counts in sorted(by_date.items())
    ]

    return {
        "score_trend": score_trend,
        "track_distribution": track_distribution,
        "session_completion": session_completion,
    }


# ---------------------------------------------------------------------------
# GET /sessions/{session_id} — full session review (any candidate's session)
# ---------------------------------------------------------------------------


@router.get("/sessions/{session_id}")
async def get_session_for_review(
    session_id: str,
    _current_user: dict = Depends(require_role("admin", "superadmin")),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Unlike `GET /interview/session/{id}` (owner-only, Agent Rule #3
    sanitized while in progress), this admin route returns the complete
    session document — every answer, transcription, score, criteria
    breakdown, feedback string, and `model_answer` — for any user's session,
    so an admin can fully review it. Only reachable for sessions that have
    finished scoring (the `to_session_result` projection requires the
    completed-session fields `overall_score`/`phase_results`/`completed_at`)."""
    object_id = _object_id_or_404(session_id, "Interview session not found.")
    session = await db["sessions"].find_one({"_id": object_id})
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Interview session not found.")
    if session.get("status") != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This session hasn't finished scoring yet and can't be reviewed.",
        )

    session["id"] = str(session.pop("_id"))
    return to_session_result(session)
