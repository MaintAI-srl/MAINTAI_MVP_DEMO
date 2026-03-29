from sqlalchemy.orm import Session
from backend.repositories.ticket_repository import ticket_repository
from backend.schemas.ticket import TicketCreate


def get_all_tickets(db: Session):
    return ticket_repository.get_all(db)


def get_ticket(db: Session, ticket_id: int):
    return ticket_repository.get_by_id(db, ticket_id)


def add_ticket(db: Session, data: TicketCreate):
    return ticket_repository.create(db, data)
