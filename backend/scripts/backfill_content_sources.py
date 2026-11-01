"""
Backfill content_source field for existing ContentCatalog rows.

Run this script after applying migration 036_add_content_source_field.py
to populate the content_source field for all existing content.

Usage:
    python scripts/backfill_content_sources.py [--dry-run]

Options:
    --dry-run   Show what would be updated without making changes
"""

import asyncio
import argparse
import sys
from pathlib import Path

# Add parent directory to path so we can import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_maker
from app.models import ContentCatalog


async def detect_content_source(row: ContentCatalog) -> str | None:
    """Detect content source from existing data.
    
    Args:
        row: ContentCatalog instance
        
    Returns:
        Detected source identifier or None if unknown
    """
    # Already has content_source set
    if row.content_source:
        return row.content_source
    
    # Check existing 'source' field (openstax, gutendex, gnews)
    if row.source:
        source_lower = row.source.lower()
        
        # OpenStax content is always ad-free
        if 'openstax' in source_lower:
            return 'openstax'
        
        # Gutendex is novels (ad-supported)
        if 'gutendex' in source_lower or 'gutenberg' in source_lower:
            return 'gutenberg'
        
        # GNews is news articles (ad-supported)
        if 'gnews' in source_lower:
            return 'gnews'
    
    # Check source_url for hints
    if row.source_url:
        url_lower = row.source_url.lower()
        
        if 'gutenberg' in url_lower:
            return 'gutenberg'
        
        if 'openstax' in url_lower:
            return 'openstax'
        
        if 'gnews' in url_lower or 'newsapi' in url_lower:
            return 'gnews'
    
    # Check content_type
    if row.content_type:
        type_lower = row.content_type.lower()
        
        # Education content is usually OpenStax
        if 'education' in type_lower or 'textbook' in type_lower:
            return 'openstax_textbook'
    
    # Check education_level - if set, likely OpenStax
    if row.education_level:
        return 'openstax'
    
    # Unknown source
    return None


async def backfill_content_sources(dry_run: bool = False) -> dict:
    """Backfill content_source for all existing ContentCatalog rows.
    
    Args:
        dry_run: If True, don't actually update database
        
    Returns:
        Dict with statistics about the backfill
    """
    stats = {
        'total_rows': 0,
        'already_set': 0,
        'gutenberg': 0,
        'openstax': 0,
        'openstax_textbook': 0,
        'gnews': 0,
        'unknown': 0,
        'updated': 0,
    }
    
    async with async_session_maker() as db:
        # Fetch all content catalog rows
        result = await db.execute(select(ContentCatalog))
        rows = result.scalars().all()
        
        stats['total_rows'] = len(rows)
        
        print(f"\n{'=' * 60}")
        print(f"Backfilling content_source for {stats['total_rows']} rows")
        print(f"Dry run: {dry_run}")
        print(f"{'=' * 60}\n")
        
        for row in rows:
            # Skip if already set
            if row.content_source:
                stats['already_set'] += 1
                continue
            
            # Detect source
            detected_source = await detect_content_source(row)
            
            if detected_source:
                # Count by source type
                if 'gutenberg' in detected_source:
                    stats['gutenberg'] += 1
                elif 'openstax_textbook' in detected_source:
                    stats['openstax_textbook'] += 1
                elif 'openstax' in detected_source:
                    stats['openstax'] += 1
                elif 'gnews' in detected_source:
                    stats['gnews'] += 1
                
                if not dry_run:
                    # Update row
                    await db.execute(
                        update(ContentCatalog)
                        .where(ContentCatalog.id == row.id)
                        .values(content_source=detected_source)
                    )
                    stats['updated'] += 1
                    
                    if stats['updated'] % 100 == 0:
                        print(f"  Updated {stats['updated']} rows...")
            else:
                stats['unknown'] += 1
                print(f"  Warning: Could not detect source for row {row.id} (title: {row.title[:50]})")
        
        if not dry_run:
            await db.commit()
            print(f"\n✅ Committed {stats['updated']} updates to database")
        else:
            print(f"\n🔍 Dry run complete - no changes made")
    
    return stats


def print_stats(stats: dict) -> None:
    """Print backfill statistics."""
    print(f"\n{'=' * 60}")
    print("Backfill Statistics")
    print(f"{'=' * 60}")
    print(f"Total rows:              {stats['total_rows']:>6}")
    print(f"Already set:             {stats['already_set']:>6}")
    print(f"Detected Gutenberg:      {stats['gutenberg']:>6}")
    print(f"Detected OpenStax:       {stats['openstax']:>6}")
    print(f"Detected OpenStax Text:  {stats['openstax_textbook']:>6}")
    print(f"Detected GNews:          {stats['gnews']:>6}")
    print(f"Unknown source:          {stats['unknown']:>6}")
    print(f"Updated:                 {stats['updated']:>6}")
    print(f"{'=' * 60}\n")


async def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description='Backfill content_source field')
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Show what would be updated without making changes'
    )
    
    args = parser.parse_args()
    
    try:
        stats = await backfill_content_sources(dry_run=args.dry_run)
        print_stats(stats)
        
        if args.dry_run:
            print("Run without --dry-run to apply changes to database")
        else:
            print("✅ Backfill complete!")
    
    except Exception as e:
        print(f"\n❌ Error during backfill: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    asyncio.run(main())
