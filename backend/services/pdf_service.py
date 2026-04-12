import io
from PyPDF2 import PdfReader


def normalize_text(text: str) -> str:
    return text.replace("\r", "\n").strip()


def smart_read_pdf(content: bytes) -> dict:
    """Estrae testo da PDF con PyPDF2. Ritorna sempre un dict con 'text', 'pages', 'method'."""
    try:
        reader = PdfReader(io.BytesIO(content))
        parts = []
        for page in reader.pages:
            page_text = page.extract_text()
            if page_text:
                parts.append(page_text)
        text = normalize_text("\n\n".join(parts))
        return {
            "method": "pdf_text",
            "pages": len(reader.pages),
            "text": text,
            "warning": "" if text.strip() else "Nessun testo estratto: il PDF potrebbe essere solo immagini.",
            "error": "",
        }
    except Exception as exc:
        return {
            "method": "error",
            "pages": 0,
            "text": "",
            "warning": "",
            "error": str(exc),
        }
