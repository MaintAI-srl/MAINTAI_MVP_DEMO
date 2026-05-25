"""
QR Code service per gli asset MaintAI.
Usa la libreria segno (già installata) per generare PNG ad alta qualità.
"""
import base64
import os
from io import BytesIO

import segno

APP_BASE_URL = os.getenv("APP_BASE_URL", "https://maintai.vercel.app")


def generate_asset_qr_png(asset_id: int) -> bytes:
    """Genera un QR code PNG per un asset. Ritorna i bytes del PNG."""
    url = f"{APP_BASE_URL}/asset?id={asset_id}"
    qr = segno.make_qr(url, error="H")
    buf = BytesIO()
    qr.save(buf, kind="png", scale=10, dark="black", light="white", border=4)
    return buf.getvalue()


def generate_asset_qr_base64(asset_id: int) -> str:
    """Genera QR code PNG come stringa base64."""
    return base64.b64encode(generate_asset_qr_png(asset_id)).decode("utf-8")
