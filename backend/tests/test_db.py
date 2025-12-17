from pathlib import Path

from sqlmodel import Session, select

from app.db import create_db_and_tables, verify_connection, engine
from app.models import Provider


def test_database_connectivity_and_seed_data():
    # Ensure the database file can be reached and queried
    verify_connection()
    create_db_and_tables()

    assert Path(engine.url.database or "").exists()

    with Session(engine) as session:
        providers = session.exec(select(Provider)).all()
        assert providers, "Expected seeded providers to be present in the database"
