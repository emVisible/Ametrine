from passlib.context import CryptContext
from sqlalchemy.future import select

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash(plain: str) -> str:
    return pwd_context.hash(plain)


def verify(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)
