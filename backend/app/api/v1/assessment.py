from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from app.api.v1.tracks import get_track_or_none
from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.services import assessment_service

router = APIRouter()

class TrackIdBody(BaseModel):
    track_id: str
    # Optional target role chosen on the tracks screen before the assessment
    # starts, so the questions personalize to it from the very first one.
    target_role_id: str | None = None
    target_role: str | None = None


class SubmitBody(BaseModel):
    session_id: str
    track_id: str
    answers: dict[str, str]


async def _validate_track_id(track_id: str, db: AsyncIOMotorDatabase) -> None:
    if await get_track_or_none(track_id, db) is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unknown track_id.",
        )


@router.post("/generate-questions")
async def generate_questions(
    payload: TrackIdBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Start a progressive assessment session for the given track.

    The first question returns immediately. Remaining questions are available
    from deterministic seed prompts and refined in the background by local AI.
    """
    await _validate_track_id(payload.track_id, db)

    session_id, questions = await assessment_service.generate_questions(
        payload.track_id,
        current_user["id"],
        background_tasks,
        target_role_id=payload.target_role_id,
        target_role=payload.target_role,
    )

    return {"session_id": session_id, "questions": questions, "track_id": payload.track_id}


@router.get("/session/{session_id}/question/{question_number}")
async def get_session_question(
    session_id: str,
    question_number: int,
    current_user: dict = Depends(get_current_user),
):
    """Return one assessment question by number without exposing model_answer."""
    return await assessment_service.get_session_question(
        session_id,
        current_user["id"],
        question_number,
    )


@router.post("/submit")
async def submit_assessment(
    payload: SubmitBody,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Score a completed assessment session and generate the personalized plan."""
    await _validate_track_id(payload.track_id, db)

    session = await db["assessment_sessions"].find_one({"session_id": payload.session_id})
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Assessment session not found.",
        )

    if session["user_id"] != current_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This assessment session does not belong to you.",
        )

    if session.get("completed"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This assessment has already been submitted.",
        )

    question_ids = {question["id"] for question in session["questions"]}
    missing_ids = question_ids - set(payload.answers.keys())
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Missing answers for question(s): {', '.join(sorted(missing_ids))}",
        )

    scoring = await assessment_service.score_answers(payload.session_id, payload.answers)
    now = datetime.now(timezone.utc)

    # Persist the full record (answers + model_answer included) for history...
    assessment_doc = {
        "user_id": current_user["id"],
        "track_id": payload.track_id,
        "skill_level": scoring["skill_level"],
        "score": scoring["score"],
        "breakdown": scoring["breakdown"],
        "answers": scoring.get("answers", payload.answers),
        "per_question_feedback": scoring["per_question_feedback"],
        "scoring_version": scoring.get("scoring_version"),
        "created_at": now,
    }
    insert_result = await db["assessments"].insert_one(dict(assessment_doc))
    # ...and build the client-facing result with model_answer intentionally
    # included (per spec — only /submit ever returns it to the client).
    result = {**assessment_doc, "id": str(insert_result.inserted_id)}

    plan = await assessment_service.generate_plan(
        current_user["id"], payload.track_id, scoring["skill_level"]
    )

    await db["assessment_sessions"].update_one(
        {"session_id": payload.session_id},
        {"$set": {"completed": True}},
    )

    return {"result": result, "plan": plan}


@router.get("/result/{track_id}")
async def get_result(
    track_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Return the most recent saved assessment result + plan for this track, if any."""
    await _validate_track_id(track_id, db)

    result, plan = await assessment_service.get_existing_result(current_user["id"], track_id)
    return {"result": result, "plan": plan}


@router.get("/plan/{track_id}")
async def get_plan(
    track_id: str,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Return the most recent personalized plan for this track, or 404 if none exists."""
    await _validate_track_id(track_id, db)

    plan = await db["plans"].find_one(
        {"user_id": current_user["id"], "track_id": track_id},
        sort=[("created_at", -1)],
    )
    if plan is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No personalized plan found for this track yet.",
        )

    plan["id"] = str(plan.pop("_id"))
    return plan


@router.post("/retake")
async def retake_assessment(
    payload: TrackIdBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Start a brand-new assessment session without deleting prior history."""
    await _validate_track_id(payload.track_id, db)

    session_id, questions = await assessment_service.generate_questions(
        payload.track_id,
        current_user["id"],
        background_tasks,
        target_role_id=payload.target_role_id,
        target_role=payload.target_role,
    )

    return {"session_id": session_id, "questions": questions, "track_id": payload.track_id}
