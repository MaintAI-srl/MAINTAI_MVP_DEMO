from fastapi import APIRouter

from backend.core.modules import modules_payload


router = APIRouter(tags=["modules"])


@router.get("/modules")
def get_modules():
    return modules_payload()
