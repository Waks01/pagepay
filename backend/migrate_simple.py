import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path, override=True)

from app.database import AsyncSessionLocal
from app.models import StudyMaterial
from app.ai.prompts import SOW_PARSER
from app.ai.providers.kilo_gateway import call_kilo_gateway
from app.ai.free_model_selector import free_model_selector
from app.config import settings
from sqlalchemy import select, update

free_model_selector.api_key = settings.kilo_api_key
free_model_selector.base_url = settings.kilo_gateway_base_url

PIN_MODEL = settings.kilo_default_model


def extract_json_from_response(text: str) -> dict | None:
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


async def parse_chunk(chunk: str, chunk_idx: int, total_chunks: int) -> dict | None:
    prompt = SOW_PARSER.format(raw_text=chunk)
    try:
        response_text = await call_kilo_gateway(
            prompt,
            max_tokens=4000,
            pin_model=PIN_MODEL,
        )
        if not response_text:
            return None
        parsed = extract_json_from_response(response_text)
        if not parsed:
            print(f"    [WARN] Chunk {chunk_idx+1}/{total_chunks}: Could not parse JSON")
        return parsed
    except Exception as e:
        print(f"    [WARN] Chunk {chunk_idx+1}/{total_chunks} failed: {e}")
        return None


async def run_sow_parser_chunked(raw_text: str, chunk_size: int = 2500, overlap: int = 200) -> dict | None:
    text = raw_text
    chunks = []
    while text:
        chunk = text[:chunk_size]
        chunks.append(chunk)
        text = text[chunk_size - overlap:]
    print(f"    [INFO] Split into {len(chunks)} chunks, pin_model={PIN_MODEL}")

    all_content_blocks = []
    title = None
    topics = None

    for i, chunk in enumerate(chunks):
        parsed = await parse_chunk(chunk, i, len(chunks))
        if not parsed:
            continue
        if title is None and parsed.get("title"):
            title = parsed["title"]
        if topics is None and parsed.get("topics"):
            topics = parsed["topics"]
        if parsed.get("content_blocks"):
            all_content_blocks.extend(parsed["content_blocks"])

        if i < len(chunks) - 1:
            await asyncio.sleep(0.5)

    if not all_content_blocks and not title and not topics:
        return None
    return {
        "title": title or "Untitled Material",
        "topics": topics or [],
        "content_blocks": all_content_blocks,
    }


async def migrate():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(StudyMaterial).order_by(StudyMaterial.id.asc()))
        materials = result.scalars().all()
        print(f"Total materials: {len(materials)}")
        for material in materials:
            if material.parsed_structure:
                try:
                    existing = json.loads(material.parsed_structure)
                    if existing.get("content_blocks"):
                        print(f"SKIP {material.id} (already has content_blocks)")
                        continue
                except (json.JSONDecodeError, AttributeError):
                    pass
            if not material.raw_input or not material.raw_input.strip():
                print(f"SKIP {material.id} (no raw_input)")
                continue
            print(f"MIGRATE {material.id}: {material.title[:60]}...")
            parsed = await run_sow_parser_chunked(material.raw_input)
            if parsed is None:
                print(f"  FAILED")
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
            await db.execute(
                update(StudyMaterial)
                .where(StudyMaterial.id == material.id)
                .values(parsed_structure=json.dumps(new_parsed))
            )
            await db.commit()
            print(f"  OK - {len(parsed.get('content_blocks', []))} blocks")
        print("DONE")


if __name__ == "__main__":
    asyncio.run(migrate())
