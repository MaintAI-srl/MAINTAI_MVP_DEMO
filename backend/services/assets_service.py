from sqlalchemy.orm import Session
from backend.repositories.asset_repository import asset_repository


def get_asset(db: Session, asset_id: int) -> dict | None:
    return asset_repository.get_by_id(db, asset_id)


def get_asset_name(db: Session, asset_id: int) -> str:
    asset = get_asset(db, asset_id)
    return asset["name"] if asset else f"Asset {asset_id}"
