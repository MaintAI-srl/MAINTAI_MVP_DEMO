"""
Compatibility layer temporaneo per il refactor.

Permette ai vecchi import del tipo:
    from backend.schemas import AssetCreate
di continuare a funzionare finché i moduli non vengono migrati
completamente ai nuovi percorsi specifici.
"""

# Schemas legacy monolitici
from .schemas import *  # noqa: F401,F403

# Schemas nuovi per dominio
from .ticket import TicketCreate, TicketResponse  # noqa: F401
