from flask import Flask, render_template, request, redirect
import sqlite3

app = Flask(__name__)


def get_db():
    return sqlite3.connect("database.db")


def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL NOT NULL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS utang (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        total REAL NOT NULL,
        status TEXT DEFAULT 'UNPAID'
    )
    """)

    cursor.execute("SELECT COUNT(*) FROM products")
    product_count = cursor.fetchone()[0]

    if product_count == 0:
        default_products = [
            ("Coke 1.5L", 20),
            ("Noodles", 15),
            ("Sardines", 28),
            ("Bread", 10),
            ("Egg", 10)
        ]

        cursor.executemany(
            "INSERT INTO products (name, price) VALUES (?, ?)",
            default_products
        )

    conn.commit()
    conn.close()


def get_customers_with_total(cursor):
    cursor.execute("""
    SELECT customers.id, customers.name, COALESCE(SUM(utang.total), 0)
    FROM customers
    LEFT JOIN utang ON customers.id = utang.customer_id
    GROUP BY customers.id
    ORDER BY customers.id DESC
    """)
    return cursor.fetchall()


@app.route("/")
def index():
    conn = get_db()
    cursor = conn.cursor()

    customers = get_customers_with_total(cursor)

    cursor.execute("SELECT * FROM products ORDER BY name")
    products = cursor.fetchall()

    cursor.execute("SELECT COALESCE(SUM(total), 0) FROM utang")
    total_utang = cursor.fetchone()[0]

    conn.close()

    return render_template(
        "index.html",
        customers=customers,
        products=products,
        selected_customer=None,
        utang_list=[],
        selected_total=0,
        total_utang=total_utang
    )


@app.route("/add-customer", methods=["POST"])
def add_customer():
    name = request.form["name"]

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("INSERT INTO customers (name) VALUES (?)", (name,))

    conn.commit()
    conn.close()

    return redirect("/")


@app.route("/customer/<int:customer_id>")
def customer_page(customer_id):
    conn = get_db()
    cursor = conn.cursor()

    customers = get_customers_with_total(cursor)

    cursor.execute("SELECT * FROM products ORDER BY name")
    products = cursor.fetchall()

    cursor.execute("SELECT * FROM customers WHERE id = ?", (customer_id,))
    selected_customer = cursor.fetchone()

    cursor.execute(
        "SELECT * FROM utang WHERE customer_id = ? ORDER BY id DESC",
        (customer_id,)
    )
    utang_list = cursor.fetchall()

    cursor.execute(
        "SELECT COALESCE(SUM(total), 0) FROM utang WHERE customer_id = ?",
        (customer_id,)
    )
    selected_total = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(total), 0) FROM utang")
    total_utang = cursor.fetchone()[0]

    conn.close()

    return render_template(
        "index.html",
        customers=customers,
        products=products,
        selected_customer=selected_customer,
        utang_list=utang_list,
        selected_total=selected_total,
        total_utang=total_utang
    )


@app.route("/add-utang", methods=["POST"])
def add_utang():
    customer_id = request.form["customer_id"]
    item_name = request.form["item_name"]
    quantity = int(request.form["quantity"])
    price = float(request.form["price"])
    total = float(request.form["total"])

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    INSERT INTO utang (customer_id, item_name, quantity, price, total)
    VALUES (?, ?, ?, ?, ?)
    """, (customer_id, item_name, quantity, price, total))

    conn.commit()
    conn.close()

    return redirect(f"/customer/{customer_id}")


if __name__ == "__main__":
    init_db()
    app.run(debug=True)