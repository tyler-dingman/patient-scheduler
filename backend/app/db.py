from pathlib import Path

from sqlmodel import SQLModel, create_engine, Session

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "app.db"
DB_URL = f"sqlite:///{DB_PATH}"
engine = create_engine(DB_URL, echo=False, connect_args={"check_same_thread": False})

def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
