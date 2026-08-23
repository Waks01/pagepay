"""Simple migration script without async."""
import os
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

def run_migration():
    """Run the migration using psycopg2."""
    
    # Get database URL
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        print("❌ DATABASE_URL not found in .env")
        return False
    
    print("🔄 Connecting to database...")
    print(f"   Database: {database_url.split('@')[1].split('/')[0] if '@' in database_url else 'hidden'}")
    
    try:
        # Connect to database
        conn = psycopg2.connect(database_url)
        cur = conn.cursor()
        
        print("✅ Connected to database")
        
        # Check if columns already exist
        cur.execute("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'user_streaks' 
            AND column_name IN ('reward_streak', 'longest_reward_streak', 
                              'last_reward_claim_date', 'reward_streak_expires_at',
                              'longest_login_streak', 'total_logins')
        """)
        existing_columns = [row[0] for row in cur.fetchall()]
        
        if len(existing_columns) >= 6:
            print("✅ All columns already exist - migration not needed")
            conn.close()
            return True
            
        print(f"📊 Found {len(existing_columns)} existing columns: {existing_columns}")
        print("🔄 Adding missing columns...")
        
        # Add columns one by one
        columns_to_add = [
            ("longest_login_streak", "INTEGER NOT NULL DEFAULT 0"),
            ("total_logins", "INTEGER NOT NULL DEFAULT 0"), 
            ("reward_streak", "INTEGER NOT NULL DEFAULT 0"),
            ("longest_reward_streak", "INTEGER NOT NULL DEFAULT 0"),
            ("last_reward_claim_date", "VARCHAR(10)"),
            ("reward_streak_expires_at", "TIMESTAMP")
        ]
        
        for column_name, column_def in columns_to_add:
            if column_name not in existing_columns:
                try:
                    cur.execute(f"ALTER TABLE user_streaks ADD COLUMN {column_name} {column_def}")
                    print(f"   ✅ Added column: {column_name}")
                except Exception as e:
                    if "already exists" in str(e):
                        print(f"   ⚠️  Column {column_name} already exists")
                    else:
                        raise e
        
        # Migrate existing data
        print("🔄 Migrating existing data...")
        cur.execute("""
            UPDATE user_streaks 
            SET 
                longest_login_streak = COALESCE(longest_streak, 0),
                total_logins = CASE WHEN last_login_date IS NOT NULL THEN COALESCE(consecutive_login_days, 0) ELSE 0 END,
                reward_streak = 0,
                longest_reward_streak = 0,
                last_reward_claim_date = last_claim_date,
                reward_streak_expires_at = NULL
            WHERE longest_login_streak IS NULL OR longest_login_streak = 0
        """)
        
        rows_updated = cur.rowcount
        print(f"   ✅ Updated {rows_updated} user records")
        
        # Commit changes
        conn.commit()
        print("✅ Migration completed successfully!")
        
        conn.close()
        return True
        
    except Exception as e:
        print(f"❌ Migration failed: {e}")
        if 'conn' in locals():
            conn.rollback()
            conn.close()
        return False

if __name__ == "__main__":
    success = run_migration()
    if success:
        print("\n🎉 Database is ready for the new streak logic!")
    else:
        print("\n💥 Migration failed - check the error above")
        exit(1)