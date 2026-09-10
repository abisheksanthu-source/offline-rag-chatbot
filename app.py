import os
import re

from flask import (
    Flask,
    render_template,
    request,
    redirect,
    session,
    jsonify
)

from database import (
    init_db,
    register_user,
    login_user
)

from rag import (
    retrieve_context,
    save_pdf_as_text
)

try:
    from flask_cors import CORS
except ImportError:
    CORS = None

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "offline-secret-key")

if CORS:
    CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

# Initialize SQLite database
init_db()


# =========================
# CORS HEADERS & PREFLIGHT
# =========================

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
    return response


@app.before_request
def handle_options_preflight():
    if request.method == "OPTIONS":
        response = app.make_default_options_response()
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization"
        response.headers["Access-Control-Allow-Methods"] = "GET,POST,PUT,DELETE,OPTIONS"
        return response


# =========================
# HELPER: format raw answer text into readable paragraphs
# =========================

def format_answer(text):
    if not text:
        return text
    # Break before numbered items like "1.", "2." etc.
    text = re.sub(r'(?<!^)(?<!\d)(\d{1,2}\.)\s', r'\n\n\1 ', text)
    # Break before common headers like "Importance:", "Syntax:", "Advantages:"
    text = re.sub(r'\s([A-Z][a-zA-Z ]{2,25}:)\s', r'\n\n\1 ', text)
    # Collapse accidental multiple blank lines
    text = re.sub(r'\n{3,}', '\n\n', text)
    return text.strip()


# =========================
# REST API ENDPOINTS (for Vercel Frontend / External Clients)
# =========================

@app.route("/health", methods=["GET"])
@app.route("/api/health", methods=["GET"])
def health():
    knowledge_dir = "knowledge"
    doc_count = 0
    if os.path.exists(knowledge_dir):
        doc_count = len([f for f in os.listdir(knowledge_dir) if f.endswith(".txt")])

    return jsonify({
        "status": "ok",
        "service": "offline-rag-backend",
        "doc_count": doc_count
    })


@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json(silent=True) or request.form
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()

    if not username or not password:
        return jsonify({
            "success": False,
            "message": "Username and password are required."
        }), 400

    if register_user(username, password):
        return jsonify({
            "success": True,
            "message": "Registration successful! You can now log in."
        })

    return jsonify({
        "success": False,
        "message": "Username already exists."
    }), 400


@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json(silent=True) or request.form
    username = (data.get("username") or "").strip()
    password = (data.get("password") or "").strip()

    if login_user(username, password):
        session["username"] = username
        return jsonify({
            "success": True,
            "username": username,
            "message": "Login successful."
        })

    return jsonify({
        "success": False,
        "message": "Invalid username or password."
    }), 401


@app.route("/api/status", methods=["GET"])
def api_status():
    knowledge_file = os.path.join("knowledge", "uploaded_pdf.txt")
    has_doc = os.path.exists(knowledge_file) and os.path.getsize(knowledge_file) > 0

    return jsonify({
        "active_pdf": session.get("pdf_name"),
        "has_document": has_doc,
        "username": session.get("username")
    })


@app.route("/api/upload", methods=["POST"])
def api_upload():
    if "pdf" not in request.files:
        return jsonify({
            "success": False,
            "message": "Please attach a PDF file."
        }), 400

    pdf = request.files["pdf"]

    if not pdf or pdf.filename == "":
        return jsonify({
            "success": False,
            "message": "Please choose a PDF first."
        }), 400

    if not pdf.filename.lower().endswith(".pdf"):
        return jsonify({
            "success": False,
            "message": "Only PDF files are allowed."
        }), 400

    os.makedirs("uploads", exist_ok=True)
    pdf_path = os.path.join("uploads", pdf.filename)
    pdf.save(pdf_path)

    success = save_pdf_as_text(pdf_path)

    if success:
        session["pdf_name"] = pdf.filename
        return jsonify({
            "success": True,
            "filename": pdf.filename,
            "message": f"'{pdf.filename}' uploaded and indexed successfully!"
        })

    return jsonify({
        "success": False,
        "message": "Could not extract text from this PDF."
    }), 400


@app.route("/api/ask", methods=["POST"])
def api_ask():
    data = request.get_json(silent=True) or request.form
    question = (data.get("question") or "").strip()

    if not question:
        return jsonify({
            "success": False,
            "message": "Please provide a question."
        }), 400

    raw_context = retrieve_context(question)
    answer = format_answer(raw_context)

    return jsonify({
        "success": True,
        "question": question,
        "answer": answer
    })


# =========================
# WEB ROUTES (Original Jinja2 UI)
# =========================

@app.route("/")
def home():
    if "username" not in session:
        return redirect("/login")
    return redirect("/chat")


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]

        success = register_user(username, password)
        if success:
            return redirect("/login")
        return "Username already exists!"

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]

        if login_user(username, password):
            session["username"] = username
            return redirect("/chat")

        return render_template(
            "login.html",
            error="Invalid username or password"
        )

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")


@app.route("/chat", methods=["GET", "POST"])
def chat():
    if "username" not in session:
        return redirect("/login")

    answer = None
    message = None
    question = None

    if request.method == "POST":
        action = request.form.get("action")

        if action == "upload":
            pdf = request.files.get("pdf")
            if not pdf or pdf.filename == "":
                message = "Please choose a PDF first."
            elif not pdf.filename.lower().endswith(".pdf"):
                message = "Only PDF files are allowed."
            else:
                os.makedirs("uploads", exist_ok=True)
                pdf_path = os.path.join("uploads", pdf.filename)
                pdf.save(pdf_path)

                success = save_pdf_as_text(pdf_path)
                if success:
                    session["pdf_name"] = pdf.filename
                    message = "✅ PDF uploaded successfully: " + pdf.filename
                else:
                    message = "❌ Could not read this PDF."

        elif action == "ask":
            question = request.form.get("question", "").strip()
            if not question:
                answer = "Please enter a question."
            else:
                context = retrieve_context(question)
                answer = format_answer(context)

    return render_template(
        "chat.html",
        username=session["username"],
        answer=answer,
        question=question,
        message=message,
        pdf_name=session.get("pdf_name")
    )


# =========================
# START SERVER
# =========================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(
        host="0.0.0.0",
        port=port,
        debug=False
    )