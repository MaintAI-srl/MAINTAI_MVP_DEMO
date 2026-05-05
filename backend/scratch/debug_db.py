
import sqlite3
import os

db_path = r"c:\Users\aless\Desktop\MAINTAI_MVP_DEMO\maintai.db"
if not os.path.exists(db_path):
    print(f"DB not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    cursor.execute("SELECT * FROM system_logs ORDER BY id DESC LIMIT 20")
    rows = cursor.fetchall()
    print("Last 20 system logs:")
    for row in rows:
        print(row)
except Exception as e:
    print(f"Error reading system_logs: {e}")

try:
    cursor.execute("SELECT id, username, is_active FROM utenti")
    rows = cursor.fetchall()
    print("\nUsers:")
    for row in rows:
        print(row)
except Exception as e:
    print(f"Error reading utenti: {e}")

conn.close()
