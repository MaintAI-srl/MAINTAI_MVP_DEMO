"""Calcolo centralizzato delle ore uomo (change request 2026-07-05).

Unica implementazione della formula `ore uomo = durata lavoro × tecnici necessari`,
usata da creazione/aggiornamento ticket. Non duplicare la logica altrove:
il frontend mostra solo l'anteprima live, il valore persistito passa da qui.
"""
from __future__ import annotations


def calculate_required_man_hours(duration_hours: float | None, technicians: int | None) -> float | None:
    """Restituisce durata × tecnici arrotondato a 2 decimali, o None se input mancanti/non validi."""
    if duration_hours is None or technicians is None:
        return None
    try:
        duration = float(duration_hours)
        techs = int(technicians)
    except (TypeError, ValueError):
        return None
    if duration <= 0 or techs <= 0:
        return None
    return round(duration * techs, 2)
