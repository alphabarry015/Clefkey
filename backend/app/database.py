from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .base import Base
from .config import DATABASE_URL

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    # Enregistre les tables (User, VaultEntry) sans importer les modules modèles ici.
    from . import models as _models  # noqa: F401

    Base.metadata.create_all(bind=engine)
