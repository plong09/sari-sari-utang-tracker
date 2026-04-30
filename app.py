from flask import Flask, render_template, request, redirect
import sqlite3

app = Flask(__name__)

def init_db():
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()

    cursor.execute("""
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
    )
    """)

    conn.commit()
    conn.close()

@app.route("/")
def index():
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM customers ORDER BY id DESC")
    customers = cursor.fetchall()

    conn.close()

    return render_template("index.html", customers=customers)

@app.route("/add-customer", methods=["POST"])
def add_customer():
    name = request.form["name"]

    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()

    cursor.execute("INSERT INTO customers (name) VALUES (?)", (name,))

    conn.commit()
    conn.close()

    return redirect("/")

@app.route("/customer/<int:customer_id>")
def customer_page(customer_id):
    conn = sqlite3.connect("database.db")
    cursor = conn.cursor()

    cursor.execute("SELECT * FROM customers ORDER BY id DESC")
    customers = cursor.fetchall()

    cursor.execute("SELECT * FROM customers WHERE id = ?", (customer_id,))
    selected_customer = cursor.fetchone()

    conn.close()

    return render_template(
        "index.html",
        customers=customers,
        selected_customer=selected_customer
    )

if __name__ == "__main__":
    init_db()
    app.run(debug=True)