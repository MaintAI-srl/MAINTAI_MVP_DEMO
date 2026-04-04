from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.db.modelli import EmailConfig
import imap_tools

router = APIRouter(prefix="/email-config", tags=["EmailConfig"])

class EmailConfigBase(BaseModel):
    imap_server: str
    imap_port: int = 993
    email_address: str
    password: str
    active: bool = True
    default_asset_id: Optional[int] = None

class EmailConfigOut(EmailConfigBase):
    id: int
    tenant_id: Optional[int]

    class Config:
        from_attributes = True

@router.get("/", response_model=List[EmailConfigOut])
def get_configs(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    return db.query(EmailConfig).filter(EmailConfig.tenant_id == tenant_id).all()

@router.post("/", response_model=EmailConfigOut)
def create_config(data: EmailConfigBase, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    # Test connection prima di salvare
    try:
        with imap_tools.MailBox(data.imap_server, port=data.imap_port).login(data.email_address, data.password):
            pass # Login OK
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connessione IMAP fallita: {str(e)}")

    new_conf = EmailConfig(**data.model_dump(), tenant_id=tenant_id)
    db.add(new_conf)
    db.commit()
    db.refresh(new_conf)
    return new_conf

@router.delete("/{id}")
def delete_config(id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    conf = db.query(EmailConfig).filter(EmailConfig.id == id, EmailConfig.tenant_id == tenant_id).first()
    if not conf:
        raise HTTPException(status_code=404, detail="Configurazione non trovata")
    db.delete(conf)
    db.commit()
    return {"ok": True}
