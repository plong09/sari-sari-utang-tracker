from flask import Flask, render_template, request, redirect, session, Response
import csv
from datetime import datetime
from functools import wraps
from io import StringIO
import os
import sqlite3
import threading
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

try:
    import psycopg2
    from psycopg2 import pool as psycopg2_pool
except ImportError:
    psycopg2 = None
    psycopg2_pool = None

from dotenv import load_dotenv


load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("SECRET_KEY", "dev-only-change-this-secret")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax"
)
if os.getenv("RENDER"):
    app.config["SESSION_COOKIE_SECURE"] = True

USER_NAME = os.getenv("USER_NAME")
PASSWORD = os.getenv("PASSWORD")
DATABASE_URL = os.getenv("DATABASE_URL")
DATABASE_PATH = os.getenv("DATABASE_PATH", "database.db")
USE_POSTGRES = bool(DATABASE_URL)
POSTGRES_POOL_MAX = int(os.getenv("POSTGRES_POOL_MAX", "3"))
DB_CONNECT_TIMEOUT = int(os.getenv("DB_CONNECT_TIMEOUT", "10"))

BALANCE_SQL = "(utang.total - COALESCE(utang.amount_paid, 0))"
PRIMARY_KEY_SQL = "SERIAL PRIMARY KEY" if USE_POSTGRES else "INTEGER PRIMARY KEY AUTOINCREMENT"
PAID_CAP_SQL = "LEAST(COALESCE(amount_paid, 0), ?)" if USE_POSTGRES else "MIN(COALESCE(amount_paid, 0), ?)"
POSTGRES_POOL = None
DB_INITIALIZED = False
DB_INIT_LOCK = threading.Lock()


# ---------------- LOGIN PROTECTION ---------------- #

def login_required(route_function):
    @wraps(route_function)
    def wrapper(*args, **kwargs):
        if not session.get("logged_in"):
            return redirect("/login")
        return route_function(*args, **kwargs)
    return wrapper


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None

    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]

        if username == USER_NAME and password == PASSWORD:
            session["logged_in"] = True
            return redirect("/")
        error = "Invalid username or password"

    return render_template("login.html", error=error)


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")


@app.route("/healthz")
def healthz():
    return "ok", 200


@app.route("/warmup")
def warmup():
    ensure_db_initialized()
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT 1")
    conn.close()
    return "warm", 200


@app.before_request
def initialize_database_before_protected_pages():
    if request.endpoint in {"healthz", "warmup", "login", "logout"}:
        return

    ensure_db_initialized()


# ---------------- DATABASE ---------------- #

def normalized_database_url(database_url):
    if not database_url:
        return database_url

    parsed = urlsplit(database_url)
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))

    if query.get("sslmode") == "req":
        query["sslmode"] = "require"

    return urlunsplit((
        parsed.scheme,
        parsed.netloc,
        parsed.path,
        urlencode(query),
        parsed.fragment
    ))


def get_postgres_pool():
    global POSTGRES_POOL

    if POSTGRES_POOL is None:
        if psycopg2_pool is None:
            raise RuntimeError("DATABASE_URL is set, but psycopg2 is not installed.")

        POSTGRES_POOL = psycopg2_pool.SimpleConnectionPool(
            1,
            POSTGRES_POOL_MAX,
            normalized_database_url(DATABASE_URL),
            connect_timeout=DB_CONNECT_TIMEOUT,
            keepalives=1,
            keepalives_idle=30,
            keepalives_interval=10,
            keepalives_count=5
        )

    return POSTGRES_POOL


def get_postgres_connection():
    connection_pool = get_postgres_pool()
    connection = connection_pool.getconn()

    if connection.closed:
        connection_pool.putconn(connection, close=True)
        connection = connection_pool.getconn()

    try:
        validation_cursor = connection.cursor()
        validation_cursor.execute("SELECT 1")
        validation_cursor.close()
    except Exception:
        connection_pool.putconn(connection, close=True)
        connection = connection_pool.getconn()

    return DatabaseConnection(connection, connection_pool)


class DatabaseCursor:
    def __init__(self, cursor):
        self.cursor = cursor

    def execute(self, query, params=None):
        if USE_POSTGRES:
            query = query.replace("?", "%s")

        if params is None:
            return self.cursor.execute(query)

        return self.cursor.execute(query, params)

    def executemany(self, query, params):
        if USE_POSTGRES:
            query = query.replace("?", "%s")
        return self.cursor.executemany(query, params)

    def fetchone(self):
        return self.cursor.fetchone()

    def fetchall(self):
        return self.cursor.fetchall()


class DatabaseConnection:
    def __init__(self, connection, connection_pool=None):
        self.connection = connection
        self.connection_pool = connection_pool

    def cursor(self):
        return DatabaseCursor(self.connection.cursor())

    def commit(self):
        self.connection.commit()

    def close(self):
        if self.connection_pool:
            try:
                self.connection.rollback()
            except Exception:
                pass
            self.connection_pool.putconn(self.connection)
            return

        self.connection.close()


def get_db():
    if USE_POSTGRES:
        if psycopg2 is None:
            raise RuntimeError("DATABASE_URL is set, but psycopg2 is not installed.")
        return get_postgres_connection()

    database_dir = os.path.dirname(DATABASE_PATH)
    if database_dir:
        os.makedirs(database_dir, exist_ok=True)

    return sqlite3.connect(DATABASE_PATH, timeout=30)


def get_columns(cursor, table):
    if USE_POSTGRES:
        cursor.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name=?
            """,
            (table,)
        )
        return [column[0] for column in cursor.fetchall()]

    cursor.execute(f"PRAGMA table_info({table})")
    return [column[1] for column in cursor.fetchall()]


def add_column_if_missing(cursor, table, column, ddl):
    if column not in get_columns(cursor, table):
        cursor.execute(f"ALTER TABLE {table} ADD COLUMN {ddl}")


def ensure_db_initialized():
    global DB_INITIALIZED

    if DB_INITIALIZED:
        return

    with DB_INIT_LOCK:
        if DB_INITIALIZED:
            return

        init_db()
        DB_INITIALIZED = True


def sync_utang_status(cursor, utang_id=None):
    params = ()
    where = ""
    if utang_id is not None:
        where = "WHERE id=?"
        params = (utang_id,)

    cursor.execute(
        f"""
        UPDATE utang
        SET amount_paid = CASE
            WHEN COALESCE(amount_paid, 0) < 0 THEN 0
            WHEN COALESCE(amount_paid, 0) > total THEN total
            ELSE COALESCE(amount_paid, 0)
        END
        {where}
        """,
        params
    )

    cursor.execute(
        f"""
        UPDATE utang
        SET status = CASE
            WHEN COALESCE(amount_paid, 0) >= total THEN 'PAID'
            WHEN COALESCE(amount_paid, 0) > 0 THEN 'PARTIAL'
            ELSE 'UNPAID'
        END
        {where}
        """,
        params
    )


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customers (
        id {primary_key},
        name TEXT
    )
    """.format(primary_key=PRIMARY_KEY_SQL))

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id {primary_key},
        name TEXT,
        price REAL
    )
    """.format(primary_key=PRIMARY_KEY_SQL))

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS utang (
        id {primary_key},
        customer_id INTEGER,
        item_name TEXT,
        quantity INTEGER,
        price REAL,
        total REAL,
        status TEXT DEFAULT 'UNPAID'
    )
    """.format(primary_key=PRIMARY_KEY_SQL))

    add_column_if_missing(cursor, "customers", "phone", "phone TEXT DEFAULT ''")
    add_column_if_missing(cursor, "customers", "address", "address TEXT DEFAULT ''")
    add_column_if_missing(cursor, "customers", "notes", "notes TEXT DEFAULT ''")
    add_column_if_missing(cursor, "utang", "date_created", "date_created TEXT")
    add_column_if_missing(cursor, "utang", "amount_paid", "amount_paid REAL DEFAULT 0")
    add_column_if_missing(cursor, "utang", "due_date", "due_date TEXT DEFAULT ''")

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payments (
        id {primary_key},
        customer_id INTEGER,
        utang_id INTEGER,
        amount REAL,
        payment_date TEXT,
        note TEXT DEFAULT '',
        FOREIGN KEY(customer_id) REFERENCES customers(id),
        FOREIGN KEY(utang_id) REFERENCES utang(id)
    )
    """.format(primary_key=PRIMARY_KEY_SQL))

    cursor.execute("""
        UPDATE utang
        SET amount_paid = total
        WHERE status='PAID' AND COALESCE(amount_paid, 0)=0
    """)
    sync_utang_status(cursor)

    cursor.execute("SELECT COUNT(*) FROM products")
    if cursor.fetchone()[0] == 0:
        cursor.executemany(
            "INSERT INTO products (name, price) VALUES (?, ?)",
            [
                ("Coke 1.5L", 20),
                ("Noodles", 15),
                ("Sardines", 28),
                ("Bread", 10),
                ("Egg", 10)
            ]
        )

    conn.commit()
    conn.close()


# ---------------- HELPERS ---------------- #

def money(value):
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0


def display_datetime():
    return datetime.now().strftime("%b %d, %Y %I:%M %p")


def display_date():
    return datetime.now().strftime("%b %d, %Y")


def iso_date():
    return datetime.now().strftime("%Y-%m-%d")


def record_payment(cursor, utang_id, customer_id, amount, note=""):
    amount = money(amount)
    if amount <= 0:
        return 0

    cursor.execute(
        """
        SELECT total, COALESCE(amount_paid, 0)
        FROM utang
        WHERE id=? AND customer_id=?
        """,
        (utang_id, customer_id)
    )
    row = cursor.fetchone()
    if not row:
        return 0

    total, paid = row
    remaining = money(total - paid)
    if remaining <= 0:
        sync_utang_status(cursor, utang_id)
        return 0

    applied_amount = min(amount, remaining)
    cursor.execute(
        """
        INSERT INTO payments (customer_id, utang_id, amount, payment_date, note)
        VALUES (?, ?, ?, ?, ?)
        """,
        (customer_id, utang_id, applied_amount, display_datetime(), note)
    )
    cursor.execute(
        """
        UPDATE utang
        SET amount_paid = COALESCE(amount_paid, 0) + ?
        WHERE id=? AND customer_id=?
        """,
        (applied_amount, utang_id, customer_id)
    )
    sync_utang_status(cursor, utang_id)
    return applied_amount


def record_customer_payment(cursor, customer_id, amount, note=""):
    remaining_payment = money(amount)
    if remaining_payment <= 0:
        return 0

    cursor.execute(
        f"""
        SELECT id, {BALANCE_SQL} AS balance
        FROM utang
        WHERE customer_id=? AND {BALANCE_SQL} > 0
        ORDER BY id ASC
        """,
        (customer_id,)
    )

    applied_total = 0
    payment_note = note or "Customer partial payment"
    for utang_id, balance in cursor.fetchall():
        if remaining_payment <= 0:
            break

        applied_amount = record_payment(
            cursor,
            utang_id,
            customer_id,
            min(remaining_payment, balance),
            payment_note
        )
        applied_total = money(applied_total + applied_amount)
        remaining_payment = money(remaining_payment - applied_amount)

    return applied_total


def get_customers(cursor):
    cursor.execute(f"""
        SELECT customers.id,
               customers.name,
               COALESCE(SUM(
                   CASE
                       WHEN {BALANCE_SQL} > 0 THEN {BALANCE_SQL}
                       ELSE 0
                   END
               ), 0) AS balance,
               COALESCE(customers.phone, ''),
               COALESCE(customers.address, ''),
               COALESCE(customers.notes, '')
        FROM customers
        LEFT JOIN utang ON customers.id = utang.customer_id
        GROUP BY customers.id, customers.name, customers.phone,
                 customers.address, customers.notes
        ORDER BY customers.id DESC
    """)
    return cursor.fetchall()


def collect_record_filters():
    return {
        "status": request.args.get("status", ""),
        "customer_id": request.args.get("customer_id", ""),
        "search": request.args.get("search", "").strip()
    }


def get_all_records(cursor, filters=None):
    filters = filters or {}
    where = []
    params = []

    status = filters.get("status") or ""
    if status in {"UNPAID", "PARTIAL", "PAID"}:
        where.append("utang.status=?")
        params.append(status)
    elif status == "OPEN":
        where.append(f"{BALANCE_SQL} > 0")

    customer_id = filters.get("customer_id") or ""
    if customer_id:
        where.append("customers.id=?")
        params.append(customer_id)

    search = filters.get("search") or ""
    if search:
        where.append("(customers.name LIKE ? OR utang.item_name LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    cursor.execute(
        f"""
        SELECT utang.id,
               customers.name,
               utang.item_name,
               utang.quantity,
               utang.price,
               utang.total,
               utang.status,
               utang.date_created,
               COALESCE(utang.amount_paid, 0),
               {BALANCE_SQL} AS balance
        FROM utang
        JOIN customers ON utang.customer_id = customers.id
        {where_sql}
        ORDER BY utang.id DESC
        """,
        params
    )
    return cursor.fetchall()


def get_common_data(
    page="dashboard",
    selected_customer=None,
    utang_list=None,
    selected_total=0,
    payment_history=None,
    record_filters=None
):
    conn = get_db()
    cursor = conn.cursor()

    customers = get_customers(cursor)

    cursor.execute("SELECT * FROM products ORDER BY name")
    products = cursor.fetchall()

    cursor.execute(f"""
        SELECT COALESCE(SUM(
            CASE WHEN {BALANCE_SQL} > 0 THEN {BALANCE_SQL} ELSE 0 END
        ), 0)
        FROM utang
    """)
    total_utang = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(COALESCE(amount_paid, 0)), 0) FROM utang")
    total_paid = cursor.fetchone()[0]

    cursor.execute(
        "SELECT COALESCE(SUM(total),0) FROM utang WHERE date_created LIKE ?",
        (display_date() + "%",)
    )
    today_utang = cursor.fetchone()[0]

    cursor.execute(
        "SELECT COALESCE(SUM(amount),0) FROM payments WHERE payment_date LIKE ?",
        (display_date() + "%",)
    )
    today_payments = cursor.fetchone()[0]

    cursor.execute(f"""
        SELECT customers.name, COALESCE(SUM({BALANCE_SQL}),0) AS balance
        FROM customers
        JOIN utang ON customers.id = utang.customer_id
        WHERE {BALANCE_SQL} > 0
        GROUP BY customers.id, customers.name
        ORDER BY balance DESC
        LIMIT 1
    """)
    top_customer = cursor.fetchone()

    cursor.execute(f"""
        SELECT customers.name, COALESCE(SUM({BALANCE_SQL}),0) AS balance
        FROM customers
        JOIN utang ON customers.id = utang.customer_id
        WHERE {BALANCE_SQL} > 0
        GROUP BY customers.id, customers.name
        ORDER BY balance DESC
        LIMIT 5
    """)
    customer_chart = cursor.fetchall()

    cursor.execute("""
        SELECT payments.id,
               customers.name,
               utang.item_name,
               payments.amount,
               payments.payment_date,
               COALESCE(payments.note, '')
        FROM payments
        JOIN customers ON payments.customer_id = customers.id
        LEFT JOIN utang ON payments.utang_id = utang.id
        ORDER BY payments.id DESC
        LIMIT 8
    """)
    recent_payments = cursor.fetchall()

    filters = record_filters or {}
    all_records = get_all_records(cursor, filters)

    conn.close()

    return {
        "page": page,
        "customers": customers,
        "products": products,
        "total_utang": total_utang,
        "total_paid": total_paid,
        "today_utang": today_utang,
        "today_payments": today_payments,
        "top_customer": top_customer,
        "customer_chart_names": [row[0] for row in customer_chart],
        "customer_chart_totals": [row[1] for row in customer_chart],
        "selected_customer": selected_customer,
        "utang_list": utang_list or [],
        "selected_total": selected_total,
        "payment_history": payment_history or [],
        "recent_payments": recent_payments,
        "all_records": all_records,
        "record_filters": filters
    }


def csv_response(filename, headers, rows):
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    content = "\ufeff" + output.getvalue()
    return Response(
        content,
        mimetype="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# ---------------- PAGES ---------------- #

@app.route("/")
@login_required
def dashboard():
    return render_template("index.html", **get_common_data("dashboard"))


@app.route("/customers")
@login_required
def customers_page():
    return render_template("index.html", **get_common_data("customers"))


@app.route("/products")
@login_required
def products_page():
    return render_template("index.html", **get_common_data("products"))


@app.route("/records")
@login_required
def records_page():
    return render_template(
        "index.html",
        **get_common_data("records", record_filters=collect_record_filters())
    )


@app.route("/reports")
@login_required
def reports_page():
    return render_template("index.html", **get_common_data("reports"))


@app.route("/settings")
@login_required
def settings_page():
    return render_template("index.html", **get_common_data("settings"))


@app.route("/customer/<int:id>")
@login_required
def customer(id):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
        SELECT id,
               name,
               COALESCE(phone, ''),
               COALESCE(address, ''),
               COALESCE(notes, '')
        FROM customers
        WHERE id=?
    """, (id,))
    selected_customer = cursor.fetchone()

    if not selected_customer:
        conn.close()
        return redirect("/")

    cursor.execute(f"""
        SELECT id,
               customer_id,
               item_name,
               quantity,
               price,
               total,
               status,
               date_created,
               COALESCE(amount_paid, 0),
               {BALANCE_SQL} AS balance
        FROM utang
        WHERE customer_id=? AND {BALANCE_SQL} > 0
        ORDER BY id DESC
    """, (id,))
    utang_list = cursor.fetchall()

    cursor.execute(f"""
        SELECT COALESCE(SUM({BALANCE_SQL}),0)
        FROM utang
        WHERE customer_id=? AND {BALANCE_SQL} > 0
    """, (id,))
    selected_total = cursor.fetchone()[0]

    cursor.execute("""
        SELECT payments.id,
               utang.item_name,
               payments.amount,
               payments.payment_date,
               COALESCE(payments.note, '')
        FROM payments
        LEFT JOIN utang ON payments.utang_id = utang.id
        WHERE payments.customer_id=?
        ORDER BY payments.id DESC
        LIMIT 20
    """, (id,))
    payment_history = cursor.fetchall()

    conn.close()

    return render_template(
        "index.html",
        **get_common_data(
            "dashboard",
            selected_customer,
            utang_list,
            selected_total,
            payment_history
        )
    )


# ---------------- ACTIONS ---------------- #

@app.route("/add-customer", methods=["POST"])
@login_required
def add_customer():
    name = request.form["name"].strip()
    phone = request.form.get("phone", "").strip()
    address = request.form.get("address", "").strip()
    notes = request.form.get("notes", "").strip()

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO customers (name, phone, address, notes) VALUES (?, ?, ?, ?)",
        (name, phone, address, notes)
    )
    conn.commit()
    conn.close()

    return redirect("/customers")


@app.route("/update-customer/<int:id>", methods=["POST"])
@login_required
def update_customer(id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE customers
        SET name=?, phone=?, address=?, notes=?
        WHERE id=?
        """,
        (
            request.form["name"].strip(),
            request.form.get("phone", "").strip(),
            request.form.get("address", "").strip(),
            request.form.get("notes", "").strip(),
            id
        )
    )
    conn.commit()
    conn.close()
    return redirect(f"/customer/{id}")


@app.route("/add-product", methods=["POST"])
@login_required
def add_product():
    name = request.form["name"]
    price = float(request.form["price"])

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO products (name, price) VALUES (?, ?)", (name, price))
    conn.commit()
    conn.close()

    return redirect("/products")


@app.route("/delete-product/<int:id>", methods=["POST"])
@login_required
def delete_product(id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM products WHERE id=?", (id,))
    conn.commit()
    conn.close()

    return redirect("/products")


@app.route("/add-utang", methods=["POST"])
@login_required
def add_utang():
    cid = request.form["customer_id"]
    item = request.form["item_name"]
    qty = int(request.form["quantity"])
    price = float(request.form["price"])
    total = float(request.form["total"])

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    INSERT INTO utang (
        customer_id, item_name, quantity, price, total,
        status, date_created, amount_paid
    )
    VALUES (?, ?, ?, ?, ?, 'UNPAID', ?, 0)
    """, (cid, item, qty, price, total, display_datetime()))

    conn.commit()
    conn.close()

    return redirect(f"/customer/{cid}")


@app.route("/add-payment", methods=["POST"])
@login_required
def add_payment():
    utang_id = int(request.form["utang_id"])
    customer_id = int(request.form["customer_id"])
    amount = request.form.get("amount", 0)
    note = request.form.get("note", "").strip()

    conn = get_db()
    cursor = conn.cursor()
    record_payment(cursor, utang_id, customer_id, amount, note)
    conn.commit()
    conn.close()

    return redirect(f"/customer/{customer_id}")


@app.route("/add-customer-payment", methods=["POST"])
@login_required
def add_customer_payment():
    customer_id = int(request.form["customer_id"])
    amount = request.form.get("amount", 0)
    note = request.form.get("note", "").strip()

    conn = get_db()
    cursor = conn.cursor()
    record_customer_payment(cursor, customer_id, amount, note)
    conn.commit()
    conn.close()

    return redirect(f"/customer/{customer_id}")


@app.route("/delete-utang/<int:id>/<int:cid>", methods=["POST"])
@login_required
def delete_utang(id, cid):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM payments WHERE utang_id=?", (id,))
    cursor.execute("DELETE FROM utang WHERE id=?", (id,))
    conn.commit()
    conn.close()

    return redirect(f"/customer/{cid}")


@app.route("/mark-paid/<int:utang_id>/<int:customer_id>", methods=["POST"])
@login_required
def mark_paid(utang_id, customer_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        f"""
        SELECT {BALANCE_SQL}
        FROM utang
        WHERE id=? AND customer_id=?
        """,
        (utang_id, customer_id)
    )
    row = cursor.fetchone()
    if row:
        record_payment(cursor, utang_id, customer_id, row[0], "Marked fully paid")
    conn.commit()
    conn.close()

    return redirect(f"/customer/{customer_id}")


@app.route("/mark-all-paid/<int:customer_id>", methods=["POST"])
@login_required
def mark_all_paid(customer_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        f"""
        SELECT id, {BALANCE_SQL}
        FROM utang
        WHERE customer_id=? AND {BALANCE_SQL} > 0
        """,
        (customer_id,)
    )
    for utang_id, balance in cursor.fetchall():
        record_payment(cursor, utang_id, customer_id, balance, "Marked paid from full list")

    conn.commit()
    conn.close()

    return redirect(f"/customer/{customer_id}")


@app.route("/edit-utang/<int:utang_id>/<int:customer_id>", methods=["GET", "POST"])
@login_required
def edit_utang(utang_id, customer_id):
    conn = get_db()
    cursor = conn.cursor()

    if request.method == "POST":
        item_name = request.form["item_name"]
        quantity = int(request.form["quantity"])
        price = float(request.form["price"])
        total = quantity * price

        cursor.execute(f"""
        UPDATE utang
        SET item_name = ?,
            quantity = ?,
            price = ?,
            total = ?,
            amount_paid = {PAID_CAP_SQL}
        WHERE id = ?
        """, (item_name, quantity, price, total, total, utang_id))
        sync_utang_status(cursor, utang_id)

        conn.commit()
        conn.close()

        return redirect(f"/customer/{customer_id}")

    cursor.execute("""
        SELECT id,
               customer_id,
               item_name,
               quantity,
               price,
               total,
               status,
               date_created,
               COALESCE(amount_paid, 0)
        FROM utang
        WHERE id=?
    """, (utang_id,))
    utang = cursor.fetchone()

    cursor.execute("SELECT * FROM products ORDER BY name")
    products = cursor.fetchall()

    conn.close()

    return render_template(
        "edit_utang.html",
        utang=utang,
        products=products,
        customer_id=customer_id
    )


@app.route("/print/<int:customer_id>")
@login_required
def print_receipt(customer_id):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM customers WHERE id=?", (customer_id,))
    customer = cursor.fetchone()

    cursor.execute(f"""
        SELECT id,
               customer_id,
               item_name,
               quantity,
               price,
               total,
               status,
               date_created,
               COALESCE(amount_paid, 0),
               {BALANCE_SQL} AS balance
        FROM utang
        WHERE customer_id=? AND {BALANCE_SQL} > 0
        ORDER BY id DESC
    """, (customer_id,))
    utang_list = cursor.fetchall()

    cursor.execute(f"""
        SELECT COALESCE(SUM({BALANCE_SQL}),0)
        FROM utang
        WHERE customer_id=? AND {BALANCE_SQL} > 0
    """, (customer_id,))
    total = cursor.fetchone()[0]

    conn.close()

    return render_template(
        "print.html",
        customer=customer,
        utang_list=utang_list,
        total=total
    )


# ---------------- EXPORTS ---------------- #

@app.route("/export/customers")
@login_required
def export_customers():
    conn = get_db()
    cursor = conn.cursor()
    rows = get_customers(cursor)
    conn.close()
    return csv_response(
        f"customers-{datetime.now().strftime('%Y%m%d')}.csv",
        ["Customer ID", "Name", "Unpaid Balance", "Phone", "Address", "Notes"],
        rows
    )


@app.route("/export/records")
@login_required
def export_records():
    conn = get_db()
    cursor = conn.cursor()
    rows = get_all_records(cursor, collect_record_filters())
    conn.close()
    return csv_response(
        f"utang-records-{datetime.now().strftime('%Y%m%d')}.csv",
        [
            "Record ID", "Customer", "Item", "Qty", "Price", "Total",
            "Status", "Date Added", "Amount Paid", "Balance"
        ],
        rows
    )


@app.route("/export/customer/<int:customer_id>")
@login_required
def export_customer(customer_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM customers WHERE id=?", (customer_id,))
    customer = cursor.fetchone()
    rows = get_all_records(cursor, {"customer_id": str(customer_id)})
    conn.close()

    filename_name = customer[0].replace(" ", "-").lower() if customer else customer_id
    return csv_response(
        f"customer-{filename_name}-{datetime.now().strftime('%Y%m%d')}.csv",
        [
            "Record ID", "Customer", "Item", "Qty", "Price", "Total",
            "Status", "Date Added", "Amount Paid", "Balance"
        ],
        rows
    )


if __name__ == "__main__":
    ensure_db_initialized()
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", 5000)),
        debug=os.getenv("FLASK_DEBUG") == "1"
    )
