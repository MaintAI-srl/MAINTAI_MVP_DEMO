import sqlite3
import os

db_path = 'maintai.db'
if not os.path.exists(db_path):
    print(f"DB not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cur = conn.cursor()

# Check tables
cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [row[0] for row in cur.fetchall()]
print(f"Tables: {tables}")

# Check columns in generated_plans
if 'generated_plans' in tables:
    cur.execute("PRAGMA table_info(generated_plans);")
    cols = [row[1] for row in cur.fetchall()]
    print(f"Cols in generated_plans: {cols}")

# Check columns in ticket
if 'ticket' in tables:
    cur.execute("PRAGMA table_info(ticket);")
    cols = [row[1] for row in cur.fetchall()]
    print(f"Cols in ticket: {cols}")

conn.close()
