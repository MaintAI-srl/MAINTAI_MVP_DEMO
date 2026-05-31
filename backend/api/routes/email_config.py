import ipaddress
import socket

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel, ConfigDict
from typing import List, Optional

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id, encrypt_data, decrypt_data, require_roles
from backend.db.modelli import EmailConfig

router = APIRouter(prefix="/email-config", tags=["EmailConfig"])


_PRIVATE_NETWORKS = [
    ipaddress.ip_network(n) for n in [
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "::1/128",
        "fc00::/7",
        "fe80::/10",
    ]
]


def _validate_imap_server(server: str) -> None:
    """Blocca IP privati/loopback/link-local per prevenire SSRF via configurazione IMAP."""
    try:
        addrs = socket.getaddrinfo(server, None)
    except socket.gaierror:
        raise HTTPException(
            status_code=400,
            detail=f"Server IMAP '{server}' non risolvibile.",
        )
    for _, _, _, _, sockaddr in addrs:
        ip = ipaddress.ip_address(sockaddr[0])
        if any(ip in net for net in _PRIVATE_NETWORKS):
            raise HTTPException(
                status_code=400,
                detail="Server IMAP punta a indirizzo privato/loopback non consentito.",
            )


class EmailConfigBase(BaseModel):
    imap_server: str
    imap_port: int = 993
    email_address: str
    password: str
    active: bool = True
    default_asset_id: Optional[int] = None


class EmailConfigOut(BaseModel):
    id: int
    imap_server: str
    imap_port: int
    email_address: str
    active: bool
    default_asset_id: Optional[int] = None
    tenant_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


def _test_imap(server: str, port: int, email: str, password: str, timeout: int = 15) -> None:
    """
    Testa la connessione IMAP con timeout.
    Solleva HTTPException 400 con messaggio leggibile in caso di errore.
    """
    import socket
    try:
        import imap_tools
        with imap_tools.MailBox(server, port=port, timeout=timeout).login(email, password):
            pass
    except imap_tools.MailboxLoginError:
        raise HTTPException(
            status_code=400,
            detail=(
                "Credenziali non valide. "
                "Se usi Gmail con verifica in 2 passaggi, devi generare una 'App Password' "
                "(Account Google → Sicurezza → Password per le app). "
                "Se usi Outlook/O365, usa outlook.office365.com porta 993."
            ),
        )
    except (socket.timeout, TimeoutError, OSError) as e:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Impossibile raggiungere il server IMAP ({server}:{port}). "
                "Verifica che server e porta siano corretti e che il firewall non blocchi la connessione."
            ),
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Errore IMAP: {str(e)}")


@router.get("/", response_model=List[EmailConfigOut])
def get_configs(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    return db.query(EmailConfig).filter(EmailConfig.tenant_id == tenant_id).all()


@router.post("/", response_model=EmailConfigOut)
def create_config(
    data: EmailConfigBase,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    # Blocca SSRF: verifica che il server non punti a indirizzi privati/loopback
    _validate_imap_server(data.imap_server)
    # Test connessione con password in chiaro (prima di cifrare)
    _test_imap(data.imap_server, data.imap_port, data.email_address, data.password)

    # Cifra la password prima di persistere
    encrypted_pw = encrypt_data(data.password)

    new_conf = EmailConfig(
        imap_server=data.imap_server,
        imap_port=data.imap_port,
        email_address=data.email_address,
        password=encrypted_pw,
        is_encrypted=True,
        active=data.active,
        default_asset_id=data.default_asset_id,
        tenant_id=tenant_id,
    )
    db.add(new_conf)
    db.commit()
    db.refresh(new_conf)
    return new_conf


@router.delete("/{config_id}")
def delete_config(
    config_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    conf = db.query(EmailConfig).filter(
        EmailConfig.id == config_id, EmailConfig.tenant_id == tenant_id
    ).first()
    if not conf:
        raise HTTPException(status_code=404, detail="Configurazione non trovata")
    db.delete(conf)
    db.commit()
    return {"ok": True}
