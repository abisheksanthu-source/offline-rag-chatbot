import sqlite3
from werkzeug.security import generate_password_hash, check_password_hash

DB_NAME = "users.db"


def init_db():
    conn = sqlite3.connect(DB_NAME)

    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )
    """)

    conn.commit()
    conn.close()


def register_user(username, password):
    try:
        conn = sqlite3.connect(DB_NAME)

        hashed_password = generate_password_hash(password)

        conn.execute(
            "INSERT INTO users (username, password) VALUES (?, ?)",
            (username, hashed_password)
        )

        conn.commit()
        conn.close()

        return True

    except sqlite3.IntegrityError:
        return False


def login_user(username, password):
    conn = sqlite3.connect(DB_NAME)

    user = conn.execute(
        "SELECT password FROM users WHERE username = ?",
        (username,)
    ).fetchone()

    conn.close()

    if user:
        return check_password_hash(user[0], password)

    return False