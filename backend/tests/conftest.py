import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from backend.core.database import Base
from backend.core.dependencies import get_db
from backend.main import app
from backend.core.rate_limiter import limiter as _rate_limiter


@pytest.fixture(autouse=True, scope="session")
def disable_rate_limiting():
    """Disabilita il rate limiter per tutti i test."""
    _rate_limiter.enabled = False
    yield
    _rate_limiter.enabled = True

# In-memory SQLite for fast testing
TEST_DATABASE_URL = "sqlite:///:memory:"

@pytest.fixture(scope="session")
def db_engine():
    engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db_session(db_engine):
    connection = db_engine.connect()
    transaction = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()

    yield session

    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture
def client(db_session):
    from fastapi.testclient import TestClient

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    # https://testserver: necessario per inviare cookie Secure=True
    # Origin: bypassare il CSRF middleware
    with TestClient(app, base_url="https://testserver", headers={"origin": "http://localhost:3000"}) as c:
        yield c
    app.dependency_overrides.clear()
