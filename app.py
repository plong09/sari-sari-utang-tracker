from flask import Flask, render_template, request, redirect
import sqlite3
from datetime import datetime

app = Flask(__name__)

def get_db():
    return sqlite3.connect("database.db")

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        price REAL
    )
    """)

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS utang (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER,
        item_name TEXT,
        quantity INTEGER,
        price REAL,
        total REAL,
        status TEXT DEFAULT 'UNPAID'
    )
    """)

    cursor.execute("PRAGMA table_info(utang)")
    columns = [column[1] for column in cursor.fetchall()]
    if "date_created" not in columns:
        cursor.execute("ALTER TABLE utang ADD COLUMN date_created TEXT")

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

def get_customers(cursor):
    cursor.execute("""
        SELECT customers.id, customers.name,
        COALESCE(SUM(
            CASE WHEN utang.status='UNPAID' THEN utang.total ELSE 0 END
        ), 0)
        FROM customers
        LEFT JOIN utang ON customers.id = utang.customer_id
        GROUP BY customers.id, customers.name
        ORDER BY customers.id DESC
    """)
    return cursor.fetchall()

def get_common_data(page="dashboard", selected_customer=None, utang_list=None, selected_total=0):
    conn = get_db()
    cursor = conn.cursor()

    customers = get_customers(cursor)

    cursor.execute("SELECT * FROM products ORDER BY name")
    products = cursor.fetchall()

    cursor.execute("SELECT COALESCE(SUM(total),0) FROM utang WHERE status='UNPAID'")
    total_utang = cursor.fetchone()[0]

    cursor.execute("SELECT COALESCE(SUM(total),0) FROM utang WHERE status='PAID'")
    total_paid = cursor.fetchone()[0]

    today = datetime.now().strftime("%b %d, %Y")
    cursor.execute(
        "SELECT COALESCE(SUM(total),0) FROM utang WHERE date_created LIKE ?",
        (today + "%",)
    )
    today_utang = cursor.fetchone()[0]

    cursor.execute("""
        SELECT customers.name, COALESCE(SUM(utang.total),0) AS balance
        FROM customers
        JOIN utang ON customers.id = utang.customer_id
        WHERE utang.status='UNPAID'
        GROUP BY customers.id, customers.name
        ORDER BY balance DESC
        LIMIT 1
    """)
    top_customer = cursor.fetchone()

    cursor.execute("""
        SELECT customers.name, COALESCE(SUM(utang.total),0) AS balance
        FROM customers
        JOIN utang ON customers.id = utang.customer_id
        WHERE utang.status='UNPAID'
        GROUP BY customers.id, customers.name
        ORDER BY balance DESC
        LIMIT 5
    """)
    customer_chart = cursor.fetchall()

    customer_chart_names = [row[0] for row in customer_chart]
    customer_chart_totals = [row[1] for row in customer_chart]

    cursor.execute("""
        SELECT utang.id, customers.name, utang.item_name, utang.quantity,
               utang.price, utang.total, utang.status, utang.date_created
        FROM utang
        JOIN customers ON utang.customer_id = customers.id
        ORDER BY utang.id DESC
    """)
    all_records = cursor.fetchall()

    conn.close()

    return {
        "page": page,
        "customers": customers,
        "products": products,
        "total_utang": total_utang,
        "total_paid": total_paid,
        "today_utang": today_utang,
        "top_customer": top_customer,
        "customer_chart_names": customer_chart_names,
        "customer_chart_totals": customer_chart_totals,
        "selected_customer": selected_customer,
        "utang_list": utang_list or [],
        "selected_total": selected_total,
        "all_records": all_records
    }

@app.route("/")
def dashboard():
    return render_template("index.html", **get_common_data("dashboard"))

@app.route("/customers")
def customers_page():
    return render_template("index.html", **get_common_data("customers"))

@app.route("/products")
def products_page():
    return render_template("index.html", **get_common_data("products"))

@app.route("/records")
def records_page():
    return render_template("index.html", **get_common_data("records"))

@app.route("/reports")
def reports_page():
    return render_template("index.html", **get_common_data("reports"))

@app.route("/settings")
def settings_page():
    return render_template("index.html", **get_common_data("settings"))

@app.route("/customer/<int:id>")
def customer(id):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM customers WHERE id=?", (id,))
    selected_customer = cursor.fetchone()

    cursor.execute("SELECT * FROM utang WHERE customer_id=? ORDER BY id DESC", (id,))
    utang_list = cursor.fetchall()

    cursor.execute("""
        SELECT COALESCE(SUM(total),0)
        FROM utang
        WHERE customer_id=? AND status='UNPAID'
    """, (id,))
    selected_total = cursor.fetchone()[0]

    conn.close()

    return render_template(
        "index.html",
        **get_common_data("dashboard", selected_customer, utang_list, selected_total)
    )

@app.route("/add-customer", methods=["POST"])
def add_customer():
    name = request.form["name"]

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO customers (name) VALUES (?)", (name,))
    conn.commit()
    conn.close()

    return redirect("/customers")

@app.route("/add-product", methods=["POST"])
def add_product():
    name = request.form["name"]
    price = float(request.form["price"])

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("INSERT INTO products (name, price) VALUES (?, ?)", (name, price))
    conn.commit()
    conn.close()

    return redirect("/products")

@app.route("/delete-product/<int:id>")
def delete_product(id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM products WHERE id=?", (id,))
    conn.commit()
    conn.close()

    return redirect("/products")

@app.route("/add-utang", methods=["POST"])
def add_utang():
    cid = request.form["customer_id"]
    item = request.form["item_name"]
    qty = int(request.form["quantity"])
    price = float(request.form["price"])
    total = float(request.form["total"])
    date_created = datetime.now().strftime("%b %d, %Y %I:%M %p")

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    INSERT INTO utang (customer_id, item_name, quantity, price, total, date_created)
    VALUES (?, ?, ?, ?, ?, ?)
    """, (cid, item, qty, price, total, date_created))

    conn.commit()
    conn.close()

    return redirect(f"/customer/{cid}")

@app.route("/delete-utang/<int:id>/<int:cid>")
def delete_utang(id, cid):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM utang WHERE id=?", (id,))
    conn.commit()
    conn.close()

    return redirect(f"/customer/{cid}")

@app.route("/mark-paid/<int:utang_id>/<int:customer_id>")
def mark_paid(utang_id, customer_id):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE utang SET status='PAID' WHERE id=?", (utang_id,))
    conn.commit()
    conn.close()

    return redirect(f"/customer/{customer_id}")

@app.route("/edit-utang/<int:utang_id>/<int:customer_id>", methods=["GET", "POST"])
def edit_utang(utang_id, customer_id):
    conn = get_db()
    cursor = conn.cursor()

    if request.method == "POST":
        item_name = request.form["item_name"]
        quantity = int(request.form["quantity"])
        price = float(request.form["price"])
        total = quantity * price

        cursor.execute("""
        UPDATE utang
        SET item_name = ?, quantity = ?, price = ?, total = ?
        WHERE id = ?
        """, (item_name, quantity, price, total, utang_id))

        conn.commit()
        conn.close()

        return redirect(f"/customer/{customer_id}")

    cursor.execute("SELECT * FROM utang WHERE id=?", (utang_id,))
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
def print_receipt(customer_id):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM customers WHERE id=?", (customer_id,))
    customer = cursor.fetchone()

    cursor.execute("""
        SELECT * FROM utang
        WHERE customer_id=? AND status='UNPAID'
    """, (customer_id,))
    utang_list = cursor.fetchall()

    cursor.execute("""
        SELECT COALESCE(SUM(total),0)
        FROM utang
        WHERE customer_id=? AND status='UNPAID'
    """, (customer_id,))
    total = cursor.fetchone()[0]

    conn.close()

    return render_template(
        "print.html",
        customer=customer,
        utang_list=utang_list,
        total=total
    )

if __name__ == "__main__":
    init_db()
    app.run(debug=True)