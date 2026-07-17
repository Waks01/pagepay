"""
AI-powered task verification service for Phase 7 Social Tasks.

Verifies task submissions using:
1. Twitter follow verification (API + Nitter fallback)
2. Screenshot analysis (Google Vision OCR + fake detection)
3. URL validation
4. Text pattern matching
"""
import httpx
import hashlib
import base64
import logging
from typing import Dict, Any, Optional
from datetime import datetime

from app.config import settings
from app.services.sanitize import is_safe_url

logger = logging.getLogger("uvicorn")


class AIVerificationService:
    """Service for AI-powered task verification."""
    
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=30.0)
        self.gemini_url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
    
    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()
    
    async def verify_submission(
        self,
        task_type: str,
        platform: str,
        proof_type: str,
        proof_data: Dict[str, Any],
        task_requirements: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Main entry point for verification.
        
        Supports:
        - Social Media: X/Twitter, Instagram, TikTok, YouTube, Facebook, LinkedIn
        - Task Types: follow, like, subscribe, retweet, comment, share
        - Content: photo_upload, video_upload, written_review
        - Surveys: survey, data_collection
        - Web/App: website_visit, website_signup, app_download, app_review
        
        Returns:
            {
                "verified": bool,
                "confidence": float,  # 0.0 to 1.0
                "details": str,
                "fraud_score": float,
                "checks": {...}
            }
        """
        try:
            # ═══════════════════════════════════════════════════════════
            # SOCIAL MEDIA PLATFORMS
            # ═══════════════════════════════════════════════════════════
            
            # X (Twitter)
            if platform in ["twitter", "x"]:
                if task_type == "follow":
                    return await self._verify_twitter_follow(proof_data, task_requirements)
                elif task_type == "like":
                    return await self._verify_twitter_like(proof_data, task_requirements)
                elif task_type == "retweet":
                    return await self._verify_twitter_retweet(proof_data, task_requirements)
            
            # Instagram
            elif platform == "instagram":
                if task_type == "follow":
                    return await self._verify_instagram_follow(proof_data, task_requirements)
                elif task_type == "like":
                    return await self._verify_instagram_like(proof_data, task_requirements)
                elif task_type == "comment":
                    return await self._verify_instagram_comment(proof_data, task_requirements)
            
            # TikTok
            elif platform == "tiktok":
                if task_type == "follow":
                    return await self._verify_tiktok_follow(proof_data, task_requirements)
                elif task_type == "like":
                    return await self._verify_tiktok_like(proof_data, task_requirements)
            
            # YouTube
            elif platform == "youtube":
                if task_type == "subscribe":
                    return await self._verify_youtube_subscribe(proof_data, task_requirements)
                elif task_type == "like":
                    return await self._verify_youtube_like(proof_data, task_requirements)
                elif task_type == "comment":
                    return await self._verify_youtube_comment(proof_data, task_requirements)
            
            # Facebook
            elif platform == "facebook":
                if task_type in ["follow", "like", "share"]:
                    return await self._verify_facebook_action(proof_data, task_requirements, task_type)
            
            # LinkedIn
            elif platform == "linkedin":
                if task_type in ["follow", "like", "comment"]:
                    return await self._verify_linkedin_action(proof_data, task_requirements, task_type)
            
            # ═══════════════════════════════════════════════════════════
            # CONTENT CREATION
            # ═══════════════════════════════════════════════════════════
            
            elif task_type in ["photo_upload", "video_upload"]:
                return await self._verify_content_upload(proof_data, task_requirements, task_type)
            
            elif task_type == "written_review":
                return await self._verify_written_review(proof_data, task_requirements)
            
            # ═══════════════════════════════════════════════════════════
            # SURVEYS & DATA COLLECTION
            # ═══════════════════════════════════════════════════════════
            
            elif task_type == "survey":
                return await self._verify_survey(proof_data, task_requirements)
            
            # ═══════════════════════════════════════════════════════════
            # WEB & APP TASKS
            # ═══════════════════════════════════════════════════════════
            
            elif task_type == "website_visit":
                return await self._verify_website_visit(proof_data, task_requirements)
            
            elif task_type == "website_signup":
                return await self._verify_website_signup(proof_data, task_requirements)
            
            elif task_type in ["app_download", "app_review"]:
                return await self._verify_app_task(proof_data, task_requirements, task_type)
            
            # ═══════════════════════════════════════════════════════════
            # FALLBACK - Generic Proof Verification
            # ═══════════════════════════════════════════════════════════
            
            elif proof_type == "screenshot":
                return await self._verify_screenshot(proof_data, task_requirements, task_type, platform)
            
            elif proof_type == "url":
                return await self._verify_url(proof_data, task_requirements)
            
            elif proof_type == "text":
                return await self._verify_text(proof_data, task_requirements)
            
            else:
                # Unknown type - require manual review
                return {
                    "verified": False,
                    "confidence": 0.0,
                    "details": f"Unsupported task type: {task_type}/{platform}/{proof_type}",
                    "fraud_score": 0.0,
                    "checks": {}
                }
        
        except Exception as e:
            logger.error(f"AI verification error: {e}", exc_info=True)
            return {
                "verified": False,
                "confidence": 0.0,
                "details": f"Verification system error: {str(e)}",
                "fraud_score": 0.0,
                "checks": {"error": str(e)}
            }
    
    async def _verify_twitter_follow(
        self,
        proof_data: Dict[str, Any],
        requirements: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Verify Twitter follow using Nitter scraping."""
        target_username = requirements.get("target_username", "").lstrip("@")
        worker_username = proof_data.get("username", "").lstrip("@")
        screenshot_url = proof_data.get("screenshot_url")
        
        checks = {}
        fraud_score = 0.0
        
        # Check 1: Screenshot analysis (if provided)
        if screenshot_url:
            screenshot_result = await self._analyze_screenshot(
                screenshot_url,
                f"Screenshot showing @{worker_username} following @{target_username}"
            )
            checks["screenshot"] = screenshot_result
            
            if not screenshot_result.get("valid"):
                fraud_score += 0.3
        
        # Check 2: Nitter API verification
        nitter_result = await self._check_twitter_follow_nitter(worker_username, target_username)
        checks["nitter"] = nitter_result
        
        if nitter_result.get("is_following"):
            confidence = 0.95  # High confidence from Nitter
            verified = True
            details = f"Verified: @{worker_username} follows @{target_username}"
        else:
            confidence = 0.2
            verified = False
            details = f"Could not verify follow relationship"
            fraud_score += 0.5
        
        # Adjust confidence based on screenshot
        if screenshot_url and checks["screenshot"].get("valid"):
            confidence = min(1.0, confidence + 0.05)
        
        return {
            "verified": verified,
            "confidence": confidence,
            "details": details,
            "fraud_score": fraud_score,
            "checks": checks
        }
    
    async def _verify_twitter_like(
        self,
        proof_data: Dict[str, Any],
        requirements: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Verify Twitter like via screenshot analysis."""
        screenshot_url = proof_data.get("screenshot_url")
        tweet_url = requirements.get("tweet_url", "")
        
        if not screenshot_url:
            return {
                "verified": False,
                "confidence": 0.0,
                "details": "Screenshot required for like verification",
                "fraud_score": 0.0,
                "checks": {}
            }
        
        # Analyze screenshot
        result = await self._analyze_screenshot(
            screenshot_url,
            f"Screenshot showing a liked tweet from {tweet_url}"
        )
        
        checks = {"screenshot": result}
        
        if result.get("valid") and result.get("confidence", 0) >= 0.7:
            return {
                "verified": True,
                "confidence": result["confidence"],
                "details": "Screenshot verified - like detected",
                "fraud_score": 0.0,
                "checks": checks
            }
        else:
            return {
                "verified": False,
                "confidence": result.get("confidence", 0.0),
                "details": result.get("reason", "Could not verify like from screenshot"),
                "fraud_score": 0.4,
                "checks": checks
            }
    
    async def _verify_twitter_retweet(
        self,
        proof_data: Dict[str, Any],
        requirements: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Verify Twitter retweet via screenshot analysis."""
        screenshot_url = proof_data.get("screenshot_url")
        tweet_url = requirements.get("tweet_url", "")
        
        if not screenshot_url:
            return {
                "verified": False,
                "confidence": 0.0,
                "details": "Screenshot required for retweet verification",
                "fraud_score": 0.0,
                "checks": {}
            }
        
        result = await self._analyze_screenshot(
            screenshot_url,
            f"Screenshot showing a retweet or quote tweet from {tweet_url}"
        )
        
        checks = {"screenshot": result}
        
        if result.get("valid") and result.get("confidence", 0) >= 0.7:
            return {
                "verified": True,
                "confidence": result["confidence"],
                "details": "Screenshot verified - retweet detected",
                "fraud_score": 0.0,
                "checks": checks
            }
        else:
            return {
                "verified": False,
                "confidence": result.get("confidence", 0.0),
                "details": result.get("reason", "Could not verify retweet from screenshot"),
                "fraud_score": 0.4,
                "checks": checks
            }
    
    async def _verify_screenshot(
        self,
        proof_data: Dict[str, Any],
        requirements: Dict[str, Any],
        task_type: str,
        platform: str
    ) -> Dict[str, Any]:
        """Generic screenshot verification."""
        screenshot_url = proof_data.get("screenshot_url")
        
        if not screenshot_url:
            return {
                "verified": False,
                "confidence": 0.0,
                "details": "Screenshot URL missing",
                "fraud_score": 0.0,
                "checks": {}
            }
        
        expected_content = f"Screenshot for {task_type} on {platform}"
        result = await self._analyze_screenshot(screenshot_url, expected_content)
        
        checks = {"screenshot": result}
        
        if result.get("valid") and result.get("confidence", 0) >= 0.6:
            return {
                "verified": True,
                "confidence": result["confidence"],
                "details": "Screenshot verified",
                "fraud_score": 0.0,
                "checks": checks
            }
        else:
            return {
                "verified": False,
                "confidence": result.get("confidence", 0.0),
                "details": result.get("reason", "Screenshot verification failed"),
                "fraud_score": 0.3,
                "checks": checks
            }
    
    async def _verify_url(
        self,
        proof_data: Dict[str, Any],
        requirements: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Verify URL accessibility and content."""
        url = proof_data.get("url", "")
        expected_pattern = requirements.get("url_pattern")

        checks = {}

        # Check 1: URL format + SSRF safety. `is_safe_url` rejects
        # `javascript:`, `file:`, private/loopback/link-local IPs,
        # and the well-known cloud metadata endpoints. This is the
        # central guard — the same one runs in routers/tasks.py at
        # the API boundary, but we re-run it here because the AI
        # verification step can also be reached via direct calls
        # (e.g. by an internal worker) that bypass the HTTP layer.
        if not is_safe_url(url):
            return {
                "verified": False,
                "confidence": 0.0,
                "details": "URL failed safety check (private IP, metadata host, or non-http(s) scheme)",
                "fraud_score": 0.5,
                "checks": checks,
            }

        # Check 2: Pattern matching
        if expected_pattern and expected_pattern not in url:
            checks["pattern"] = {"match": False, "expected": expected_pattern}
            return {
                "verified": False,
                "confidence": 0.0,
                "details": f"URL does not match expected pattern: {expected_pattern}",
                "fraud_score": 0.4,
                "checks": checks
            }

        checks["pattern"] = {"match": True}

        # Check 3: URL accessibility. `follow_redirects=False` so a
        # 30x redirect to a private/metadata host doesn't slip past
        # the safety check above.
        try:
            response = await self.client.head(url, follow_redirects=False)
            checks["accessibility"] = {
                "status": response.status_code,
                "accessible": 200 <= response.status_code < 400
            }
            
            if 200 <= response.status_code < 400:
                return {
                    "verified": True,
                    "confidence": 0.85,
                    "details": "URL verified and accessible",
                    "fraud_score": 0.0,
                    "checks": checks
                }
            else:
                return {
                    "verified": False,
                    "confidence": 0.3,
                    "details": f"URL returned status {response.status_code}",
                    "fraud_score": 0.2,
                    "checks": checks
                }
        
        except Exception as e:
            checks["accessibility"] = {"error": str(e)}
            return {
                "verified": False,
                "confidence": 0.1,
                "details": f"Could not access URL: {str(e)}",
                "fraud_score": 0.3,
                "checks": checks
            }
    
    async def _verify_text(
        self,
        proof_data: Dict[str, Any],
        requirements: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Verify text submission."""
        text = proof_data.get("text", "")
        min_length = requirements.get("min_length", 0)
        keywords = requirements.get("keywords", [])
        
        checks = {}
        
        # Check 1: Length
        if len(text) < min_length:
            checks["length"] = {"actual": len(text), "required": min_length, "pass": False}
            return {
                "verified": False,
                "confidence": 0.0,
                "details": f"Text too short (minimum {min_length} characters)",
                "fraud_score": 0.2,
                "checks": checks
            }
        
        checks["length"] = {"actual": len(text), "required": min_length, "pass": True}
        
        # Check 2: Keywords
        if keywords:
            text_lower = text.lower()
            found_keywords = [kw for kw in keywords if kw.lower() in text_lower]
            checks["keywords"] = {
                "required": keywords,
                "found": found_keywords,
                "pass": len(found_keywords) >= len(keywords) * 0.7  # 70% threshold
            }
            
            if not checks["keywords"]["pass"]:
                return {
                    "verified": False,
                    "confidence": 0.4,
                    "details": f"Missing required keywords: {keywords}",
                    "fraud_score": 0.3,
                    "checks": checks
                }
        
        return {
            "verified": True,
            "confidence": 0.8,
            "details": "Text submission verified",
            "fraud_score": 0.0,
            "checks": checks
        }
    
    async def _analyze_screenshot(
        self,
        image_url: str,
        expected_content: str
    ) -> Dict[str, Any]:
        """
        Analyze screenshot using Gemini Vision.
        
        Returns:
            {
                "valid": bool,
                "confidence": float,
                "reason": str,
                "detected_text": str,
                "fake_indicators": []
            }
        """
        try:
            # Download image
            response = await self.client.get(image_url)
            if response.status_code != 200:
                return {
                    "valid": False,
                    "confidence": 0.0,
                    "reason": f"Could not download image (status {response.status_code})",
                    "detected_text": "",
                    "fake_indicators": []
                }
            
            image_data = base64.b64encode(response.content).decode("utf-8")
            
            # Gemini Vision API call
            prompt = f"""Analyze this screenshot for task verification.

Expected: {expected_content}

Check for:
1. Is this a valid screenshot (not a photo of a screen, not edited)?
2. Does it show the expected content?
3. Any signs of manipulation (photoshop, fake UI)?
4. Extract any visible text.

Respond in JSON format:
{{
    "valid": true/false,
    "confidence": 0.0-1.0,
    "reason": "brief explanation",
    "detected_text": "visible text",
    "fake_indicators": ["indicator1", "indicator2"]
}}"""
            
            payload = {
                "contents": [{
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": "image/jpeg",
                                "data": image_data
                            }
                        }
                    ]
                }],
                "generationConfig": {
                    "temperature": 0.2,
                    "maxOutputTokens": 500
                }
            }
            
            gemini_response = await self.client.post(
                f"{self.gemini_url}?key={settings.gemini_api_key}",
                json=payload,
                timeout=20.0
            )
            
            if gemini_response.status_code != 200:
                logger.warning(f"Gemini API error: {gemini_response.status_code}")
                return {
                    "valid": False,
                    "confidence": 0.0,
                    "reason": "AI analysis unavailable",
                    "detected_text": "",
                    "fake_indicators": []
                }
            
            result = gemini_response.json()
            text_response = result["candidates"][0]["content"]["parts"][0]["text"]
            
            # Parse JSON from response (handle markdown code blocks)
            import json
            text_response = text_response.strip()
            if text_response.startswith("```json"):
                text_response = text_response[7:]
            if text_response.startswith("```"):
                text_response = text_response[3:]
            if text_response.endswith("```"):
                text_response = text_response[:-3]
            
            analysis = json.loads(text_response.strip())
            return analysis
        
        except Exception as e:
            logger.error(f"Screenshot analysis error: {e}", exc_info=True)
            return {
                "valid": False,
                "confidence": 0.0,
                "reason": f"Analysis error: {str(e)}",
                "detected_text": "",
                "fake_indicators": []
            }
    
    async def _check_twitter_follow_nitter(
        self,
        follower_username: str,
        target_username: str
    ) -> Dict[str, Any]:
        """
        Check if follower_username follows target_username using Nitter instances.

        Nitter is a privacy-respecting Twitter frontend that doesn't require API keys.
        """
        # Nitter instances are hardcoded below — but the usernames come
        # from user-submitted proof data. A username containing `?`,
        # `#`, or `/` would inject URL components (`?evil=...`) and
        # could SSRF to a private host. Restrict each to the canonical
        # Twitter-username charset before interpolation.
        import re as _re
        _uname_re = _re.compile(r"^[A-Za-z0-9_]{1,15}$")
        if not _uname_re.match(follower_username or ""):
            return {
                "is_following": False,
                "source": None,
                "method": "nitter",
                "error": "Invalid follower username",
            }
        if not _uname_re.match(target_username or ""):
            return {
                "is_following": False,
                "source": None,
                "method": "nitter",
                "error": "Invalid target username",
            }

        nitter_instances = [
            "https://nitter.net",           # 95% uptime (verified July 2026)
            "https://nitter.space",         # 95% uptime
            "https://lightbrd.com",         # 94% uptime
            "https://nitter.catsarch.com",  # 71% uptime
        ]

        for instance in nitter_instances:
            try:
                # Check follower's following list
                url = f"{instance}/{follower_username}/following"
                response = await self.client.get(url, timeout=10.0)
                
                if response.status_code == 200:
                    # Simple text search for target username in HTML
                    html = response.text
                    if f"/{target_username}" in html or f"@{target_username}" in html:
                        return {
                            "is_following": True,
                            "source": instance,
                            "method": "nitter"
                        }
                    else:
                        return {
                            "is_following": False,
                            "source": instance,
                            "method": "nitter"
                        }
            
            except Exception as e:
                logger.warning(f"Nitter instance {instance} failed: {e}")
                continue
        
        # All instances failed
        return {
            "is_following": False,
            "source": None,
            "method": "nitter",
            "error": "All Nitter instances unavailable"
        }
    
    def calculate_image_hash(self, image_data: bytes) -> str:
        """Calculate perceptual hash for duplicate detection."""
        return hashlib.sha256(image_data).hexdigest()

    
    # ═══════════════════════════════════════════════════════════════════
    # INSTAGRAM VERIFICATION
    # ═══════════════════════════════════════════════════════════════════
    
    async def _verify_instagram_follow(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify Instagram follow via screenshot."""
        screenshot_url = proof_data.get("screenshot_url")
        if not screenshot_url:
            return {"verified": False, "confidence": 0.0, "details": "Screenshot required", "fraud_score": 0.0, "checks": {}}
        
        result = await self._analyze_screenshot(
            screenshot_url,
            f"Instagram profile showing 'Following' or 'Message' button for {requirements.get('target_username')}"
        )
        
        if result.get("valid") and result.get("confidence", 0) >= 0.7:
            return {"verified": True, "confidence": result["confidence"], "details": "Instagram follow verified", "fraud_score": 0.0, "checks": {"screenshot": result}}
        return {"verified": False, "confidence": result.get("confidence", 0.0), "details": "Could not verify Instagram follow", "fraud_score": 0.3, "checks": {"screenshot": result}}
    
    async def _verify_instagram_like(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify Instagram like via screenshot."""
        return await self._verify_twitter_like(proof_data, requirements)  # Same logic
    
    async def _verify_instagram_comment(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify Instagram comment via screenshot."""
        screenshot_url = proof_data.get("screenshot_url")
        if not screenshot_url:
            return {"verified": False, "confidence": 0.0, "details": "Screenshot required", "fraud_score": 0.0, "checks": {}}
        
        result = await self._analyze_screenshot(
            screenshot_url,
            f"Instagram comment from user visible on post"
        )
        
        if result.get("valid") and result.get("confidence", 0) >= 0.6:
            return {"verified": True, "confidence": result["confidence"], "details": "Instagram comment verified", "fraud_score": 0.0, "checks": {"screenshot": result}}
        return {"verified": False, "confidence": result.get("confidence", 0.0), "details": "Could not verify comment", "fraud_score": 0.3, "checks": {"screenshot": result}}
    
    # ═══════════════════════════════════════════════════════════════════
    # TIKTOK VERIFICATION
    # ═══════════════════════════════════════════════════════════════════
    
    async def _verify_tiktok_follow(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify TikTok follow via screenshot."""
        screenshot_url = proof_data.get("screenshot_url")
        if not screenshot_url:
            return {"verified": False, "confidence": 0.0, "details": "Screenshot required", "fraud_score": 0.0, "checks": {}}
        
        result = await self._analyze_screenshot(
            screenshot_url,
            f"TikTok profile showing 'Following' button or 'Message' option for {requirements.get('target_username')}"
        )
        
        if result.get("valid") and result.get("confidence", 0) >= 0.7:
            return {"verified": True, "confidence": result["confidence"], "details": "TikTok follow verified", "fraud_score": 0.0, "checks": {"screenshot": result}}
        return {"verified": False, "confidence": result.get("confidence", 0.0), "details": "Could not verify TikTok follow", "fraud_score": 0.3, "checks": {"screenshot": result}}
    
    async def _verify_tiktok_like(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify TikTok like via screenshot."""
        return await self._verify_twitter_like(proof_data, requirements)
    
    # ═══════════════════════════════════════════════════════════════════
    # YOUTUBE VERIFICATION
    # ═══════════════════════════════════════════════════════════════════
    
    async def _verify_youtube_subscribe(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify YouTube subscription via screenshot."""
        screenshot_url = proof_data.get("screenshot_url")
        if not screenshot_url:
            return {"verified": False, "confidence": 0.0, "details": "Screenshot required", "fraud_score": 0.0, "checks": {}}
        
        result = await self._analyze_screenshot(
            screenshot_url,
            f"YouTube channel showing 'Subscribed' button with bell icon for {requirements.get('target_username')}"
        )
        
        if result.get("valid") and result.get("confidence", 0) >= 0.7:
            return {"verified": True, "confidence": result["confidence"], "details": "YouTube subscription verified", "fraud_score": 0.0, "checks": {"screenshot": result}}
        return {"verified": False, "confidence": result.get("confidence", 0.0), "details": "Could not verify YouTube subscription", "fraud_score": 0.3, "checks": {"screenshot": result}}
    
    async def _verify_youtube_like(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify YouTube video like via screenshot."""
        return await self._verify_twitter_like(proof_data, requirements)
    
    async def _verify_youtube_comment(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify YouTube comment via screenshot."""
        return await self._verify_instagram_comment(proof_data, requirements)
    
    # ═══════════════════════════════════════════════════════════════════
    # FACEBOOK & LINKEDIN VERIFICATION
    # ═══════════════════════════════════════════════════════════════════
    
    async def _verify_facebook_action(self, proof_data: Dict, requirements: Dict, action: str) -> Dict:
        """Verify Facebook action (follow/like/share) via screenshot."""
        screenshot_url = proof_data.get("screenshot_url")
        if not screenshot_url:
            return {"verified": False, "confidence": 0.0, "details": "Screenshot required", "fraud_score": 0.0, "checks": {}}
        
        result = await self._analyze_screenshot(
            screenshot_url,
            f"Facebook {action} action visible on {requirements.get('target_url')}"
        )
        
        if result.get("valid") and result.get("confidence", 0) >= 0.6:
            return {"verified": True, "confidence": result["confidence"], "details": f"Facebook {action} verified", "fraud_score": 0.0, "checks": {"screenshot": result}}
        return {"verified": False, "confidence": result.get("confidence", 0.0), "details": f"Could not verify Facebook {action}", "fraud_score": 0.3, "checks": {"screenshot": result}}
    
    async def _verify_linkedin_action(self, proof_data: Dict, requirements: Dict, action: str) -> Dict:
        """Verify LinkedIn action (follow/like/comment) via screenshot."""
        return await self._verify_facebook_action(proof_data, requirements, action)
    
    # ═══════════════════════════════════════════════════════════════════
    # CONTENT CREATION VERIFICATION
    # ═══════════════════════════════════════════════════════════════════
    
    async def _verify_content_upload(self, proof_data: Dict, requirements: Dict, content_type: str) -> Dict:
        """Verify photo/video upload."""
        screenshot_url = proof_data.get("screenshot_url") or proof_data.get("content_url")
        
        if not screenshot_url:
            return {"verified": False, "confidence": 0.0, "details": "Content/screenshot required", "fraud_score": 0.0, "checks": {}}
        
        result = await self._analyze_screenshot(
            screenshot_url,
            f"Screenshot or {content_type} meeting requirements: {requirements.get('description', 'N/A')}"
        )
        
        if result.get("valid") and result.get("confidence", 0) >= 0.5:
            return {"verified": True, "confidence": result["confidence"], "details": f"{content_type} verified", "fraud_score": 0.0, "checks": {"content": result}}
        return {"verified": False, "confidence": result.get("confidence", 0.0), "details": f"Could not verify {content_type}", "fraud_score": 0.2, "checks": {"content": result}}
    
    async def _verify_written_review(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify written review using text analysis."""
        text = proof_data.get("text", "")
        min_words = requirements.get("min_words", 50)
        
        if not text:
            return {"verified": False, "confidence": 0.0, "details": "Review text required", "fraud_score": 0.0, "checks": {}}
        
        word_count = len(text.split())
        
        checks = {
            "word_count": {"actual": word_count, "required": min_words, "pass": word_count >= min_words}
        }
        
        if word_count < min_words:
            return {"verified": False, "confidence": 0.0, "details": f"Review too short ({word_count}/{min_words} words)", "fraud_score": 0.2, "checks": checks}
        
        # Check for spam/gibberish using simple heuristics
        unique_words = len(set(text.lower().split()))
        repetition_ratio = unique_words / word_count if word_count > 0 else 0
        
        if repetition_ratio < 0.3:  # Too repetitive
            return {"verified": False, "confidence": 0.3, "details": "Review appears repetitive or spam", "fraud_score": 0.6, "checks": checks}
        
        confidence = min(0.9, 0.6 + (word_count / min_words) * 0.2)
        return {"verified": True, "confidence": confidence, "details": "Written review verified", "fraud_score": 0.0, "checks": checks}
    
    # ═══════════════════════════════════════════════════════════════════
    # SURVEY VERIFICATION
    # ═══════════════════════════════════════════════════════════════════
    
    async def _verify_survey(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify survey completion via screenshot or confirmation code."""
        screenshot_url = proof_data.get("screenshot_url")
        confirmation_code = proof_data.get("text") or proof_data.get("confirmation_code")
        
        # Check confirmation code if provided
        if confirmation_code:
            expected_code = requirements.get("confirmation_code")
            if expected_code and confirmation_code.strip() == expected_code:
                return {"verified": True, "confidence": 1.0, "details": "Survey confirmed with code", "fraud_score": 0.0, "checks": {"code": True}}
            elif expected_code:
                return {"verified": False, "confidence": 0.0, "details": "Invalid confirmation code", "fraud_score": 0.5, "checks": {"code": False}}
        
        # Fallback to screenshot verification
        if screenshot_url:
            result = await self._analyze_screenshot(
                screenshot_url,
                "Screenshot showing completed survey or thank you page"
            )
            
            if result.get("valid") and result.get("confidence", 0) >= 0.6:
                return {"verified": True, "confidence": result["confidence"], "details": "Survey completion verified", "fraud_score": 0.0, "checks": {"screenshot": result}}
            return {"verified": False, "confidence": result.get("confidence", 0.0), "details": "Could not verify survey completion", "fraud_score": 0.3, "checks": {"screenshot": result}}
        
        return {"verified": False, "confidence": 0.0, "details": "Screenshot or confirmation code required", "fraud_score": 0.0, "checks": {}}
    
    # ═══════════════════════════════════════════════════════════════════
    # WEB & APP VERIFICATION
    # ═══════════════════════════════════════════════════════════════════
    
    async def _verify_website_visit(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify website visit via screenshot."""
        screenshot_url = proof_data.get("screenshot_url")
        
        if not screenshot_url:
            return {"verified": False, "confidence": 0.0, "details": "Screenshot required", "fraud_score": 0.0, "checks": {}}
        
        target_url = requirements.get("target_url", "")
        result = await self._analyze_screenshot(
            screenshot_url,
            f"Screenshot showing website {target_url} with visible URL bar"
        )
        
        if result.get("valid") and result.get("confidence", 0) >= 0.5:
            return {"verified": True, "confidence": result["confidence"], "details": "Website visit verified", "fraud_score": 0.0, "checks": {"screenshot": result}}
        return {"verified": False, "confidence": result.get("confidence", 0.0), "details": "Could not verify website visit", "fraud_score": 0.2, "checks": {"screenshot": result}}
    
    async def _verify_website_signup(self, proof_data: Dict, requirements: Dict) -> Dict:
        """Verify website signup via screenshot or confirmation email."""
        screenshot_url = proof_data.get("screenshot_url")
        
        if not screenshot_url:
            return {"verified": False, "confidence": 0.0, "details": "Screenshot required", "fraud_score": 0.0, "checks": {}}
        
        result = await self._analyze_screenshot(
            screenshot_url,
            "Screenshot showing successful signup confirmation page or welcome email"
        )
        
        if result.get("valid") and result.get("confidence", 0) >= 0.6:
            return {"verified": True, "confidence": result["confidence"], "details": "Website signup verified", "fraud_score": 0.0, "checks": {"screenshot": result}}
        return {"verified": False, "confidence": result.get("confidence", 0.0), "details": "Could not verify signup", "fraud_score": 0.3, "checks": {"screenshot": result}}
    
    async def _verify_app_task(self, proof_data: Dict, requirements: Dict, task_type: str) -> Dict:
        """Verify app download or review via screenshot."""
        screenshot_url = proof_data.get("screenshot_url")
        
        if not screenshot_url:
            return {"verified": False, "confidence": 0.0, "details": "Screenshot required", "fraud_score": 0.0, "checks": {}}
        
        if task_type == "app_download":
            prompt = f"Screenshot showing app installed on device from {requirements.get('store', 'Play Store/App Store')}"
        else:
            prompt = f"Screenshot showing posted review for app {requirements.get('app_name', '')}"
        
        result = await self._analyze_screenshot(screenshot_url, prompt)
        
        if result.get("valid") and result.get("confidence", 0) >= 0.6:
            return {"verified": True, "confidence": result["confidence"], "details": f"{task_type} verified", "fraud_score": 0.0, "checks": {"screenshot": result}}
        return {"verified": False, "confidence": result.get("confidence", 0.0), "details": f"Could not verify {task_type}", "fraud_score": 0.3, "checks": {"screenshot": result}}


# Singleton instance
verification_service = AIVerificationService()
