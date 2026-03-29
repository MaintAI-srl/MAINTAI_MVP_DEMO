import os
import sys

# Aggiunge la root del progetto al path
sys.path.append(os.getcwd())

from backend.core.database import engine, Base
from backend.db.modelli import *

def reset_db():
    print("Wiping and recreating database...")
    # Attenzione: Questo cancella TUTTI i dati. Ideale per una demo pulita.
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    print("Database ricreato con successo!")

if __name__ == "__main__":
    reset_db()
