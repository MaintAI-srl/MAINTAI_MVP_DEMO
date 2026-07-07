from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.core.modules import modules_payload, set_enabled_module_ids
from backend.core.security import require_superadmin


router = APIRouter(tags=["modules"])


class ModulesUpdate(BaseModel):
    enabled: list[str]


@router.get("/modules")
def get_modules():
    return modules_payload()


@router.put("/admin/modules")
def update_modules(payload: ModulesUpdate, _sa: dict = Depends(require_superadmin)):
    return set_enabled_module_ids(payload.enabled)
