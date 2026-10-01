#!/usr/bin/env python3
"""Tablero de puntuaciones (varios tableros) - solo libreria estandar de Python."""
import json, mimetypes, os, threading, uuid
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(BASE, "data.json")
STATIC_DIR = os.path.join(BASE, "static")
INDEX = os.path.join(STATIC_DIR, "index.html")
HOST, PORT = "0.0.0.0", int(os.environ.get("PORT", 8000))
LOCK = threading.Lock()

def new_id(): return uuid.uuid4().hex[:8]
def player(name): return {"id": new_id(), "name": name, "score": 0}
def board(names, title=None):
    return {"id": new_id(), "title": title or " vs ".join(names) or "Nuevo tablero",
            "players": [player(n) for n in names]}

def default_state():
    return {"boards": [board(["Dany", "Sistema"]), board(["Isaak", "Sistema"]),
                       board(["Persona 3", "Sistema"])]}

def load():
    try:
        with open(DATA_FILE, encoding="utf-8") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        state = default_state()
        save(state)  # se guarda ya, para que los IDs no cambien entre consultas
        return state
    if "boards" not in data:  # migra el formato de la version anterior (un solo tablero)
        data = {"boards": [{"id": new_id(), "title": data.get("title", "Tablero"),
                            "players": data.get("players", [])}]}
    return data

def save(state):
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2)
    os.replace(tmp, DATA_FILE)  # escritura atomica

def clean(v, fallback):
    v = str(v or "").strip()[:30]
    return v or fallback

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(n) or b"{}")
            return data if isinstance(data, dict) else {}
        except json.JSONDecodeError:
            return {}

    def do_HEAD(self):
        clean_path = self.path.split("?")[0].lstrip("/") or "index.html"
        target = os.path.abspath(os.path.join(STATIC_DIR, clean_path))
        if os.path.commonpath([STATIC_DIR, target]) == STATIC_DIR and os.path.isfile(target):
            mime, _ = mimetypes.guess_type(target)
            mime = mime or "application/octet-stream"
            if mime.startswith("text/") or mime in ("application/javascript", "application/json"):
                mime += "; charset=utf-8"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.end_headers()
        elif self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        elif self.path == "/api/state":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
        else:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        clean_path = self.path.split("?")[0].lstrip("/")
        if not clean_path or clean_path == "index.html":
            clean_path = "index.html"

        target = os.path.abspath(os.path.join(STATIC_DIR, clean_path))
        if os.path.commonpath([STATIC_DIR, target]) == STATIC_DIR and os.path.isfile(target):
            mime, _ = mimetypes.guess_type(target)
            mime = mime or "application/octet-stream"
            if mime.startswith("text/") or mime in ("application/javascript", "application/json"):
                mime += "; charset=utf-8"
            with open(target, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return

        if self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        elif self.path == "/api/state":
            with LOCK:
                self.send_json(load())
        else:
            self.send_json({"error": "no encontrado"}, 404)

    def do_POST(self):
        parts = [p for p in self.path.split("/") if p]
        data = self.body()
        with LOCK:
            state = load()
            boards = state["boards"]
            fb = lambda bid: next((b for b in boards if b["id"] == bid), None)
            err = lambda m, c=404: self.send_json({"error": m}, c)

            if parts == ["api", "reset-all"]:
                for b in boards:
                    for p in b["players"]:
                        p["score"] = 0

            elif parts == ["api", "boards"]:
                names = [clean(n, "") for n in (data.get("names") or [])][:8]
                names = [n for n in names if n]
                boards.append(board(names, clean(data.get("title"), "") or None))

            elif len(parts) >= 4 and parts[:2] == ["api", "boards"]:
                b = fb(parts[2])
                if not b:
                    return err("tablero no existe")
                act = parts[3]
                if len(parts) == 4:
                    if act == "title":
                        b["title"] = clean(data.get("title"), b["title"])
                    elif act == "reset":
                        for p in b["players"]: p["score"] = 0
                    elif act == "delete":
                        boards.remove(b)
                    elif act == "players":
                        b["players"].append(player(clean(data.get("name"), "Jugador")))
                    else:
                        return err("accion invalida", 400)
                elif len(parts) == 6 and act == "players":
                    p = next((x for x in b["players"] if x["id"] == parts[4]), None)
                    if not p:
                        return err("jugador no existe")
                    a = parts[5]
                    if a == "delta":
                        try: d = int(data.get("delta", 0))
                        except (TypeError, ValueError): d = 0
                        p["score"] += max(-100, min(100, d))
                    elif a == "rename":
                        p["name"] = clean(data.get("name"), p["name"])
                    elif a == "delete":
                        b["players"].remove(p)
                    else:
                        return err("accion invalida", 400)
                else:
                    return err("no encontrado")
            else:
                return err("no encontrado")

            save(state)
            self.send_json(state)

if __name__ == "__main__":
    print(f"Tablero en http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
