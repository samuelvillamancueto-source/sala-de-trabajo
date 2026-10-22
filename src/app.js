import { api, DEMO, RECOVERY } from './api.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { pendiente: 'Pendiente', en_proceso: 'En proceso', revision: 'Revisión', correcciones: 'Correcciones', listo: 'Listo' };
const PRIO = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const fmt = (d) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : 'Sin fecha');
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const late = (t) => t.due && t.status !== 'listo' && t.due < today();
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');

const IDEA_ST = { nueva: 'Nueva', aprobada: 'Aprobada', en_produccion: 'En producción', publicada: 'Publicada', descartada: 'Descartada' };
const IDEA_KIND = { viral: 'Viral', tendencia: 'Tendencia / meme', copy: 'Copy', campana: 'Ads / email / grupos', otro: 'Otro' };
const IDEA_FMT = { reel: 'Reel', tiktok: 'TikTok', story: 'Story', carrusel: 'Carrusel', post: 'Post', meme: 'Meme', email: 'Email', anuncio: 'Anuncio', otro: 'Otro' };
const S = { ideas: [], ifilter: { client: '', status: '', owner: '', q: '' }, me: null, tasks: [], clients: [], people: [], view: 'resumen', mode: 'tablero', filter: { who: '', client: '' }, toast: '' };
const isAdmin = () => S.me?.role === 'admin';
const pname = (id) => S.people.find((p) => p.id === id)?.name || 'Sin asignar';
const cname = (id) => S.clients.find((c) => c.id === id)?.name || '';

function renderNewPass(msg = '') {
  $('#app').innerHTML = `<main class="login"><form class="card login-card" id="nf"><div class="brand big"><span class="dot"></span>Sala de Trabajo</div>
    <p class="muted">Elige tu nueva contraseña (mínimo 10 caracteres).</p>
    <label>Nueva contraseña<input name="p" type="password" required minlength="10" autocomplete="new-password"></label>
    <div class="err" id="lerr">${esc(msg)}</div><button class="btn primary" type="submit">Guardar y entrar</button></form></main>`;
  $('#nf').onsubmit = async (e) => { e.preventDefault(); try { await api.setPassword(new FormData(e.target).get('p')); history.replaceState(null, '', location.pathname); await boot(); } catch (er) { $('#lerr').textContent = er.message; } };
}
async function boot() {
  if (RECOVERY && !S.recovered) { S.recovered = true; await api.me(); return renderNewPass(); }
  S.me = await api.me();
  if (!S.me) return renderLogin();
  if (!S.me.active) { await api.signOut(); return renderLogin('Tu cuenta está desactivada.'); }
  await refresh();
  S.view = (location.hash.slice(2) || (isAdmin() ? 'resumen' : 'mis'));
  if (!isAdmin() && !['mis'].includes(S.view)) S.view = 'mis';
  render();
}
async function refresh() {
  [S.tasks, S.clients, S.people] = await Promise.all([api.tasks(), api.clients(), api.people()]);
  S.ideas = isAdmin() ? await api.ideas().catch(() => []) : [];
}
function toast(m) { S.toast = m; const t = $('#toast'); if (t) { t.textContent = m; t.classList.add('on'); setTimeout(() => t.classList.remove('on'), 2600); } }
function friendly(e) {
  const m = String(e?.message || e || ''); const c = e?.code || '';
  if (/jwt|token.*expired|PGRST30[0-9]/i.test(m + c)) return 'Tu sesión ha caducado. Vuelve a entrar.';
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'Sin conexión con el servidor. Inténtalo de nuevo.';
  if (c === '42501' || /row-level security|permission denied/i.test(m)) return 'No tienes permiso para hacer esto.';
  if (c === '23514') return 'Revisa los datos: algún campo es demasiado largo o el enlace no empieza por http(s)://.';
  if (c === '23505') return 'Ese dato ya existe.';
  if (c === '23503') return 'No se puede por datos relacionados (por ejemplo, está en uso).';
  if (/[a-z_]+\.[a-z_]+|pgrst|violates|constraint|syntax/i.test(m) && !/[áéíóúñ ]{12}/.test(m)) return 'Algo salió mal. Inténtalo de nuevo.';
  return m || 'Algo salió mal.';
}
let busy = false;
async function guard(fn) {
  if (busy) return; busy = true;
  try { await fn(); } catch (e) {
    console.error(e);
    if (/jwt|PGRST30[0-9]/i.test(String(e?.message) + (e?.code || ''))) { await api.signOut().catch(() => {}); S.me = null; return renderLogin('Tu sesión ha caducado. Vuelve a entrar.'); }
    toast(friendly(e));
  } finally { busy = false; }
}
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast(friendly(e.reason)); });

// ---------- Login ----------
function renderLogin(msg = '', signup = false) {
  $('#app').innerHTML = `
  <main class="login"><form class="card login-card" id="lf">
    <div class="brand big"><span class="dot"></span>Sala de Trabajo</div>
    <p class="muted">${signup ? 'Crea tu cuenta con el correo al que te invitaron.' : 'Entra con tu cuenta.'}</p>
    ${DEMO ? '<p class="note">Vista previa con datos de ejemplo. Prueba admin@demo.test o lucia@demo.test (cualquier contraseña).</p>' : ''}
    <label>Correo<input name="email" type="email" required autocomplete="email" inputmode="email"></label>
    <label>Contraseña<input name="password" type="password" required minlength="8" autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
    <div class="err" id="lerr">${esc(msg)}</div>
    <button class="btn primary" type="submit">${signup ? 'Crear cuenta' : 'Entrar'}</button>
    ${signup || DEMO ? '' : '<button class="link" type="button" id="forgot">He olvidado la contraseña</button>'}
    <button class="link" type="button" id="swap">${signup ? 'Ya tengo cuenta' : 'Me han invitado: crear cuenta'}</button>
  </form></main>`;
  $('#swap').onclick = () => renderLogin('', !signup);
  const fg = $('#forgot'); if (fg) fg.onclick = async () => {
    const em = $('#lf').querySelector('[name=email]').value.trim();
    if (!em) return ($('#lerr').textContent = 'Escribe tu correo arriba y vuelve a pulsar.');
    try { await api.resetPassword(em); $('#lerr').textContent = 'Si el correo tiene cuenta, te llegará un enlace para elegir contraseña (revisa spam).'; } catch (er) { $('#lerr').textContent = er.message; }
  };
  $('#lf').onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try { signup ? await api.signUp(f.get('email'), f.get('password')) : await api.signIn(f.get('email'), f.get('password')); await boot(); }
    catch (er) { $('#lerr').textContent = er.message; btn.disabled = false; }
  };
}

// ---------- Layout ----------
function nav() {
  const items = isAdmin()
    ? [['resumen', 'Resumen'], ['tareas', 'Tareas'], ['mis', 'Mis encargos'], ['ideas', 'Ideas'], ['clientes', 'Clientes'], ['equipo', 'Equipo']]
    : [['mis', 'Mis encargos']];
  return items.map(([k, l]) => `<a href="#/${k}" class="nav ${S.view === k ? 'on' : ''}" data-v="${k}">${l}</a>`).join('');
}
function render() {
  const body = { resumen: vResumen, tareas: vTareas, mis: vMis, clientes: vClientes, equipo: vEquipo, ideas: vIdeas }[S.view] || vMis;
  $('#app').innerHTML = `
  <div class="shell">
    <header class="top"><div class="brand"><span class="dot"></span>Sala de Trabajo</div>
      <nav class="navbar">${nav()}</nav>
      <div class="who"><span>${esc(S.me.name)}<small>${isAdmin() ? 'Administrador' : 'Editor'}</small></span><button class="btn ghost" id="cal" title="Ver tus fechas en Google Calendar">Calendario</button><button class="btn ghost" id="out">Salir</button></div>
    </header>
    <main class="main" id="main">${body()}</main>
    <div id="toast" class="toast" role="status"></div>
  </div>`;
  $('#cal').onclick = async () => {
    let url; try { url = await api.calUrl(); } catch (e) { return toast('No se pudo generar el enlace'); }
    const o = document.createElement('div'); o.className = 'calmodal';
    o.innerHTML = `<div class="calbox"><h2>Tus fechas en Google Calendar</h2><p>Copia este enlace privado. En Google Calendar: <b>Otros calendarios</b> (+) &rarr; <b>Desde URL</b> &rarr; pégalo. Se actualiza solo (Google puede tardar unas horas). Solo aparecen las tareas con fecha${isAdmin() ? '' : ' que tienes asignadas'}.</p><input readonly value="${url}"><p class="small">No lo compartas: quien tenga el enlace ve los títulos de las tareas.</p><div class="row"><button class="btn ghost" id="cr" title="Invalida el enlace anterior">Regenerar enlace</button><button class="btn" id="cc">Copiar enlace</button><button class="btn ghost" id="cx">Cerrar</button></div></div>`;
    document.body.appendChild(o);
    const inp = o.querySelector('input'); inp.onclick = () => inp.select();
    o.querySelector('#cc').onclick = async () => { try { await navigator.clipboard.writeText(url); } catch { inp.select(); document.execCommand('copy'); } toast('Enlace copiado'); };
    o.querySelector('#cr').onclick = async () => { if (!confirm('Se crea un enlace nuevo y el anterior dejará de funcionar (tendrás que volver a añadirlo en Google Calendar). ¿Seguir?')) return; try { url = await api.rotateCal(); inp.value = url; toast('Enlace nuevo creado'); } catch (e) { toast(friendly(e)); } };
    o.querySelector('#cx').onclick = () => o.remove(); o.onclick = (e) => { if (e.target === o) o.remove(); };
  };
  $('#out').onclick = async () => { await api.signOut(); S.me = null; renderLogin(); };
  bind();
}
window.addEventListener('hashchange', () => { if (!S.me) return; const v = location.hash.slice(2); if (v && v !== S.view && (isAdmin() || v === 'mis')) { S.view = v; render(); } });

// ---------- Cards ----------
function card(t) {
  const link = t.round > 0;
  return `<article class="task ${late(t) ? 'late' : ''}" data-open="${t.id}" tabindex="0">
    <div class="row"><span class="chip p-${t.priority}">${PRIO[t.priority]}</span>${t.approved ? '<span class="chip ok">Aprobado</span>' : ''}<span class="grip" title="Arrastra para cambiar de estado" aria-hidden="true">⋮⋮</span></div>
    <h4>${esc(t.title)}</h4>
    <div class="meta">${t.client_id ? `<span>${esc(cname(t.client_id))}</span>` : ''}<span class="${late(t) ? 'bad' : ''}">${fmt(t.due)}</span></div>
    <div class="foot"><span class="av">${esc(pname(t.assigned_to)[0] || '?')}</span><span>${esc(pname(t.assigned_to))}</span>${link ? `<span class="chip">Ronda ${t.round}</span>` : ''}</div>
  </article>`;
}
function board(list) {
  return `<div class="board">${Object.entries(STATUS).map(([k, l]) => {
    const col = list.filter((t) => t.status === k);
    return `<section class="col" data-status="${k}"><h3>${l}<b>${col.length}</b></h3>${col.map(card).join('') || '<p class="empty">Nada aquí</p>'}</section>`;
  }).join('')}</div>`;
}
function listView(list) {
  if (!list.length) return '<p class="empty big">No hay tareas con estos filtros.</p>';
  return `<div class="card tablewrap"><table><thead><tr><th>Tarea</th><th>Cliente</th><th>Asignado a</th><th>Estado</th><th>Entrega</th></tr></thead><tbody>${
    list.map((t) => `<tr data-open="${t.id}" tabindex="0"><td><b>${esc(t.title)}</b><br><span class="chip p-${t.priority}">${PRIO[t.priority]}</span></td><td>${esc(cname(t.client_id))}</td><td>${esc(pname(t.assigned_to))}</td><td><span class="chip s-${t.status}">${STATUS[t.status]}</span></td><td class="${late(t) ? 'bad' : ''}">${fmt(t.due)}</td></tr>`).join('')}</tbody></table></div>`;
}
function calendar(list) {
  const base = new Date(); const y = base.getFullYear(), m = base.getMonth();
  const first = new Date(y, m, 1); const start = (first.getDay() + 6) % 7; const days = new Date(y, m + 1, 0).getDate();
  let cells = ''; for (let i = 0; i < start; i++) cells += '<div class="day off"></div>';
  for (let d = 1; d <= days; d++) {
    const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const ts = list.filter((t) => t.due === iso);
    cells += `<div class="day ${iso === today() ? 'now' : ''}"><span>${d}</span>${ts.map((t) => `<button class="pill s-${t.status}" data-open="${t.id}">${esc(t.title)}</button>`).join('')}</div>`;
  }
  return `<div class="card"><h3 class="cal-t">${base.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</h3><div class="cal"><div class="dow">${['L','M','X','J','V','S','D'].map((x) => `<b>${x}</b>`).join('')}</div><div class="days">${cells}</div></div></div>`;
}

// ---------- Views ----------
function vResumen() {
  const open = S.tasks.filter((t) => t.status !== 'listo');
  const lateN = S.tasks.filter(late).length;
  const rev = S.tasks.filter((t) => t.status === 'revision').length;
  const unassigned = open.filter((t) => !t.assigned_to).length;
  const next = [...open].sort((a, b) => (a.due || '9') < (b.due || '9') ? -1 : 1).slice(0, 5);
  const editors = S.people.filter((p) => p.role === 'editor');
  return `<h1>Resumen</h1>
  <div class="stats">
    <div class="card stat"><b>${open.length}</b><span>Tareas abiertas</span></div>
    <div class="card stat ${rev ? 'hl' : ''}"><b>${rev}</b><span>Para revisar</span></div>
    <div class="card stat ${lateN ? 'warn' : ''}"><b>${lateN}</b><span>Vencidas</span></div>
    <div class="card stat ${unassigned ? 'hl' : ''}"><b>${unassigned}</b><span>Sin asignar</span></div>
  </div>
  <div class="two">
    <section><h2>Próximas entregas</h2><div class="stack">${next.map(card).join('') || '<p class="empty">Todo al día.</p>'}</div></section>
    <section><h2>Carga por editor</h2><div class="card">${editors.map((p) => { const n = open.filter((t) => t.assigned_to === p.id).length; return `<div class="load"><span>${esc(p.name)}</span><div class="bar"><i style="width:${Math.min(100, n * 20)}%"></i></div><b>${n}</b></div>`; }).join('') || '<p class="empty">Aún no hay editores. Invítalos en Equipo.</p>'}</div></section>
  </div>`;
}
function filters() {
  return `<div class="filters">
    <select id="fw" aria-label="Asignado a"><option value="">Todos los editores</option>${S.people.map((p) => `<option value="${p.id}" ${S.filter.who === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}<option value="none" ${S.filter.who === 'none' ? 'selected' : ''}>Sin asignar</option></select>
    <select id="fc" aria-label="Cliente"><option value="">Todos los clientes</option>${S.clients.map((c) => `<option value="${c.id}" ${S.filter.client === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
  </div>`;
}
function vTareas() {
  let list = S.tasks;
  if (S.filter.who) list = list.filter((t) => (S.filter.who === 'none' ? !t.assigned_to : t.assigned_to === S.filter.who));
  if (S.filter.client) list = list.filter((t) => t.client_id === S.filter.client);
  const v = S.mode === 'lista' ? listView(list) : S.mode === 'calendario' ? calendar(list) : board(list);
  return `<div class="head"><h1>Tareas</h1><button class="btn primary" data-new>+ Nueva tarea</button></div>
  <div class="bar2"><div class="seg">${['tablero', 'lista', 'calendario'].map((m) => `<button data-mode="${m}" class="${S.mode === m ? 'on' : ''}">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div>${filters()}</div>${v}`;
}
function vMis() {
  const mine = S.tasks.filter((t) => t.assigned_to === S.me.id);
  const sorted = [...mine].sort((a, b) => (a.status === 'listo') - (b.status === 'listo') || ((a.due || '9') < (b.due || '9') ? -1 : 1));
  return `<h1>Mis encargos</h1><p class="muted">${isAdmin() ? 'Lo que tienes asignado a ti.' : 'Solo ves lo que un administrador te ha asignado.'}</p>
  <div class="stack wide">${sorted.map(card).join('') || '<p class="empty big">No tienes encargos ahora mismo.</p>'}</div>`;
}
function vClientes() {
  return `<div class="head"><h1>Clientes</h1><button class="btn primary" data-newclient>+ Nuevo cliente</button></div>
  <div class="grid">${S.clients.map((c) => { const n = S.tasks.filter((t) => t.client_id === c.id && t.status !== 'listo').length; return `<article class="card client" data-client="${c.id}" tabindex="0"><span class="chip">${c.kind === 'recurrente' ? 'Recurrente' : 'Puntual'}</span><h3>${esc(c.name)}</h3><p class="muted">${n} tareas abiertas</p></article>`; }).join('') || '<p class="empty big">Añade tu primer cliente.</p>'}</div>`;
}
function vIdeas() {
  const f = S.ifilter; const q = f.q.trim().toLowerCase();
  const list = S.ideas.filter((i) => (!f.client || (f.client === 'none' ? !i.client_id : i.client_id === f.client)) && (!f.status || i.status === f.status) && (!f.owner || (f.owner === 'none' ? !i.owner_id : i.owner_id === f.owner)) && (!q || (i.title + ' ' + i.notes).toLowerCase().includes(q)));
  const people = S.people.filter((p) => p.role !== 'agent');
  const count = (s) => S.ideas.filter((i) => i.status === s).length;
  const card = (i) => `<article class="task idea" data-idea="${i.id}" tabindex="0"><div class="row"><span class="chip">${esc(cname(i.client_id) || 'Sin cliente')}</span><span class="chip">${IDEA_FMT[i.format]}</span><span class="grip" title="Arrastra para cambiar de estado" aria-hidden="true">⋮⋮</span></div>
    <h4>${esc(i.title)}</h4>${i.notes ? `<p class="muted clamp">${esc(i.notes)}</p>` : ''}
    <div class="imeta"><span>Responsable: <b>${esc(pname(i.owner_id))}</b></span><span>Propone: ${esc(pname(i.proposed_by))}</span><span>${IDEA_KIND[i.kind]}</span></div>
    <div class="irow">${safeUrl(i.reference_url) ? `<a href="${esc(i.reference_url)}" target="_blank" rel="noopener noreferrer" data-link>Referencia</a>` : '<span></span>'}
    <select data-istatus="${i.id}" class="ist is-${i.status}" aria-label="Estado">${opts(IDEA_ST, i.status)}</select></div></article>`;
  const ideaBoard = `<div class="board iboard" data-kind="idea">${Object.entries(IDEA_ST).map(([k, l]) => { const col = list.filter((i) => i.status === k); return `<section class="col" data-status="${k}"><h3>${l}<b>${col.length}</b></h3>${col.map(card).join('') || '<p class="empty">Nada aquí</p>'}</section>`; }).join('')}</div>`;
  return `<div class="head"><h1>Ideas</h1><button class="btn primary" data-newidea>+ Nueva idea</button></div>
  <div class="bar2 ibar"><input id="iq" type="search" placeholder="Buscar idea…" value="${esc(f.q)}">
    <select id="ic"><option value="">Todos los clientes</option><option value="none">Sin cliente</option>${S.clients.map((c) => `<option value="${c.id}" ${f.client === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <select id="is"><option value="">Todos los estados</option>${opts(IDEA_ST, f.status)}</select>
    <select id="io"><option value="">Todos los responsables</option><option value="none">Sin responsable</option>${people.map((p) => `<option value="${p.id}" ${f.owner === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
  ${ideaBoard}`;
}
function openIdea(id) {
  const i = id ? S.ideas.find((x) => x.id === id) : null;
  const people = S.people.filter((p) => p.role !== 'agent');
  const m = modal(`<form id="if"><div class="head"><h2>${i ? 'Editar idea' : 'Nueva idea'}</h2><button type="button" class="btn ghost sm" data-close>Cerrar</button></div>
    <label>Idea<input name="title" required value="${esc(i?.title)}" placeholder="Ej: meme del lunes con la plantilla del momento"></label>
    <div class="cols"><label>Cliente<select name="client_id"><option value="">Sin cliente</option>${S.clients.map((c) => `<option value="${c.id}" ${i?.client_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label>Tipo<select name="kind">${opts(IDEA_KIND, i?.kind || 'viral')}</select></label>
    <label>Formato<select name="format">${opts(IDEA_FMT, i?.format || 'reel')}</select></label></div>
    <div class="cols"><label>Estado<select name="status">${opts(IDEA_ST, i?.status || 'nueva')}</select></label>
    <label>Responsable<select name="owner_id"><option value="">Sin responsable</option>${people.map((p) => `<option value="${p.id}" ${(i ? i.owner_id : '') === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <label>Quién la propone<select name="proposed_by">${people.map((p) => `<option value="${p.id}" ${(i ? i.proposed_by : S.me.id) === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
    <label>Enlace de referencia<input name="reference_url" type="url" value="${esc(i?.reference_url)}" placeholder="https://"></label>
    <label>Notas (guion, copy, cómo se haría)<textarea name="notes" rows="5">${esc(i?.notes)}</textarea></label>
    <p class="muted small">No guardes aquí contraseñas ni datos de dinero.</p>
    <div class="actions">${i ? '<span><button type="button" class="btn danger" id="idel">Eliminar</button> <button type="button" class="btn ghost" id="itask">Pasar a tarea</button></span>' : '<span></span>'}<button class="btn primary">Guardar</button></div></form>`);
  const done = async (msg) => { await refresh(); m.remove(); render(); toast(msg); };
  $('#if', m).onsubmit = (e) => { e.preventDefault(); guard(async () => { const f = new FormData(e.target);
    const row = { title: f.get('title').trim(), client_id: f.get('client_id') || null, kind: f.get('kind'), format: f.get('format'), status: f.get('status'), owner_id: f.get('owner_id') || null, proposed_by: f.get('proposed_by') || S.me.id, reference_url: f.get('reference_url').trim(), notes: f.get('notes') };
    await api.saveIdea(i?.id, row); await done('Idea guardada'); }); };
  const del = $('#idel', m); if (del) del.onclick = () => { if (confirm('¿Eliminar esta idea?')) guard(async () => { await api.deleteIdea(i.id); await done('Idea eliminada'); }); };
  const tk = $('#itask', m); if (tk) tk.onclick = () => guard(async () => {
    if (i.task_id) return toast('Esta idea ya tiene tarea.');
    const tid = await api.createTask({ title: i.title, client_id: i.client_id, assigned_to: i.owner_id, brief: i.notes || '', reference_url: i.reference_url || '', created_by: S.me.id });
    await api.saveIdea(i.id, { task_id: tid, status: 'en_produccion' }); await done('Tarea creada y la idea pasa a En producción'); });
}
function vEquipo() {
  return `<h1>Equipo</h1>
  <section><h2>Invitar a alguien</h2>
  <form class="card inline" id="inv"><input name="name" placeholder="Nombre" required><input name="email" type="email" placeholder="Correo" required>
  <select name="role"><option value="editor">Editor</option><option value="admin">Administrador</option><option value="agent">Cuenta de servicio (Instinct)</option></select><button class="btn primary">Invitar</button></form>
  <p class="muted small">La persona crea su cuenta con ese correo. Hasta que no la crea, aparece como pendiente.</p></section>
  <section><h2>Copia de seguridad</h2><div class="card inline2"><p class="muted small">Descarga todo (tareas, ideas, clientes, entregas, comentarios y actividad) en un archivo. Además, la base de datos guarda una copia automática cada noche durante 14 días. El archivo no incluye contraseñas, pero sí datos de clientes: guárdalo en un sitio privado.</p><button class="btn" id="exp">Descargar copia (JSON)</button></div></section>
  <section><h2>Personas</h2><div class="card" id="plist">Cargando…</div></section>`;
}
async function loadEquipo() {
  const [profiles, invites] = await Promise.all([api.profiles(), api.invites()]);
  const registered = new Set(profiles.map((p) => p.email));
  const pend = invites.filter((i) => !registered.has(i.email));
  $('#plist').innerHTML = profiles.map((p) => `<div class="person"><div><b>${esc(p.name)}</b><small>${esc(p.email)}</small></div>
    <span class="chip ${p.role === 'admin' ? 'ok' : ''}">${{ admin: 'Administrador', editor: 'Editor', agent: 'Servicio' }[p.role]}</span>
    ${p.id === S.me.id ? '<span class="muted small">Tú</span>' : `<button class="btn ghost sm" data-role="${p.id}|${p.role === 'admin' ? 'editor' : 'admin'}" ${p.role === 'agent' ? 'hidden' : ''}>${p.role === 'admin' ? 'Pasar a editor' : 'Hacer admin'}</button><button class="btn ghost sm" data-active="${p.id}|${p.active ? 0 : 1}">${p.active ? 'Desactivar' : 'Reactivar'}</button>`}</div>`).join('')
    + pend.map((i) => `<div class="person"><div><b>${esc(i.name)}</b><small>${esc(i.email)}</small></div><span class="chip">Pendiente</span><button class="btn ghost sm" data-rminv="${esc(i.email)}">Quitar</button></div>`).join('');
}

// ---------- Modal ----------
function modal(html) { const m = document.createElement('div'); m.className = 'overlay'; m.innerHTML = `<div class="modal card" role="dialog" aria-modal="true">${html}</div>`; document.body.appendChild(m); m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) m.remove(); }); return m; }
const opts = (obj, sel) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${l}</option>`).join('');

async function openTask(id) {
  const t = id ? S.tasks.find((x) => x.id === id) : null;
  if (!t && !isAdmin()) return;
  const admin = isAdmin();
  const [comments, deliveries, pay] = t ? await Promise.all([api.comments(t.id).catch(() => []), api.deliveries(t.id).catch(() => []), api.pay(t.id).catch(() => null)]) : [[], [], null];
  const when = (d) => new Date(d).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid' });
  const cm = comments.map((c) => `<div class="cm"><b>${esc(pname(c.author))}</b> <small>${when(c.created_at)}</small>${c.for_client ? ' <span class="chip ok">Para cliente</span>' : ''}<p>${esc(c.body)}</p></div>`).join('');
  const dl = deliveries.map((d) => `<div class="cm"><b>${esc(d.label || 'v' + d.version)}</b> <small>${when(d.created_at)}</small> ${admin ? `<label class="check inl"><input type="checkbox" data-dvis="${d.id}" ${d.client_visible ? 'checked' : ''}> visible para cliente</label>` : ''}<p>${safeUrl(d.url) ? `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.url)}</a>` : esc(d.url)}</p>${d.note ? `<p class="muted">${esc(d.note)}</p>` : ''}
    ${admin ? `<input data-dfb="${d.id}" placeholder="Feedback para el editor" value="${esc(d.feedback)}">` : d.feedback ? `<p class="note">Feedback: ${esc(d.feedback)}</p>` : ''}</div>`).join('');
  const ro = (label, v) => `<div class="ro"><span>${label}</span><div>${v}</div></div>`;
  const lnk = (u) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : '<em>Sin enlace</em>');
  const approval = t?.approved ? `<p class="note">Aprobado${t.approved_by ? ' por ' + esc(pname(t.approved_by)) : ''}${t.approved_at ? ' el ' + when(t.approved_at) : ''}.</p>` : '';
  const m = modal(admin ? `
    <form id="tf"><div class="head"><h2>${t ? 'Editar tarea' : 'Nueva tarea'}</h2><button type="button" class="btn ghost sm" data-close>Cerrar</button></div>
      <label>Título<input name="title" required value="${esc(t?.title)}"></label>
      <div class="cols"><label>Cliente<select name="client_id"><option value="">Sin cliente</option>${S.clients.map((c) => `<option value="${c.id}" ${t?.client_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label>Asignado a<select name="assigned_to"><option value="">Sin asignar</option>${S.people.filter((p) => p.role !== 'agent').map((p) => `<option value="${p.id}" ${t?.assigned_to === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label></div>
      <div class="cols"><label>Estado<select name="status">${opts(STATUS, t?.status || 'pendiente')}</select></label>
      <label>Prioridad<select name="priority">${opts(PRIO, t?.priority || 'media')}</select></label>
      <label>Fecha límite<input type="date" name="due" value="${t?.due || ''}"></label></div>
      <label>Brief interno<textarea name="brief" rows="4">${esc(t?.brief)}</textarea></label>
      <label>Brief para el cliente (lo que verá en su portal)<textarea name="client_brief" rows="2">${esc(t?.client_brief)}</textarea></label>
      <div class="cols"><label>Enlace al bruto<input name="raw_url" type="url" value="${esc(t?.raw_url)}" placeholder="https://"></label>
      <label>Referencia<input name="reference_url" type="url" value="${esc(t?.reference_url)}" placeholder="https://"></label></div>
      <label>Etiquetas (separadas por coma)<input name="tags" value="${esc((t?.tags || []).join(', '))}"></label>
      <div class="cols"><label>Pago al editor (€)<input name="pay_amount" type="number" step="0.01" min="0" value="${pay ? pay.amount : ''}"></label>
      <label>Estado del pago<select name="pay_status"><option value="pendiente" ${pay?.status !== 'pagado' ? 'selected' : ''}>Pendiente</option><option value="pagado" ${pay?.status === 'pagado' ? 'selected' : ''}>Pagado</option></select></label></div>
      <label class="check"><input type="checkbox" name="approved" ${t?.approved ? 'checked' : ''}> Vídeo aprobado</label>
      <label class="check"><input type="checkbox" name="client_visible" ${t?.client_visible ? 'checked' : ''}> Visible para el cliente (portal)</label>
      ${approval}
      ${t ? `<h3>Entregas</h3>${dl || '<p class="empty">Sin entregas.</p>'}<h3>Comentarios</h3>${cm || '<p class="empty">Sin comentarios.</p>'}<div class="cminput"><input id="cin" placeholder="Escribe un comentario"><button type="button" class="btn ghost sm" id="cadd">Enviar</button></div><label class="check"><input type="checkbox" id="cfc"> Visible para el cliente</label>` : ''}
      <div class="actions">${t ? '<button type="button" class="btn danger" id="del">Eliminar</button>' : '<span></span>'}<button class="btn primary">Guardar</button></div></form>`
  : `<div><div class="head"><h2>${esc(t.title)}</h2><button class="btn ghost sm" data-close>Cerrar</button></div>
      ${ro('Cliente', esc(cname(t.client_id)) || '<em>Sin cliente</em>')}${ro('Fecha límite', fmt(t.due))}${ro('Prioridad', PRIO[t.priority])}${ro('Estado', STATUS[t.status] + (t.round ? ` (ronda de correcciones ${t.round})` : ''))}
      ${ro('Brief', esc(t.brief).replace(/\n/g, '<br>') || '<em>Sin brief</em>')}${ro('Material en bruto', lnk(t.raw_url))}${ro('Referencia', lnk(t.reference_url))}
      ${pay ? ro('Pago', `${Number(pay.amount).toFixed(2)} € · ${pay.status === 'pagado' ? 'pagado' : 'pendiente'}`) : ''}
      ${t.status === 'listo' ? '<p class="note">Esta tarea ya está aprobada y cerrada por un administrador.</p>' : `<form id="ef"><label>Estado<select name="status">${opts({ pendiente: 'Pendiente', en_proceso: 'En proceso', revision: 'Enviar a revisión' }, ['listo', 'correcciones'].includes(t.status) ? 'en_proceso' : t.status)}</select></label>
      <div class="actions"><span></span><button class="btn primary">Guardar estado</button></div></form>
      <h3>Subir entrega</h3><form id="df"><label>Enlace al vídeo (Drive, Dropbox, etc.)<input name="url" type="url" required placeholder="https://"></label><label>Nota<input name="note" placeholder="Qué cambia respecto a la versión anterior"></label><div class="actions"><span></span><button class="btn primary">Subir entrega</button></div></form>`}
      <h3>Entregas</h3>${dl || '<p class="empty">Aún no hay entregas.</p>'}
      <h3>Comentarios</h3>${cm || '<p class="empty">Sin comentarios.</p>'}<div class="cminput"><input id="cin" placeholder="Escribe un comentario"><button class="btn ghost sm" id="cadd">Enviar</button></div></div>`);
  const reload = async () => { await refresh(); m.remove(); render(); if (S.view === 'equipo') loadEquipo(); };
  const add = $('#cadd', m);
  if (add) add.onclick = () => guard(async () => { const v = $('#cin', m).value.trim(); if (!v) return; await api.addComment(t.id, S.me.id, v, admin && $('#cfc', m)?.checked); m.remove(); openTask(t.id); });
  m.addEventListener('change', (e) => { const v = e.target.dataset?.dvis; if (v) guard(async () => { await api.setDelivery(v, { client_visible: e.target.checked }); toast('Guardado'); }); const f = e.target.dataset?.dfb; if (f) guard(async () => { await api.setDelivery(f, { feedback: e.target.value }); toast('Feedback guardado'); }); });
  const tf = $('#tf', m);
  if (tf) {
    tf.onsubmit = (e) => { e.preventDefault(); guard(async () => {
      const f = new FormData(tf);
      const row = { title: f.get('title').trim(), client_id: f.get('client_id') || null, assigned_to: f.get('assigned_to') || null, status: f.get('status'), priority: f.get('priority'), due: f.get('due') || null, brief: f.get('brief'), client_brief: f.get('client_brief'), raw_url: f.get('raw_url'), reference_url: f.get('reference_url'), tags: f.get('tags').split(',').map((x) => x.trim()).filter(Boolean), approved: f.get('approved') === 'on', client_visible: f.get('client_visible') === 'on' };
      let tid = t?.id;
      if (t) await api.updateTask(t.id, row); else { tid = await api.createTask({ ...row, created_by: S.me.id }); }
      if (f.get('pay_amount') !== '' && tid) await api.savePay(tid, { amount: Number(f.get('pay_amount')), status: f.get('pay_status'), paid_at: f.get('pay_status') === 'pagado' ? today() : null });
      await reload(); toast('Guardado');
    }); };
    const del = $('#del', m); if (del) del.onclick = () => { if (confirm('¿Eliminar esta tarea?')) guard(async () => { await api.deleteTask(t.id); await reload(); toast('Eliminada'); }); };
  }
  const ef = $('#ef', m);
  if (ef) ef.onsubmit = (e) => { e.preventDefault(); guard(async () => { await api.editorStatus(t.id, new FormData(ef).get('status')); await reload(); toast('Guardado'); }); };
  const df = $('#df', m);
  if (df) df.onsubmit = (e) => { e.preventDefault(); guard(async () => { const f = new FormData(df); await api.addDelivery(t.id, f.get('url'), f.get('note'), S.me.id); m.remove(); openTask(t.id); toast('Entrega subida'); }); };
}

async function openClient(id) {
  const c = S.clients.find((x) => x.id === id); const p = await api.clientPrivate(id).catch(() => ({ billing: {} })); const bl = p.billing || {};
  const ST = { prospecto: 'Prospecto', activo: 'Activo', pausado: 'Pausado', cerrado: 'Cerrado' };
  const m = modal(`<form id="cpf"><div class="head"><h2>${esc(c.name)}</h2><button type="button" class="btn ghost sm" data-close>Cerrar</button></div>
    <p class="note">Datos privados: solo administradores. Nunca guardes contraseñas de redes de clientes aquí.</p>
    <div class="cols"><label>Estado<select name="status">${opts(ST, p.status || 'activo')}</select></label><label>Origen<input name="origin" value="${esc(p.origin)}" placeholder="Cómo llegó"></label><label>Cliente desde<input type="date" name="since" value="${esc(p.since)}"></label></div>
    <div class="cols"><label>Contacto<input name="contact_name" value="${esc(p.contact_name)}"></label><label>Correo<input name="contact_email" type="email" value="${esc(p.contact_email)}"></label><label>Teléfono<input name="contact_phone" value="${esc(p.contact_phone)}"></label></div>
    <h3>Condiciones</h3><div class="cols"><label>Tarifa<input name="rate" value="${esc(p.rate)}" placeholder="p. ej. 500 €/mes"></label><label>Rondas de correcciones<input name="rounds" type="number" min="0" value="${p.rounds ?? 2}"></label><label>Plazo (días)<input name="deadline_days" type="number" min="0" value="${p.deadline_days ?? 5}"></label></div>
    <label>Forma de pago<input name="payment_terms" value="${esc(p.payment_terms)}"></label>
    <div class="cols"><label>Contrato (enlace)<input name="contract_url" type="url" value="${esc(p.contract_url)}"></label><label>Carpeta de Drive<input name="drive_url" type="url" value="${esc(p.drive_url)}"></label></div>
    <label>Redes (enlaces a perfiles)<textarea name="socials" rows="2">${esc(p.socials)}</textarea></label>
    <h3>Facturación</h3><div class="cols"><label>Razón social<input name="legal_name" value="${esc(bl.legal_name)}"></label><label>NIF/CIF<input name="tax_id" value="${esc(bl.tax_id)}"></label></div>
    <div class="cols"><label>Dirección fiscal<input name="address" value="${esc(bl.address)}"></label><label>Correo de facturación<input name="billing_email" type="email" value="${esc(bl.billing_email)}"></label></div>
    <label>Notas<textarea name="notes" rows="4">${esc(p.notes)}</textarea></label>
    <h3>Tareas</h3>${S.tasks.filter((t) => t.client_id === id).map((t) => `<p><span class="chip s-${t.status}">${STATUS[t.status]}</span> ${esc(t.title)}</p>`).join('') || '<p class="empty">Sin tareas.</p>'}
    <div class="actions"><button type="button" class="btn danger" id="dc">Eliminar cliente</button><button class="btn primary">Guardar</button></div></form>`);
  $('#cpf', m).onsubmit = (e) => { e.preventDefault(); guard(async () => { const f = Object.fromEntries(new FormData(e.target)); const num = (x) => (x === '' ? null : Number(x));
    await api.saveClientPrivate(id, { status: f.status, origin: f.origin, since: f.since || null, contact_name: f.contact_name, contact_email: f.contact_email, contact_phone: f.contact_phone, rate: f.rate, rounds: num(f.rounds), deadline_days: num(f.deadline_days), payment_terms: f.payment_terms, contract_url: f.contract_url, drive_url: f.drive_url, socials: f.socials, notes: f.notes }, { legal_name: f.legal_name, tax_id: f.tax_id, address: f.address, billing_email: f.billing_email }); toast('Guardado'); }); };
  $('#dc', m).onclick = () => { if (confirm('¿Eliminar este cliente? Sus tareas quedan sin cliente.')) guard(async () => { await api.deleteClient(id); await refresh(); m.remove(); render(); }); };
}
function newClient() {
  const m = modal(`<form id="cf"><div class="head"><h2>Nuevo cliente</h2><button type="button" class="btn ghost sm" data-close>Cerrar</button></div>
    <label>Nombre<input name="name" required></label><label>Tipo<select name="kind"><option value="recurrente">Recurrente</option><option value="puntual">Puntual</option></select></label>
    <div class="actions"><span></span><button class="btn primary">Crear</button></div></form>`);
  $('#cf', m).onsubmit = (e) => { e.preventDefault(); guard(async () => { const f = new FormData(e.target); await api.createClient({ name: f.get('name').trim(), kind: f.get('kind') }); await refresh(); m.remove(); render(); }); };
}

// ---------- Events ----------
function bind() {
  const main = $('#main');
  main.onclick = (e) => {
    if (S.dragged) return;
    if (e.target.closest('[data-link]') || e.target.closest('[data-istatus]')) return;
    if (e.target.closest('[data-newidea]')) return openIdea(null);
    const id = e.target.closest('[data-idea]'); if (id) return openIdea(id.dataset.idea);
    const o = e.target.closest('[data-open]'); if (o) return openTask(o.dataset.open);
    if (e.target.closest('[data-new]')) return openTask(null);
    if (e.target.closest('[data-newclient]')) return newClient();
    const c = e.target.closest('[data-client]'); if (c) return openClient(c.dataset.client);
    const md = e.target.closest('[data-mode]'); if (md) { S.mode = md.dataset.mode; return render(); }
    const r = e.target.closest('[data-role]'); if (r) { const [id, role] = r.dataset.role.split('|'); return guard(async () => { await api.setProfile(id, { role }); await refresh(); loadEquipo(); }); }
    const a = e.target.closest('[data-active]'); if (a) { const [id, v] = a.dataset.active.split('|'); return guard(async () => { await api.setProfile(id, { active: v === '1' }); loadEquipo(); }); }
    const ri = e.target.closest('[data-rminv]'); if (ri) return guard(async () => { await api.removeInvite(ri.dataset.rminv); loadEquipo(); });
  };
  main.onkeydown = (e) => { if (e.key === 'Enter') { const idc = e.target.closest('[data-idea]'); if (idc) openIdea(idc.dataset.idea); const o = e.target.closest('[data-open]'); if (o) openTask(o.dataset.open); const c = e.target.closest('[data-client]'); if (c) openClient(c.dataset.client); } };
  main.onchange = (e) => {
    const is = e.target.dataset?.istatus; if (is) return guard(async () => { await api.saveIdea(is, { status: e.target.value }); await refresh(); render(); toast('Estado guardado'); });
    if (e.target.id === 'ic') { S.ifilter.client = e.target.value; return render(); } if (e.target.id === 'is') { S.ifilter.status = e.target.value; return render(); } if (e.target.id === 'io') { S.ifilter.owner = e.target.value; return render(); } if (e.target.id === 'fw') { S.filter.who = e.target.value; render(); } if (e.target.id === 'fc') { S.filter.client = e.target.value; render(); } };
  const iq = $('#iq'); if (iq) iq.oninput = () => { S.ifilter.q = iq.value; const pos = iq.selectionStart; render(); const n = $('#iq'); n.focus(); n.setSelectionRange(pos, pos); };
  const ex = $('#exp'); if (ex) ex.onclick = () => guard(async () => { const d = await api.exportAll(); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' })); a.download = 'sala-copia-' + today() + '.json'; document.body.appendChild(a); a.click(); a.remove(); toast('Copia descargada'); });
  const inv = $('#inv'); if (inv) inv.onsubmit = (e) => { e.preventDefault(); guard(async () => { const f = new FormData(inv); await api.addInvite({ name: f.get('name').trim(), email: f.get('email').trim(), role: f.get('role') }); inv.reset(); toast('Invitación creada'); loadEquipo(); }); };
  if (S.view === 'equipo') loadEquipo();
  enableDrag();
}

// Arrastrar tarjetas entre columnas (ratón y dedo; en móvil, mantén pulsado un momento)
function enableDrag() { document.querySelectorAll('.board').forEach(dragBoard); }
function dragBoard(board) {
  const isIdea = board.dataset.kind === 'idea';
  let st = null;
  const colAt = (x, y) => document.elementFromPoint(x, y)?.closest('.col');
  const clear = () => document.querySelectorAll('.col.over').forEach((c) => c.classList.remove('over'));
  const begin = (e) => {
    st.on = true; const r = st.card.getBoundingClientRect();
    st.ghost = st.card.cloneNode(true); st.ghost.className += ' ghost';
    st.ghost.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;pointer-events:none;z-index:50`;
    st.dx = e.clientX - r.left; st.dy = e.clientY - r.top;
    document.body.appendChild(st.ghost); st.card.classList.add('dragging');
    board.style.scrollSnapType = 'none';
    st.lx = e.clientX; st.ly = e.clientY;
    st.auto = setInterval(() => {
      const br = board.getBoundingClientRect();
      const dx = st.lx > br.right - 50 ? 12 : st.lx < br.left + 50 ? -12 : 0;
      const dy = st.ly > innerHeight - 70 ? 14 : st.ly < (document.querySelector('.top')?.getBoundingClientRect().bottom || 0) + 24 ? -14 : 0;
      if (dx) board.scrollLeft += dx; if (dy) scrollBy(0, dy);
      if (dx || dy) { clear(); colAt(st.lx, st.ly)?.classList.add('over'); }
    }, 16);
    try { board.setPointerCapture(st.id); } catch (_) {}
  };
  const move = (e) => {
    if (!st || e.pointerId !== st.id) return;
    if (!st.on) {
      const d = Math.hypot(e.clientX - st.x, e.clientY - st.y);
      if (e.pointerType === 'mouse' && d > 6) begin(e);
      else if (e.pointerType !== 'mouse' && d > 10 && !st.timerDone) { clearTimeout(st.timer); st = null; return; }
      if (!st || !st.on) return;
    }
    e.preventDefault();
    st.ghost.style.left = e.clientX - st.dx + 'px'; st.ghost.style.top = e.clientY - st.dy + 'px';
    clear(); colAt(e.clientX, e.clientY)?.classList.add('over');
    st.lx = e.clientX; st.ly = e.clientY;
  };
  const end = async (e) => {
    if (!st || e.pointerId !== st.id) return;
    clearTimeout(st.timer); clearInterval(st.auto); board.style.scrollSnapType = ''; const s = st; st = null;
    if (!s.on) return;
    s.ghost.remove(); s.card.classList.remove('dragging'); clear();
    S.dragged = true; setTimeout(() => { S.dragged = false; }, 50);
    const col = e.type === 'pointercancel' ? null : colAt(e.clientX, e.clientY);
    const to = col?.dataset.status; if (!to) return;
    if (isIdea) {
      const i = S.ideas.find((x) => x.id === s.card.dataset.idea); if (!i || i.status === to) return;
      return guard(async () => { try { await api.saveIdea(i.id, { status: to }); toast('Idea movida a ' + IDEA_ST[to]); } finally { await refresh(); render(); } });
    }
    const t = S.tasks.find((x) => x.id === s.card.dataset.open); if (!t || t.status === to) return;
    guard(async () => {
      try { if (isAdmin()) await api.updateTask(t.id, { status: to }); else await api.editorStatus(t.id, to); toast('Movida a ' + STATUS[to]); }
      finally { await refresh(); render(); }
    });
  };
  board.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.task'); if (!card || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest('select,a,input,button')) return;
    st = { id: e.pointerId, card, x: e.clientX, y: e.clientY, on: false, timerDone: false };
    if (e.target.closest('.grip')) { st.timerDone = true; e.preventDefault(); begin(e); return; }
    if (e.pointerType !== 'mouse') st.timer = setTimeout(() => { if (st) { st.timerDone = true; navigator.vibrate?.(15); begin(e); } }, 350);
  });
  board.addEventListener('pointermove', move); board.addEventListener('pointerup', end); board.addEventListener('pointercancel', end);
  board.addEventListener('touchmove', (e) => { if (st?.on) e.preventDefault(); }, { passive: false });
  board.addEventListener('contextmenu', (e) => { if (e.target.closest('.task')) e.preventDefault(); });
  board.addEventListener('dragstart', (e) => e.preventDefault());
}

boot().catch((e) => { console.error(e); renderLogin('No se pudo conectar. Recarga la página.'); });
