/**
 * ЗЕРНО — кофейня. SPA на vanilla JS.
 */

/* ============================================================
 * СОСТОЯНИЕ И ХРАНИЛИЩЕ
 * ============================================================ */
const STORAGE_KEY = 'zerno-v1';

const $ = sel => document.querySelector(sel);
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));
const formatPrice = n => n.toLocaleString('ru-RU') + ' ₽';

// Каталог, пользователи и заказы хранятся на сервере.
let state = { products: [], posts: [], orders: [], users: [], me: null, cart: {}, stk: [] };
try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY + '-cart'));
    if (saved && saved.cart && Array.isArray(saved.stk)) {
        state.cart = saved.cart;
        state.stk = saved.stk;
    }
} catch (_) {}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY + '-cart', JSON.stringify({ cart: state.cart, stk: state.stk }));
    } catch (_) { toast('Браузер не смог сохранить корзину.'); }
}

async function api(path, data) {
    const options = data === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    };
    const response = await fetch('/api/' + path, options);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Ошибка сервера.');
    return result;
}

async function loadState() {
    const data = await api('state');
    Object.assign(state, data);
    for (const id of Object.keys(state.cart)) {
        if (!state.products.some(p => p.id == id)) delete state.cart[id];
    }
    saveState();
}

const getCurrentUser   = () => state.users.find(u => u.email === state.me);
const isUserAdmin      = () => !!getCurrentUser() && getCurrentUser().role === 'admin';
const cartQty          = () => Object.values(state.cart).reduce((s, q) => s + q, 0);
const cartItems        = () => Object.entries(state.cart)
    .map(([id, q]) => { const p = state.products.find(x => x.id == id); return p && { ...p, qty: q }; })
    .filter(Boolean);
const cartTotal        = () => cartItems().reduce((s, x) => s + x.price * x.qty, 0);

let activeCategory = 'Все';
let searchQuery    = '';
let errorMessage   = '';
const navigateTo   = h => { location.hash = h; };

/* ============================================================
 * НАВБАР
 * ============================================================ */
function renderNavbar() {
    const route = (location.hash || '#home').slice(1);
    const links = [
        ['home', 'Главная'],
        ['catalog', 'Каталог'],
        ['blog', 'Блог'],
        ['cart', 'Корзина' + (cartQty() ? ` (${cartQty()})` : '')]
    ];
    if (isUserAdmin()) links.push(['admin', 'Админка'], ['stats', 'Статистика']);

    const linksHtml = links.map(([h, t]) =>
        `<a href="#${h}" class="${route === h ? 'on' : ''}">${t}</a>`
    ).join('');
    const userHtml = getCurrentUser()
        ? `<a href="#login">${escapeHtml(getCurrentUser().name)}</a>`
        : `<a href="#login">Войти</a>`;

    $('#nav').innerHTML = `<a class="logo" href="#home">Зерно</a>` + linksHtml + userHtml;
}

/* ============================================================
 * КАРТОЧКА ТОВАРА + TOAST
 * ============================================================ */
function productCard(p) {
    return `
        <div class="card">
            <div class="em">${escapeHtml(p.em)}</div>
            <h3>${escapeHtml(p.name)}</h3>
            <div class="mut">${escapeHtml(p.desc)}</div>
            <div class="row" style="border:0;margin-top:auto">
                <span class="pr">${formatPrice(p.price)}</span>
                <button class="p" onclick="addToCart(${p.id})">В корзину</button>
            </div>
        </div>`;
}

function addToCart(id) {
    if ((state.cart[id] || 0) >= 99) return toast('Не более 99 штук одного товара.');
    state.cart[id] = (state.cart[id] || 0) + 1;
    saveState();
    renderNavbar();
    toast('Добавлено в корзину');
}

function toast(text) {
    const t = document.createElement('div');
    t.textContent = text;
    Object.assign(t.style, {
        position: 'fixed',
        bottom: 'calc(20px + env(safe-area-inset-bottom,0px))',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--pine)',
        color: '#fff',
        padding: '10px 18px',
        borderRadius: '99px',
        zIndex: 30,
        boxShadow: '0 4px 12px rgba(0,0,0,.15)'
    });
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1200);
}

/* ============================================================
 * СТРАНИЦЫ
 * ============================================================ */
function viewHome() {
    return `
        <div class="hero">
            <div>
                <h1>Кофе, который хочется допить до конца</h1>
                <p>Обжариваем сами, варим по заказу. Выберите напиток, соберите заказ и украсьте стаканчик стикерами.</p>
                <p><button class="c" onclick="navigateTo('catalog')">Открыть каталог</button></p>
            </div>
            <div class="cupbig">☕</div>
        </div>
        <h2>Популярное</h2>
        <div class="grid">${state.products.slice(0, 4).map(productCard).join('')}</div>`;
}

function viewCatalog() {
    const cats = ['Все', ...new Set(state.products.map(p => p.cat))];
    return `
        <h2>Каталог</h2>
        <input id="srch" placeholder="Найти напиток или десерт" value="${escapeHtml(searchQuery)}">
        <div class="chips">
            ${cats.map((c, i) => `<button class="${c === activeCategory ? 'on' : ''}" onclick="setCategory(${i})">${escapeHtml(c)}</button>`).join('')}
        </div>
        <div class="grid" id="grid">${renderCatalogGrid()}</div>`;
}

function setCategory(index) {
    activeCategory = ['Все', ...new Set(state.products.map(p => p.cat))][index];
    renderPage();
}

function renderCatalogGrid() {
    const q = searchQuery.toLowerCase();
    const list = state.products.filter(p =>
        (activeCategory === 'Все' || p.cat === activeCategory) &&
        p.name.toLowerCase().includes(q)
    );
    return list.length
        ? list.map(productCard).join('')
        : '<p class="mut">Ничего не найдено. Попробуйте другой запрос.</p>';
}

function viewBlog() {
    const posts = state.posts.slice().reverse().map(p => `
        <article class="card">
            <span class="mut">${p.date}</span>
            <h3>${escapeHtml(p.title)}</h3>
            <div>${escapeHtml(p.text)}</div>
        </article>`).join('');
    return `<h2>Блог</h2><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${posts || '<p class="mut">Пока нет записей.</p>'}</div>`;
}

function viewCart() {
    const items = cartItems();
    if (!items.length) {
        return `<h2>Корзина</h2>
            <p class="mut">Здесь пусто. Загляните в каталог.</p>
            <p><button class="p" onclick="navigateTo('catalog')">В каталог</button></p>`;
    }
    const rows = items.map(x => `
        <div class="row">
            <span>${escapeHtml(x.em)} ${escapeHtml(x.name)}<br><span class="mut">${formatPrice(x.price)}</span></span>
            <span>
                <button onclick="changeQty(${x.id},-1)">−</button>
                ${x.qty}
                <button onclick="changeQty(${x.id},1)">+</button>
            </span>
        </div>`).join('');

    const stickers = state.stk.map((s, i) =>
        `<span class="stk" data-i="${i}" style="left:${s.x}%;top:${s.y}%">${escapeHtml(s.e)}</span>`
    ).join('');
    const palette = ['⭐','❤️','🔥','🌈','🐱','🦄','🍀','😎']
        .map(e => `<span draggable="true" data-e="${e}">${e}</span>`).join('');

    return `
        <h2>Корзина</h2>
        <div class="two">
            <div class="panel">
                ${rows}
                <div class="row"><b>Итого</b> <b>${formatPrice(cartTotal())}</b></div>
                <p><button class="c" onclick="processCheckout()">Оформить заказ</button></p>
                <div class="err">${errorMessage}</div>
            </div>
            <div class="panel">
                <h3>Стикеры на стаканчик</h3>
                <div class="mut">Перетащите стикер на стакан. Двойной клик — удалить. На телефоне нажмите на стикер внизу и переместите его пальцем.</div>
                <div class="zone" id="zone">
                    <div class="cupi">🥤</div>
                    ${stickers}
                </div>
                <div class="pal">${palette}</div>
            </div>
        </div>`;
}

function changeQty(id, delta) {
    if (delta > 0 && state.cart[id] >= 99) return toast('Не более 99 штук одного товара.');
    state.cart[id] = (state.cart[id] || 0) + delta;
    if (state.cart[id] <= 0) delete state.cart[id];
    saveState();
    renderPage();
}

/* --- Авторизация --- */
function viewLogin() {
    const u = getCurrentUser();
    if (u) {
        return `<h2>Профиль</h2>
            <div class="panel" style="max-width:400px">
                <p>Вы вошли как <b>${escapeHtml(u.name)}</b></p>
                <p><button class="p" onclick="logout()">Выйти</button></p>
            </div>`;
    }
    return `<section class="auth-page">
            <h2>Вход</h2>
            <form class="panel auth" onsubmit="event.preventDefault(); doLogin()">
                <label>Логин или email<input id="login-identifier" type="text" autocomplete="username" required></label>
                <label>Пароль<input id="login-pass" type="password" autocomplete="current-password" required></label>
                <button class="c">Войти</button>
                <a class="auth-register" href="#register">Зарегистрироваться</a>
                <p class="mut">Учебный администратор: admin@zerno.ru / admin123</p>
            </form>
        </section>`;
}
function viewRegister() {
    return `<section class="auth-page">
            <h2>Регистрация</h2>
            <form class="panel auth" onsubmit="event.preventDefault(); doRegister()">
                <label>Имя<input id="reg-name" maxlength="80" autocomplete="name" required></label>
                <label>Логин<input id="reg-login" minlength="3" maxlength="30" pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,29}" autocomplete="username" required></label>
                <label>Email<input id="reg-email" type="email" autocomplete="email" required></label>
                <label>Пароль (от 6 символов)<input id="reg-pass" type="password" minlength="6" maxlength="128" autocomplete="new-password" required></label>
                <button class="c">Зарегистрироваться</button>
                <a class="auth-register" href="#login">Уже есть аккаунт</a>
            </form>
        </section>`;
}
async function doLogin() {
    try {
        await api('login', { identifier: $('#login-identifier').value.trim(), pass: $('#login-pass').value });
        await loadState();
        navigateTo(cartQty() ? 'cart' : 'home');
    } catch (error) { toast(error.message); }
}
async function doRegister() {
    try {
        await api('register', {
            name: $('#reg-name').value,
            login: $('#reg-login').value.trim(),
            email: $('#reg-email').value,
            pass: $('#reg-pass').value
        });
        await loadState();
        navigateTo(cartQty() ? 'cart' : 'home');
    } catch (error) { toast(error.message); }
}
async function logout() {
    try {
        await api('logout', {});
        await loadState();
        navigateTo('home');
    } catch (error) { toast(error.message); }
}

// Управление товарами и записями блога.
function viewAdmin() {
    return `<h2>Панель администратора</h2>
        <p>Товаров: ${state.products.length}. Заказов: ${state.orders.length}. Пользователей: ${state.users.length}.</p>
        <h3>Товары</h3>
        <form class="panel editor" id="product-form" onsubmit="event.preventDefault(); saveProduct()">
            <input name="id" type="hidden">
            <label>Название<input name="name" maxlength="80" required></label>
            <label>Категория<input name="cat" maxlength="40" required></label>
            <label>Цена, ₽<input name="price" type="number" min="1" max="100000" step="1" required></label>
            <label>Значок<input name="em" value="☕" maxlength="10" required></label>
            <label>Описание<textarea name="desc" maxlength="500" required></textarea></label>
            <div><button class="p">Сохранить товар</button> <button type="reset">Очистить</button></div>
        </form>
        <div class="scroll"><table><thead><tr><th>Товар</th><th>Категория</th><th>Цена</th><th>Действия</th></tr></thead><tbody>
            ${state.products.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.cat)}</td><td>${formatPrice(p.price)}</td>
            <td><button onclick="editProduct(${p.id})">Изменить</button> <button onclick="deleteEntry('product',${p.id})">Удалить</button></td></tr>`).join('')}
        </tbody></table></div>
        <h3 class="section-title">Блог</h3>
        <form class="panel editor" id="post-form" onsubmit="event.preventDefault(); savePost()">
            <input name="id" type="hidden">
            <label>Заголовок<input name="title" maxlength="150" required></label>
            <label>Текст<textarea name="text" maxlength="10000" rows="5" required></textarea></label>
            <div><button class="p">Сохранить запись</button> <button type="reset">Очистить</button></div>
        </form>
        ${state.posts.map(p => `<div class="row"><span>${escapeHtml(p.title)}</span><span>
            <button onclick="editPost(${p.id})">Изменить</button> <button onclick="deleteEntry('post',${p.id})">Удалить</button>
        </span></div>`).join('')}`;
}
function editProduct(id) {
    const product = state.products.find(p => p.id === id);
    const form = $('#product-form');
    for (const name of ['id', 'name', 'cat', 'price', 'em', 'desc']) form.elements[name].value = product[name];
    form.scrollIntoView({ block: 'center' });
}
function editPost(id) {
    const post = state.posts.find(p => p.id === id);
    const form = $('#post-form');
    for (const name of ['id', 'title', 'text']) form.elements[name].value = post[name];
    form.scrollIntoView({ block: 'center' });
}
async function saveProduct() {
    const data = Object.fromEntries(new FormData($('#product-form')));
    data.price = Number(data.price);
    await adminAction('product/save', data);
}
async function savePost() {
    await adminAction('post/save', Object.fromEntries(new FormData($('#post-form'))));
}
async function deleteEntry(type, id) {
    if (confirm('Удалить выбранную запись?')) await adminAction(type + '/delete', { id });
}
async function adminAction(path, data) {
    try {
        await api(path, data);
        await loadState();
        activeCategory = 'Все';
        renderPage();
        toast('Изменения сохранены');
    } catch (error) { toast(error.message); }
}

function viewStats() {
    const total   = state.orders.reduce((s, o) => s + o.total, 0);
    const avg     = state.orders.length ? Math.round(total / state.orders.length) : 0;
    const byCat   = Object.create(null);
    state.orders.forEach(o => o.items.forEach(i => {
        byCat[i.cat] = (byCat[i.cat] || 0) + i.qty;
    }));
    const catRows = Object.entries(byCat)
        .map(([c, q]) => `<tr><td>${escapeHtml(c)}</td><td>${q}</td></tr>`).join('');

    const days = {};
    for (let i = 6; i >= 0; i--) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        days[day.toLocaleDateString('ru-RU')] = 0;
    }
    for (const order of state.orders) {
        const day = new Date(order.date).toLocaleDateString('ru-RU');
        if (day in days) days[day] += order.total;
    }
    const max = Math.max(1, ...Object.values(days));
    const bars = Object.entries(days).map(([day, value]) => `<div class="chart-row">
        <span>${day.slice(0, 5)}</span><div class="bar-track"><div class="bar" style="width:${value / max * 100}%"></div></div>
        <span>${formatPrice(value)}</span></div>`).join('');
    const orderRows = state.orders.slice().reverse().map(o => `<tr><td>${o.id}</td>
        <td>${new Date(o.date).toLocaleString('ru-RU')}</td><td>${escapeHtml(o.user)}</td>
        <td>${formatPrice(o.total)}</td><td><button onclick="showReceipt(state.orders.find(o => o.id === ${o.id}))">Чек</button></td></tr>`).join('');
    return `
        <h2>Статистика продаж</h2>
        <div class="kpi">
            <div class="panel"><b>${state.orders.length}</b><span class="mut">Заказов</span></div>
            <div class="panel"><b>${formatPrice(total)}</b><span class="mut">Выручка</span></div>
            <div class="panel"><b>${formatPrice(avg)}</b><span class="mut">Средний чек</span></div>
        </div>
        <div class="panel scroll">
            <table>
                <thead><tr><th>Категория</th><th>Продано, шт</th></tr></thead>
                <tbody>${catRows || '<tr><td colspan="2">Продаж пока нет.</td></tr>'}</tbody>
            </table>
        </div>
        <section class="panel section-title"><h3>Выручка за последние 7 дней</h3>${bars}</section>
        <section class="panel scroll section-title"><h3>Заказы</h3><table>
            <thead><tr><th>№</th><th>Дата</th><th>Покупатель</th><th>Сумма</th><th>Чек</th></tr></thead>
            <tbody>${orderRows || '<tr><td colspan="5">Заказов пока нет.</td></tr>'}</tbody>
        </table></section>`;
}

/* ============================================================
 * ОФОРМЛЕНИЕ ЗАКАЗА И ЧЕК
 * ============================================================ */
let checkoutBusy = false;
async function processCheckout() {
    if (!getCurrentUser()) {
        toast('Войдите или зарегистрируйтесь, чтобы оформить заказ.');
        navigateTo('login');
        return;
    }
    if (checkoutBusy || !cartItems().length) return;
    checkoutBusy = true;
    try {
        const result = await api('checkout', { cart: state.cart, stk: state.stk.map(s => s.e) });
        state.cart = {};
        state.stk = [];
        state.orders.push(result.order);
        saveState();
        renderPage();
        showReceipt(result.order);
    } catch (error) { toast(error.message); }
    finally { checkoutBusy = false; }
}

function showReceipt(order) {
    const date = new Date(order.date);
    const dateStr = date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const lines = order.items.map(x =>
        `<div class="l"><span>${escapeHtml(x.name)} × ${x.qty}</span><span>${formatPrice(x.price * x.qty)}</span></div>`
    ).join('');
    const stickers = order.stk.length
        ? `<hr><div>Стикеры:</div><div class="st">${order.stk.map(escapeHtml).join(' ')}</div>`
        : '';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="rc">
            <div style="text-align:center;font-weight:700;font-size:1.1rem">ЗЕРНО</div>
            <div style="text-align:center" class="mut">чек заказа (учебный)</div>
            <hr>
            <div class="l"><span>Заказ №</span><span>${order.id}</span></div>
            <div class="l"><span>Дата</span><span>${dateStr}</span></div>
            <hr>
            ${lines}
            <hr>
            <div class="l"><b>ИТОГО</b><b>${formatPrice(order.total)}</b></div>
            ${stickers}
            <hr>
            <div style="text-align:center" class="mut">Спасибо, что зашли!</div>
            <p style="text-align:center;margin-top:14px">
                <button class="p" onclick="window.print()">Распечатать / PDF</button>
                <button onclick="this.closest('.modal').remove()">Закрыть</button>
            </p>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

/* ============================================================
 * РОУТЕР И ИНИЦИАЛИЗАЦИЯ
 * ============================================================ */
function renderPage() {
    const route = (location.hash || '#home').slice(1);
    renderNavbar();

    const views = {
        home: viewHome, catalog: viewCatalog, blog: viewBlog,
        cart: viewCart, login: viewLogin, register: viewRegister, admin: viewAdmin, stats: viewStats
    };
    if ((route === 'admin' || route === 'stats') && !isUserAdmin()) {
        $('#app').innerHTML = '<h2>Доступ закрыт</h2><p>Войдите под учётной записью администратора.</p><a href="#login">Войти</a>';
        return;
    }
    $('#app').innerHTML = (views[route] || viewHome)();

    if (route === 'catalog') initSearch();
    if (route === 'cart')    initStickers();
}

function initSearch() {
    const input = $('#srch');
    if (!input) return;
    input.addEventListener('input', e => {
        searchQuery = e.target.value;
        $('#grid').innerHTML = renderCatalogGrid();
    });
}

function initStickers() {
    const zone = $('#zone');
    const pal  = $('.pal');
    if (!zone || !pal) return;

    pal.addEventListener('dragstart', e => {
        const em = e.target.dataset.e;
        if (em) e.dataTransfer.setData('text/plain', em);
    });

    zone.addEventListener('dragover', e => e.preventDefault());
    zone.addEventListener('drop', e => {
        e.preventDefault();
        const em = e.dataTransfer.getData('text/plain');
        if (!['⭐','❤️','🔥','🌈','🐱','🦄','🍀','😎'].includes(em)) return;
        if (state.stk.length >= 50) return toast('Не более 50 стикеров.');
        const rect = zone.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top)  / rect.height) * 100;
        state.stk.push({ e: em, x: Math.max(8, Math.min(92, x)), y: Math.max(8, Math.min(92, y)) });
        saveState();
        renderPage();
    });

    pal.addEventListener('click', e => {
        if (!e.target.dataset.e) return;
        if (state.stk.length >= 50) return toast('Не более 50 стикеров.');
        state.stk.push({ e: e.target.dataset.e, x: 50, y: 50 });
        saveState();
        renderPage();
    });
    zone.querySelectorAll('.stk').forEach(sticker => {
        sticker.addEventListener('pointerdown', event => {
            event.preventDefault();
            sticker.setPointerCapture(event.pointerId);
            sticker.classList.add('moving');
        });
        sticker.addEventListener('pointermove', event => {
            if (!sticker.hasPointerCapture(event.pointerId)) return;
            const rect = zone.getBoundingClientRect();
            const item = state.stk[Number(sticker.dataset.i)];
            item.x = Math.max(8, Math.min(92, (event.clientX - rect.left) / rect.width * 100));
            item.y = Math.max(8, Math.min(92, (event.clientY - rect.top) / rect.height * 100));
            sticker.style.left = item.x + '%';
            sticker.style.top = item.y + '%';
        });
        sticker.addEventListener('pointerup', event => {
            sticker.releasePointerCapture(event.pointerId);
            sticker.classList.remove('moving');
            saveState();
        });
        sticker.addEventListener('pointercancel', () => {
            sticker.classList.remove('moving');
            saveState();
        });
    });
    zone.addEventListener('dblclick', e => {
        if (!e.target.classList.contains('stk')) return;
        const i = +e.target.dataset.i;
        state.stk.splice(i, 1);
        saveState();
        renderPage();
    });
}

window.addEventListener('hashchange', renderPage);
window.addEventListener('DOMContentLoaded', async () => {
    try {
        await loadState();
        renderPage();
    } catch (_) {
        $('#app').innerHTML = '<h2>Сервер недоступен</h2><p>Запустите server.py и откройте http://localhost:8000. Инструкция находится в файле README.txt.</p>';
    }
});