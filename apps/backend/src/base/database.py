from sqlalchemy.engine import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

"""
  Change this into your postgresql database config.
  SQLAlchemy_DB = "postgresql+psycopg2://{username}:{password}@localhost:5432/{dbname}"
"""
SQLAlchemy_DB = "postgresql+psycopg2://postgres:review@localhost:5432/ametrine"
engine = create_engine(SQLAlchemy_DB)
db_session_local = sessionmaker(autoflush=False, autocommit=False, bind=engine)
Base = declarative_base()


def get_db():
    """
    获取postgres instance
    """
    db = db_session_local()
    try:
        yield db
    finally:
        db.close()


async def reset_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)