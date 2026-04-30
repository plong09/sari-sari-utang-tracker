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
        customer_id INTEGER,
        item_name TEXT,
        quantity INTEGER,
        price REAL,
        total REAL,
        status TEXT DEFAULT 'UNPAID'
    )
    """)

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

    customers = get_customers(cursor)

    cursor.execute("SELECT * FROM products")
    products = cursor.fetchall()

    cursor.execute("SELECT COALESCE(SUM(total), 0) FROM utang")
    total_utang = cursor.fetchone()[0]

    conn.close()

    return render_template("index.html",
        customers=customers,
        products=products,
        total_utang=total_utang,
        selected_customer=None,
        utang_list=[],
        selected_total=0
    )


@app.route("/customer/<int:id>")
@app.route("/customer/<int:id>")
def customer(id):
    conn = get_db()
    cursor = conn.cursor()

    # get customers list (left side)
    customers = get_customers(cursor)

    # get products
    cursor.execute("SELECT * FROM products ORDER BY name")
    products = cursor.fetchall()

    # get selected customer
    cursor.execute("SELECT * FROM customers WHERE id=?", (id,))
    selected_customer = cursor.fetchone()

    # get all utang (PAID + UNPAID for table display)
    cursor.execute("SELECT * FROM utang WHERE customer_id=? ORDER BY id DESC", (id,))
    utang_list = cursor.fetchall()

    # ✅ ONLY UNPAID TOTAL (THIS FIXES YOUR PROBLEM)
    cursor.execute("""
        SELECT COALESCE(SUM(total), 0)
        FROM utang
        WHERE customer_id=? AND status='UNPAID'
    """, (id,))
    selected_total = cursor.fetchone()[0]

    # ✅ DASHBOARD TOTAL (ONLY UNPAID)
    cursor.execute("""
        SELECT COALESCE(SUM(total), 0)
        FROM utang
        WHERE status='UNPAID'
    """)
    total_utang = cursor.fetchone()[0]

    conn.close()

    return render_template(
        "index.html",
        customers=customers,
        products=products,
        total_utang=total_utang,
        selected_customer=selected_customer,
        utang_list=utang_list,
        selected_total=selected_total
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


@app.route("/add-product", methods=["POST"])
def add_product():
    name = request.form["name"]
    price = float(request.form["price"])

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("INSERT INTO products (name, price) VALUES (?, ?)", (name, price))
    conn.commit()
    conn.close()

    return redirect(request.referrer)


@app.route("/delete-product/<int:id>")
def delete_product(id):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("DELETE FROM products WHERE id=?", (id,))
    conn.commit()
    conn.close()

    return redirect(request.referrer)


@app.route("/add-utang", methods=["POST"])
def add_utang():
    cid = request.form["customer_id"]
    item = request.form["item_name"]
    qty = int(request.form["quantity"])
    price = float(request.form["price"])
    total = float(request.form["total"])

    conn = get_db()
    cursor = conn.cursor()

    cursor.execute("""
    INSERT INTO utang (customer_id, item_name, quantity, price, total)
    VALUES (?, ?, ?, ?, ?)
    """, (cid, item, qty, price, total))

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


@app.route("/edit-utang/<int:utang_id>/<int:customer_id>", methods=["GET", "POST"])
def edit_utang(utang_id, customer_id):
    conn = get_db()
    cursor = conn.cursor()

    # IF USER CLICK SAVE
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

    # GET DATA FOR EDIT PAGE
    cursor.execute("SELECT * FROM utang WHERE id = ?", (utang_id,))
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

@app.route("/mark-paid/<int:utang_id>/<int:customer_id>")
def mark_paid(utang_id, customer_id):
    conn = get_db()
    cursor = conn.cursor()

    cursor.execute(
        "UPDATE utang SET status = 'PAID' WHERE id = ?",
        (utang_id,)
    )

    conn.commit()
    conn.close()

    return redirect(f"/customer/{customer_id}")


if __name__ == "__main__":


    
    init_db()
    app.run(debug=True) 

