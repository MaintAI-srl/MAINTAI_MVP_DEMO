"""
WebSocket Connection Manager per notifiche real-time.

Gestisce le connessioni attive e consente di inviare messaggi a tutti i client
connessi in un dato contesto tenant.

Architettura: in-memory, single-process. Per deployment multi-istanza
sarà necessario un broker pub/sub (es. Redis). Funziona correttamente
su Render (single dyno).
"""
import json
import logging
from typing import Dict, List

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self):
        # Mappa tenant_id → lista di websocket connessi
        self._connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, tenant_id: int) -> None:
        await websocket.accept()
        self._connections.setdefault(tenant_id, []).append(websocket)
        logger.debug("WS connect: tenant=%d, totale=%d", tenant_id, len(self._connections[tenant_id]))

    def disconnect(self, websocket: WebSocket, tenant_id: int) -> None:
        conns = self._connections.get(tenant_id, [])
        if websocket in conns:
            conns.remove(websocket)
        logger.debug("WS disconnect: tenant=%d, rimasti=%d", tenant_id, len(conns))

    async def broadcast_to_tenant(self, tenant_id: int, event: str, payload: dict) -> None:
        """Invia un messaggio JSON a tutti i client connessi del tenant."""
        conns = list(self._connections.get(tenant_id, []))
        if not conns:
            return
        message = json.dumps({"event": event, **payload})
        dead: List[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_text(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, tenant_id)


# Singleton globale condiviso da tutti i router
ws_manager = ConnectionManager()
