import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_db
from app.models.recommendation import FeedbackStatus, Recommendation
from app.schemas.recommendation import FeedbackUpdate, RecommendationOut

router = APIRouter(tags=["recommendations"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.patch("/recommendations/{rec_id}/feedback", response_model=RecommendationOut)
async def update_feedback(
    rec_id: uuid.UUID,
    body: FeedbackUpdate,
    db: DbSession,
) -> RecommendationOut:
    rec = await db.get(Recommendation, rec_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="recommendation not found")
    rec.feedback = body.feedback
    rec.feedback_at = datetime.now(UTC) if body.feedback != FeedbackStatus.none else None
    await db.commit()
    await db.refresh(rec)
    return RecommendationOut.model_validate(rec)
