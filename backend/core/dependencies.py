import jwt
from typing import Generator
from fastapi import Request
from sqlalchemy.orm import Session
from backend.core.database import SessionLocal, DemoSessionLocal
from backend.core.security import SECRET_KEY, ALGORITHM


def get_db(request: Request) -> Generator[Session, None, None]:
    """
    Fornisce una sessione database. 
    Se rileva il flag 'is_demo' nel token JWT (nell'header Authorization),
    restituisce una sessione verso il database demo.
    """
    is_demo = False
    auth_header = request.headers.get("Authorization")
    
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ")[1]
        try:
            # Decodifica leggera del token per evitare dipendenze circolari con security.py
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            if payload.get("is_demo"):
                is_demo = True
        except Exception:
            pass
            
    db = DemoSessionLocal() if is_demo else SessionLocal()
    try:
        yield db
    finally:
        db.close()
