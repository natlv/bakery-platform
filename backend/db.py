import os
from contextlib import contextmanager
from psycopg2.pool import SimpleConnectionPool
from dotenv import load_dotenv

load_dotenv()


def _create_pool():
    min_conn = 1
    max_conn = 100
    return SimpleConnectionPool(
        minconn=min_conn,
        maxconn=max_conn,
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )


connection_pool = _create_pool()


@contextmanager
def get_db_cursor(commit: bool = False):
    """
    Yields a cursor backed by a pooled connection.
    Commits automatically when commit=True, otherwise leaves transaction untouched.
    """
    conn = None
    cursor = None
    try:
        conn = connection_pool.getconn()
        cursor = conn.cursor()
        yield cursor
        if commit:
            conn.commit()
    except Exception:
        if conn:
            conn.rollback()
        raise
    finally:
        if cursor:
            cursor.close()
        if conn:
            connection_pool.putconn(conn)
