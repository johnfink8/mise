from fastapi import APIRouter, HTTPException, Response

from app.services.plex_client import get_plex_client

router = APIRouter(tags=["thumbs"])


@router.get("/thumbs/{rating_key}")
async def get_thumb(rating_key: str) -> Response:
    plex = get_plex_client()
    try:
        data, content_type = await plex.fetch_thumb_bytes(rating_key)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"plex error: {exc}") from exc
    return Response(
        content=data,
        media_type=content_type,
        headers={"Cache-Control": "public, max-age=86400"},
    )
