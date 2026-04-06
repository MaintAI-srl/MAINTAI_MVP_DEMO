"""
WebSocket endpoint per notifiche real-time MaintAI.

Endpoint: GET /ws/ticket-updates?token=<JWT>

Il client si connette passando il JWT come query param (i browser non supportano
Authorization header nelle WebSocket). Il server verifica il token e associa
la connessione al tenant corretto.

Messaggi emessi (JSON):
  { "event": "ticket_updated", "ticket_id": 42, "stato": "In corso" }
  { "event": "plan_confirmed", "plan_id": 7 }
"""
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query, HTTPException

from backend.core.security import decode_access_token
from backend.services.ws_manager import ws_manager

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/ticket-updates")
async def ticket_updates_ws(
    websocket: WebSocket,
    token: str = Query(..., description="JWT di autenticazione"),
):
    """Connessione WebSocket per ricevere aggiornamenti real-time sui ticket."""
    # Verifica JWT
    try:
        payload = decode_access_token(token)
        tenant_id: int = payload.get("tenant_id")
        if not tenant_id:
            await websocket.close(code=4003, reason="tenant_id mancante nel token")
            return
    except Exception as exc:
        logger.warning("WS auth fallita: %s", exc)
        await websocket.close(code=4001, reason="Token non valido")
        return

    await ws_manager.connect(websocket, tenant_id)
    try:
        # Mantieni la connessione aperta; ricevi ping dal client se necessario
        while True:
            data = await websocket.receive_text()
            # Supporto ping/pong minimale
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, tenant_id)
