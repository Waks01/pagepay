"""Migrate existing StudyMaterial rows to the new structured content_blocks format.

Re-parses raw_input through the updated SOW_PARSER prompt so existing materials
gain structured content_blocks alongside their existing topics.

Routes ALL AI calls through Kilo Gateway with StepFun pinned as the model.
"""

import asyncio
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path, override=True)

from sqlalchemy import select, update

from app.database import AsyncSessionLocal
from app.models import StudyMaterial
from app.ai.prompts import SOW_PARSER
from app.ai.providers.kilo_gateway import call_kilo_gateway
from app.config import settings


def extract_json_from_response(text: str) -> dict | None:
    """Extract JSON from AI response, handling markdown wrapping and truncation."""
    if not text:
        return None
    cleaned = text.strip()
    if cleaned.startswith("```"):
        lines = cleaned.split("\n")
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    start = cleaned.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(cleaned)):
        char = cleaned[i]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(cleaned[start : i + 1])
                except json.JSONDecodeError:
                    break
    json_str = cleaned[start:]
    if not json_str.endswith("}"):
        json_str = json_str.rstrip()
        if json_str.endswith('"'):
            json_str += '"'
        open_braces = json_str.count("{") - json_str.count("}")
        if open_braces > 0:
            json_str += "}" * open_braces
        open_brackets = json_str.count("[") - json_str.count("]")
        if open_brackets > 0:
            json_str += "]" * open_brackets
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            pass
    return None


async def run_sow_parser(raw_text: str, max_chars: int = 8000) -> dict | None:
    """Parse material text through Kilo Gateway with StepFun pinned."""
    text_to_parse = raw_text[:max_chars]
    if len(raw_text) > max_chars:
        print(f"    [INFO] Truncated from {len(raw_text)} to {len(text_to_parse)} chars")

    prompt = SOW_PARSER.format(raw_text=text_to_parse)
    try:
        response_text = await call_kilo_gateway(
            prompt,
            max_tokens=4000,
            pin_model=settings.kilo_default_model,
        )
        if not response_text:
            print(f"    [WARN] Empty response from Kilo Gateway")
            return None
        parsed = extract_json_from_response(response_text)
        if parsed is None:
            print(f"    [WARN] Could not extract JSON from response: {response_text[:200]}...")
        return parsed
    except Exception as e:
        print(f"    [WARN] AI parse failed: {e}")
        return None


async def migrate_materials(dry_run: bool = False, limit: int | None = None, delay: float = 2.0) -> dict:
    stats = {
        "total": 0,
        "already_structured": 0,
        "skipped_no_raw": 0,
        "ai_success": 0,
        "ai_failed": 0,
        "updated": 0,
        "errors": 0,
    }

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(StudyMaterial).order_by(StudyMaterial.id.asc())
        )
        materials = result.scalars().all()
        if limit is not None:
            materials = materials[:limit]
        stats["total"] = len(materials)

        print(f"\nMigrating {stats['total']} study materials")
        print(f"Model: {settings.kilo_default_model}")
        print(f"Dry run: {dry_run}\n")

        for idx, material in enumerate(materials, 1):
            try:
                if material.parsed_structure:
                    try:
                        existing = json.loads(material.parsed_structure)
                        if existing.get("content_blocks"):
                            stats["already_structured"] += 1
                            print(f"  [{idx}/{stats['total']}] SKIP {material.id} (already structured)")
                            continue
                    except (json.JSONDecodeError, AttributeError):
                        pass

                if not material.raw_input or not material.raw_input.strip():
                    stats["skipped_no_raw"] += 1
                    print(f"  [{idx}/{stats['total']}] SKIP {material.id} (no raw_input)")
                    continue

                print(f"  [{idx}/{stats['total']}] Parsing material {material.id}: {material.title[:60]}...")

                parsed = await run_sow_parser(material.raw_input)
                if parsed is None:
                    stats["ai_failed"] += 1
                    print(f"    [WARN] AI parsing failed for material {material.id}")
                    continue

                if material.parsed_structure:
                    try:
                        existing = json.loads(material.parsed_structure)
                        existing["content_blocks"] = parsed.get("content_blocks", [])
                        if parsed.get("title") and not existing.get("title"):
                            existing["title"] = parsed["title"]
                        if parsed.get("topics") and not existing.get("topics"):
                            existing["topics"] = parsed["topics"]
                        new_parsed = existing
                    except (json.JSONDecodeError, AttributeError):
                        new_parsed = parsed
                else:
                    new_parsed = parsed

                if not dry_run:
                    await db.execute(
                        update(StudyMaterial)
                        .where(StudyMaterial.id == material.id)
                        .values(parsed_structure=json.dumps(new_parsed))
                    )
                    stats["updated"] += 1

                stats["ai_success"] += 1
                print(f"    OK - {len(parsed.get('content_blocks', []))} blocks")

                if delay > 0 and idx < stats["total"]:
                    await asyncio.sleep(delay)

            except Exception as e:
                stats["errors"] += 1
                print(f"  [ERROR] Error processing material {material.id}: {e}")
                continue

        if not dry_run:
            await db.commit()
            print(f"\nCommitted {stats['updated']} updates to database")
        else:
            print(f"\nDry run complete - no changes made")

    return stats


def print_stats(stats: dict) -> None:
    print(f"\nMigration Statistics")
    print(f"Total materials:          {stats['total']:>6}")
    print(f"Already structured:       {stats['already_structured']:>6}")
    print(f"Skipped (no raw_input):   {stats['skipped_no_raw']:>6}")
    print(f"AI parse success:         {stats['ai_success']:>6}")
    print(f"AI parse failed:          {stats['ai_failed']:>6}")
    print(f"Database updated:         {stats['updated']:>6}")
    print(f"Errors:                   {stats['errors']:>6}")


async def main():
    parser = argparse.ArgumentParser(description="Migrate study materials to structured content_blocks")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--delay", type=float, default=2.0)
    args = parser.parse_args()

    try:
        stats = await migrate_materials(
            dry_run=args.dry_run,
            limit=args.limit,
            delay=args.delay,
        )
        print_stats(stats)
        if args.dry_run:
            print("Run without --dry-run to apply changes to database")
        else:
            print("Migration complete!")
    except Exception as e:
        print(f"\nError during migration: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
