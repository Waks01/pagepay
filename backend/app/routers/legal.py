from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, HTTPException
from app.schemas import LegalPageResponse

router = APIRouter(prefix="/legal", tags=["legal"])

# Load legal content from markdown files
LEGAL_CONTENT_DIR = Path(__file__).parent.parent.parent / "legal_content"

def load_legal_content(filename: str) -> str:
    """Load legal content from markdown file."""
    file_path = LEGAL_CONTENT_DIR / filename
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        raise HTTPException(
            status_code=500,
            detail=f"Legal document not found: {filename}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error loading legal document: {str(e)}"
        )


@router.get("/terms", response_model=LegalPageResponse)
async def get_terms():
    """Get Terms of Service."""
    content = load_legal_content("terms_of_service.md")
    return LegalPageResponse(
        slug="terms",
        title="Terms of Service",
        content=content,
        updated_at=datetime(2026, 7, 6, tzinfo=timezone.utc),
    )


@router.get("/privacy", response_model=LegalPageResponse)
async def get_privacy():
    """Get Privacy Policy."""
    content = load_legal_content("privacy_policy.md")
    return LegalPageResponse(
        slug="privacy",
        title="Privacy Policy",
        content=content,
        updated_at=datetime(2026, 7, 6, tzinfo=timezone.utc),
    )

