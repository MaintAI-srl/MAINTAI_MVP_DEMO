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
    logger.error("ERRORE INTERNO DEL SERVER:")
    logger.error(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={"error": True, "message": "Errore interno del server"}
    )