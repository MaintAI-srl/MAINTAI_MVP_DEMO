from fastapi import Request
from fastapi.responses import JSONResponse
import traceback
from backend.core.logging_config import get_logger

logger = get_logger(__name__)


class AppError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message


async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": True, "message": exc.message}
    )


async def generic_error_handler(request: Request, exc: Exception):
    logger.error(
        "ERRORE INTERNO — %s %s — %s",
        request.method,
        str(request.url.path),
        type(exc).__name__,
    )
    # NB: format_exc() qui restituirebbe "NoneType: None" — nel contesto async
    # del handler l'eccezione non è più quella "corrente". Va formattata da exc.
    logger.error("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
    return JSONResponse(
        status_code=500,
        content={"error": True, "message": "Errore interno del server"},
    )