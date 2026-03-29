import os
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# Supporto per Database Cloud o Rete Aziendale Chiusa
# Se DATABASE_URL è definita nel .env usa quella, altrimenti fallback su SQLite locale.
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./maintai.db")

# Argomenti extra per la connessione (SQLite richiede check_same_thread=False)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass