"""Cloudinary integration for task proof image uploads."""

import cloudinary
import cloudinary.uploader
from app.config import settings


def init_cloudinary():
    """Initialize Cloudinary with credentials from settings."""
    if not all([
        settings.cloudinary_cloud_name,
        settings.cloudinary_api_key,
        settings.cloudinary_api_secret
    ]):
        return False
    
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True
    )
    return True


async def upload_base64_image(base64_string: str, public_id: str | None = None) -> dict:
    """Upload base64 image to Cloudinary.
    
    Args:
        base64_string: Base64 encoded image with data URI prefix (data:image/png;base64,...)
        public_id: Optional custom public ID for the image
        
    Returns:
        dict with keys: url, secure_url, public_id, format, width, height
        
    Raises:
        Exception: If Cloudinary is not configured or upload fails
    """
    if not init_cloudinary():
        raise Exception("Cloudinary not configured. Set CLOUDINARY_* env vars.")
    
    upload_options = {
        "folder": settings.cloudinary_upload_folder,
        "resource_type": "image",
        "invalidate": True,
    }
    
    if public_id:
        upload_options["public_id"] = public_id
    
    result = cloudinary.uploader.upload(base64_string, **upload_options)
    
    return {
        "url": result.get("url"),
        "secure_url": result.get("secure_url"),
        "public_id": result.get("public_id"),
        "format": result.get("format"),
        "width": result.get("width"),
        "height": result.get("height"),
    }


async def delete_image(public_id: str) -> bool:
    """Delete image from Cloudinary by public_id.
    
    Args:
        public_id: Cloudinary public_id of the image to delete
        
    Returns:
        bool: True if deleted successfully
    """
    if not init_cloudinary():
        return False
    
    try:
        result = cloudinary.uploader.destroy(public_id)
        return result.get("result") == "ok"
    except Exception:
        return False
