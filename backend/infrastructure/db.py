import os
from contextlib import contextmanager

from dotenv import load_dotenv
from psycopg2.pool import SimpleConnectionPool

load_dotenv()

MIN_CONNECTIONS = 1
MAX_CONNECTIONS = 100


def _create_pool():
    return SimpleConnectionPool(
        minconn=MIN_CONNECTIONS,
        maxconn=MAX_CONNECTIONS,
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )


connection_pool = _create_pool()


@contextmanager
def get_db_cursor(commit: bool = False):
    conn = None
    cursor = None
    try:
        conn = connection_pool.getconn()
        cursor = conn.cursor()
        yield cursor
        if commit:
            conn.commit()
    except Exception:
        if conn is not None:
            conn.rollback()
        raise
    finally:
        if cursor is not None:
            cursor.close()
        if conn is not None:
            connection_pool.putconn(conn)
