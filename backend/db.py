import psycopg2
import os
from dotenv import load_dotenv
load_dotenv()

def get_connection():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=os.getenv("DB_PORT"),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
    )

conn = get_connection()
cursor = conn.cursor()

def reset_connection():
    global conn, cursor
    try:
        conn.rollback()
    except Exception:
        try:
            conn = get_connection()
            cursor = conn.cursor()
        except Exception:
            pass
