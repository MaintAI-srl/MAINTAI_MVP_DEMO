import subprocess
import sys
import os

def run(cmd):
    print(f"Executing: {cmd}")
    subprocess.run(cmd, shell=True, check=True)

def setup():
    print("--- FULL RESET AND SETUP FOR DEMO ---")
    
    # 1. Install critical dependencies
    # Usiamo PyJWT invece di jwt per evitare conflitti, e bcrypt
    run(f"{sys.executable} -m pip install PyJWT bcrypt passlib python-multipart fastapi uvicorn sqlalchemy aiosqlite python-jose[cryptography]")

    # 2. Reset Database
    if os.path.exists("recreate_db.py"):
        run(f"{sys.executable} recreate_db.py")
    
    # 3. Seed Demo Data
    if os.path.exists("seed_demo_data.py"):
        run(f"{sys.executable} seed_demo_data.py")
        
    # 4. Create Admin User (just in case)
    print("Creating admin user...")
    cmd_admin = f'{sys.executable} -c "import os; import sys; sys.path.append(os.getcwd()); from backend.core.database import SessionLocal; from backend.db.modelli import Utente; from backend.core.security import get_password_hash; db=SessionLocal(); u=Utente(username=\'admin\', password_hash=get_password_hash(\'admin\'), ruolo=\'responsabile\'); db.add(u); db.commit(); db.close()"'
    run(cmd_admin)

    print("\n--- SETUP COMPLETATO! AVVIA IL BACKEND ORA ---")

if __name__ == "__main__":
    setup()
