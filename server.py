# Сервер кофейни: Python 3 и встроенная база SQLite.
import hashlib
import hmac
import json
import math
import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB = ROOT / 'zerno.db'
SESSIONS = {}
STICKERS = ['⭐', '❤️', '🔥', '🌈', '🐱', '🦄', '🍀', '😎']


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 200000).hex()


def connect():
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    return db


def init_db():
    with connect() as db:
        db.executescript('''
            CREATE TABLE IF NOT EXISTS users (
                email TEXT PRIMARY KEY, name TEXT, password TEXT, salt TEXT, role TEXT, login TEXT);
            CREATE TABLE IF NOT EXISTS products (
                id INTEGER PRIMARY KEY, name TEXT, cat TEXT, price INTEGER, em TEXT, desc TEXT);
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY, title TEXT, date TEXT, text TEXT);
            CREATE TABLE IF NOT EXISTS orders (
                id INTEGER PRIMARY KEY, date TEXT, user TEXT, items TEXT, total INTEGER, stk TEXT);
        ''')
        user_columns = {row['name'] for row in db.execute('PRAGMA table_info(users)')}
        if 'login' not in user_columns:
            db.execute('ALTER TABLE users ADD COLUMN login TEXT')

        used_logins = set()
        for row in db.execute('SELECT email, login FROM users ORDER BY email').fetchall():
            login = row['login']
            if not login:
                base = re.sub(r'[^A-Za-z0-9_.-]+', '_', row['email'].split('@', 1)[0])
                base = base.strip('._-')[:30]
                if len(base) < 3:
                    base = 'user'
                login = base
                suffix = 2
                while login.casefold() in used_logins:
                    tail = '_' + str(suffix)
                    login = base[:30 - len(tail)] + tail
                    suffix += 1
                db.execute('UPDATE users SET login=? WHERE email=?', (login, row['email']))
            used_logins.add(login.casefold())
        db.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login ON users(login COLLATE NOCASE)')

        # Начальные данные загружаются только при первом запуске.
        if db.execute('SELECT COUNT(*) FROM users').fetchone()[0] == 0:
            salt = secrets.token_hex(16)
            db.execute('INSERT INTO users (email, name, password, salt, role, login) VALUES (?, ?, ?, ?, ?, ?)',
                       ('admin@zerno.ru', 'Админ', password_hash('admin123', salt), salt, 'admin', 'admin'))
            products = [
                (1, 'Эспрессо', 'Кофе', 150, '☕', 'Двойной шот, плотная крема'),
                (2, 'Капучино', 'Кофе', 230, '🥛', 'Молочная пена, 180 мл'),
                (3, 'Флэт уайт', 'Кофе', 260, '☕', 'Двойной ристретто и бархатное молоко'),
                (4, 'Колд брю', 'Кофе', 290, '🧊', 'Настаивается 16 часов'),
                (5, 'Улун', 'Чай', 210, '🍃', 'Молочный улун, чайник на двоих'),
                (6, 'Матча латте', 'Чай', 310, '🍵', 'Церемониальная матча'),
                (7, 'Круассан', 'Десерты', 190, '🥐', 'Миндальный, выпекаем утром'),
                (8, 'Чизкейк', 'Десерты', 280, '🍰', 'Баскский, с ягодным соусом')]
            db.executemany('INSERT INTO products VALUES (?, ?, ?, ?, ?, ?)', products)
            db.executemany('INSERT INTO posts VALUES (?, ?, ?, ?)', [
                (1, 'Как мы обжариваем зерно', '2026-09-12', 'Обжариваем небольшими партиями и даём зерну отлежаться пять дней.'),
                (2, 'Эспрессо или фильтр?', '2026-10-02', 'Эспрессо — концентрат и плотный вкус. Фильтр — прозрачность и ягодные ноты.')])


class Handler(BaseHTTPRequestHandler):
    def reply(self, code, data, cookie=None):
        body = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        if cookie:
            self.send_header('Set-Cookie', cookie)
        self.end_headers()
        self.wfile.write(body)

    def user(self, db):
        cookie = SimpleCookie(self.headers.get('Cookie', ''))
        token = cookie.get('session')
        email = SESSIONS.get(token.value) if token else None
        return db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()

    def get_state(self, db):
        user = self.user(db)
        admin = user and user['role'] == 'admin'
        orders = db.execute('SELECT * FROM orders' if admin else
                            'SELECT * FROM orders WHERE user=?', () if admin else
                            (user['email'] if user else '',)).fetchall()
        orders = [dict(row) for row in orders]
        for order in orders:
            order['items'] = json.loads(order['items'])
            order['stk'] = json.loads(order['stk'])
        users = db.execute('SELECT name, email, role FROM users').fetchall() if admin else ([user] if user else [])
        return {'products': [dict(r) for r in db.execute('SELECT * FROM products')],
                'posts': [dict(r) for r in db.execute('SELECT * FROM posts')],
                'orders': orders,
                'users': [{'name': u['name'], 'email': u['email'], 'role': u['role']} for u in users],
                'me': user['email'] if user else None}

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/state':
            with connect() as db:
                self.reply(200, self.get_state(db))
            return
        # Отдаём только публичные файлы, база и код сервера недоступны.
        files = {'/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/script.js': 'script.js'}
        if path not in files:
            self.send_error(404)
            return
        file = ROOT / files[path]
        types = {'.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript'}
        body = file.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', types[file.suffix] + '; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        # Запросы с чужих сайтов не принимаются.
        origin = self.headers.get('Origin')
        if origin and origin != 'http://' + self.headers.get('Host', ''):
            self.reply(403, {'error': 'Источник запроса запрещён.'})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if length < 0 or length > 100000:
                raise ValueError('Слишком большой запрос.')
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('Неверный формат запроса.')
            with connect() as db:
                result, cookie = self.action(db, data)
            self.reply(200, result, cookie)
        except (ValueError, TypeError, KeyError, sqlite3.IntegrityError) as error:
            self.reply(400, {'error': str(error) if isinstance(error, ValueError) else 'Проверьте заполненные поля.'})
        except PermissionError as error:
            self.reply(403, {'error': str(error)})

    def action(self, db, data):
        route = self.path
        user = self.user(db)
        cookie = None
        if route in ['/api/login', '/api/register']:
            email = str(data.get('email', '')).strip().lower()
            password = str(data.get('pass', ''))
            if route == '/api/register':
                name = text(data, 'name', 80)
                login = text(data, 'login', 30)
                if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{2,29}', login):
                    raise ValueError('Логин должен содержать от 3 до 30 латинских букв, цифр, точки, дефиса или подчёркивания.')
                if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email) or len(email) > 120:
                    raise ValueError('Введите корректный email.')
                if len(password) < 6 or len(password) > 128:
                    raise ValueError('Пароль должен содержать от 6 до 128 символов.')
                if db.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
                    raise ValueError('Этот email уже зарегистрирован.')
                if db.execute('SELECT 1 FROM users WHERE login=? COLLATE NOCASE', (login,)).fetchone():
                    raise ValueError('Этот логин уже занят.')
                salt = secrets.token_hex(16)
                db.execute('INSERT INTO users (email, name, password, salt, role, login) VALUES (?, ?, ?, ?, ?, ?)',
                           (email, name, password_hash(password, salt), salt, 'user', login))
            identifier = str(data.get('identifier', data.get('email', ''))).strip().lower()
            found = db.execute(
                'SELECT * FROM users WHERE email=? COLLATE NOCASE OR login=? COLLATE NOCASE',
                (identifier, identifier)).fetchone()
            if not found or not hmac.compare_digest(found['password'], password_hash(password, found['salt'])):
                raise ValueError('Неверный логин/email или пароль.')
            old = SimpleCookie(self.headers.get('Cookie', '')).get('session')
            if old:
                SESSIONS.pop(old.value, None)
            token = secrets.token_urlsafe(32)
            SESSIONS[token] = found['email']
            cookie = 'session=' + token + '; HttpOnly; SameSite=Lax; Path=/'
            return {'ok': True}, cookie
        if route == '/api/logout':
            token = SimpleCookie(self.headers.get('Cookie', '')).get('session')
            if token:
                SESSIONS.pop(token.value, None)
            return {'ok': True}, 'session=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/'
        if route == '/api/checkout':
            if not user:
                raise PermissionError('Войдите, чтобы оформить заказ.')
            cart = data.get('cart', {})
            if not isinstance(cart, dict) or not 1 <= len(cart) <= 100:
                raise ValueError('Корзина пуста или слишком велика.')
            items = []
            for product_id, qty in cart.items():
                product = db.execute('SELECT * FROM products WHERE id=?', (int(product_id),)).fetchone()
                if not product or type(qty) is not int or not 1 <= qty <= 99:
                    raise ValueError('Состав корзины изменился. Проверьте товары и количество.')
                items.append({'id': product['id'], 'name': product['name'], 'cat': product['cat'],
                              'price': product['price'], 'qty': qty})
            stickers = data.get('stk', [])
            if not isinstance(stickers, list) or len(stickers) > 50:
                raise ValueError('Можно добавить не более 50 стикеров.')
            if any(s not in STICKERS for s in stickers):
                raise ValueError('Неизвестный стикер.')
            total = sum(i['price'] * i['qty'] for i in items)
            date = datetime.now(timezone.utc).isoformat()
            cursor = db.execute('INSERT INTO orders (date,user,items,total,stk) VALUES (?,?,?,?,?)',
                                (date, user['email'], json.dumps(items), total, json.dumps(stickers)))
            return {'order': {'id': cursor.lastrowid, 'date': date, 'user': user['email'],
                              'items': items, 'total': total, 'stk': stickers}}, None
        if not user or user['role'] != 'admin':
            raise PermissionError('Доступ только для администратора.')
        if route == '/api/product/save':
            price = data.get('price')
            if type(price) not in [int, float] or not math.isfinite(price) or not 1 <= price <= 100000 or price != int(price):
                raise ValueError('Цена должна быть целым числом от 1 до 100000.')
            values = (text(data, 'name', 80), text(data, 'cat', 40), int(price),
                      text(data, 'em', 10), text(data, 'desc', 500))
            if data.get('id'):
                if db.execute('UPDATE products SET name=?,cat=?,price=?,em=?,desc=? WHERE id=?',
                              values + (int(data['id']),)).rowcount == 0:
                    raise ValueError('Товар не найден.')
            else:
                db.execute('INSERT INTO products (name,cat,price,em,desc) VALUES (?,?,?,?,?)', values)
        elif route == '/api/post/save':
            values = (text(data, 'title', 150), datetime.now().date().isoformat(), text(data, 'text', 10000))
            if data.get('id'):
                if db.execute('UPDATE posts SET title=?,date=?,text=? WHERE id=?', values + (int(data['id']),)).rowcount == 0:
                    raise ValueError('Запись не найдена.')
            else:
                db.execute('INSERT INTO posts (title,date,text) VALUES (?,?,?)', values)
        elif route in ['/api/product/delete', '/api/post/delete']:
            table = 'products' if route == '/api/product/delete' else 'posts'
            db.execute('DELETE FROM ' + table + ' WHERE id=?', (int(data['id']),))
        else:
            raise ValueError('Неизвестная команда.')
        return {'ok': True}, None


def text(data, field, limit):
    value = str(data.get(field, '')).strip()
    if not value or len(value) > limit:
        raise ValueError('Заполните все поля. Максимальная длина: ' + str(limit) + '.')
    return value


if __name__ == '__main__':
    init_db()
    port = int(os.environ.get('PORT', '8000'))
    print('Откройте http://localhost:' + str(port), flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
