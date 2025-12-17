import logging
from pathlib import Path

from sqlalchemy.exc import OperationalError
from sqlmodel import SQLModel, create_engine, Session

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "app.db"
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
DB_URL = f"sqlite:///{DB_PATH}"
engine = create_engine(
    DB_URL,
    echo=False,
    pool_pre_ping=True,
    connect_args={"check_same_thread": False, "timeout": 30},
)

logger = logging.getLogger(__name__)

def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)

def verify_connection() -> None:
    """Fail fast if the SQLite database cannot be reached."""
    try:
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")
    except OperationalError as exc:
        logger.exception("Database connectivity check failed")
        raise

def get_session():
    with Session(engine) as session:
        yield session
