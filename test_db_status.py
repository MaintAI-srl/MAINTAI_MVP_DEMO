import sys
import os
sys.path.append(os.getcwd())

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.db.modelli import Base, Tecnico, Ticket, Asset, Utente

DATABASE_URL = "sqlite:///./maintai.db"
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def check():
    db = SessionLocal()
    try:
        print(f"Utenti: {db.query(Utente).count()}")
        print(f"Tecnici: {db.query(Tecnico).count()}")
        print(f"Tickets: {db.query(Ticket).count()}")
        print(f"Assets: {db.query(Asset).count()}")
        
        # Check for any obvious null tecnico names
        t = db.query(Tecnico).first()
        if t:
            print(f"Example Tecnico: {t.nome} (id={t.id})")
        else:
            print("No tecnici found")
            
        ticket = db.query(Ticket).first()
        if ticket:
            print(f"Example Ticket: {ticket.titolo} (id={ticket.id})")
    except Exception as e:
        print(f"Error checking DB: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    check()
