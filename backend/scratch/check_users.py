
import sqlite3
import os

db_path = r"c:\Users\aless\Desktop\MAINTAI_MVP_DEMO\maintai.db"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT id, username, ruolo, is_active, tenant_id FROM utenti")
rows = cursor.fetchall()
print("Users:")
for row in rows:
    print(row)

conn.close()
