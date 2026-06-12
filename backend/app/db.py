from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine():
    settings = get_settings()
    engine = create_engine(
        f"sqlite:///{settings.db_path}",
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine, "connect")
    def _enable_fks(dbapi_conn, _record):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    return engine


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


# Additive column migrations for databases created by earlier versions.
# create_all() adds new TABLES but never new COLUMNS on existing ones; for this
# local-first app, PRAGMA-checked ADD COLUMN covers schema evolution without
# pulling in Alembic (revisit when the cloud phase needs real migrations).
_COLUMN_MIGRATIONS: dict[str, list[str]] = {
    "steps": [
        "annotations JSON DEFAULT '[]'",
        "redactions JSON DEFAULT '[]'",
        "crop JSON DEFAULT NULL",
        "redacted_screenshot_id TEXT DEFAULT NULL REFERENCES screenshots(id)",
        "flags JSON DEFAULT '{}'",
    ],
}


def ensure_schema(target_engine=None) -> None:
    from sqlalchemy import text

    with (target_engine or engine).begin() as conn:
        for table, columns in _COLUMN_MIGRATIONS.items():
            existing = {
                row[1] for row in conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            }
            if not existing:
                continue  # table doesn't exist yet; create_all will make it complete
            for column_ddl in columns:
                name = column_ddl.split(" ", 1)[0]
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column_ddl}"))


def init_db() -> None:
    from . import models  # noqa: F401 — register tables

    ensure_schema()
    Base.metadata.create_all(engine)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
