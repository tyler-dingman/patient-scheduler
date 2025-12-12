from sqlmodel import SQLModel, create_engine, Session

DB_URL = "sqlite:///./app/app.db"
engine = create_engine(DB_URL, echo=False, connect_args={"check_same_thread": False})

def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
