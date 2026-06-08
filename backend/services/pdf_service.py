import io
import logging

from pypdf import PdfReader

logger = logging.getLogger(__name__)


def normalize_text(text: str) -> str:
    return text.replace("\r", "\n").strip()


def read_pdf_text(content: bytes):
    reader = PdfReader(io.BytesIO(content))
    parts = []
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            parts.append(page_text)
    return {
        "method": "pdf_text",
        "pages": len(reader.pages),
        "text": normalize_text("\n\n".join(parts)),
        "warning": "",
        "error": "",
    }


def read_pdf_ocr_fallback(content: bytes):
    try:
        from pdf2image import convert_from_bytes
    except Exception as exc:
        return {
            "method": "ocr_unavailable",
            "pages": 0,
            "text": "",
            "warning": "",
            "error": f"OCR non disponibile: {str(exc)}",
        }

    try:
        import pytesseract
        images = convert_from_bytes(content, dpi=200)
        parts = []
        for image in images:
            text = pytesseract.image_to_string(image, lang="eng")
            if text:
                parts.append(text)
        return {
            "method": "ocr_fallback",
            "pages": len(images),
            "text": normalize_text("\n\n".join(parts)),
            "warning": "",
            "error": "",
        }
    except Exception as exc:
        return {
            "method": "ocr_failed",
            "pages": 0,
            "text": "",
            "warning": "",
            "error": f"Errore OCR: {str(exc)}",
        }


def smart_read_pdf(content: bytes):
    try:
        result = read_pdf_text(content)
        if len(result["text"].strip()) > 300:
            return result
        fallback = read_pdf_ocr_fallback(content)
        if fallback.get("text", "").strip():
            return fallback
        result["warning"] = "Testo PDF troppo corto; OCR non disponibile o non riuscito."
        return result
    except Exception as exc:
        # SEC ERR-02: log della causa originale prima del fallback OCR.
        logger.warning("smart_read_pdf: estrazione testo fallita (%s), provo OCR", exc)
        return read_pdf_ocr_fallback(content)
