import { createClient } from '@supabase/supabase-js';
import cfg from './config.js';

export const DEMO = !cfg.url || !cfg.anonKey;
const sb = DEMO ? null : createClient(cfg.url, cfg.anonKey);

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

// ---------- Supabase ----------
const real = {
  async me() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;
    const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
    if (error) return null;
    return data;
  },
  async signIn(email, password) {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error('Correo o contraseña incorrectos.');
  },
  async signUp(email, password) {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(error.message.includes('invitado') ? error.message : 'No se pudo crear la cuenta. ¿Te ha invitado un administrador con este correo?');
    if (!data.session) await this.signIn(email, password);
  },
  signOut: () => sb.auth.signOut(),
  async tasks() { const { data, error } = await sb.from('tasks').select('*').order('due', { nullsFirst: false }); if (error) throw error; return data; },
  async createTask(t) { const { data, error } = await sb.from('tasks').insert(t).select('id').single(); if (error) throw error; return data.id; },
  async updateTask(id, patch) { const { error } = await sb.from('tasks').update(patch).eq('id', id); if (error) throw error; },
  async deleteTask(id) { const { error } = await sb.from('tasks').delete().eq('id', id); if (error) throw error; },
  async editorStatus(id, status) { const { error } = await sb.rpc('editor_set_status', { p_id: id, p_status: status }); if (error) throw new Error(error.message); },
  async deliveries(taskId) { const { data, error } = await sb.from('deliveries').select('*').eq('task_id', taskId).order('version'); if (error) throw error; return data; },
  async addDelivery(taskId, url, note, uid) { const { error } = await sb.from('deliveries').insert({ task_id: taskId, version: 0, url, note, created_by: uid }); if (error) throw error; },
  async setDelivery(id, patch) { const { error } = await sb.from('deliveries').update(patch).eq('id', id); if (error) throw error; },
  async pay(taskId) { const { data } = await sb.from('task_pay').select('*').eq('task_id', taskId).maybeSingle(); return data; },
  async savePay(taskId, p) { const { error } = await sb.from('task_pay').upsert({ task_id: taskId, ...p }); if (error) throw error; },
  async clients() { const { data, error } = await sb.from('clients').select('*').order('name'); if (error) throw error; return data; },
  async createClient(c) { const { error } = await sb.from('clients').insert(c); if (error) throw error; },
  async deleteClient(id) { const { error } = await sb.from('clients').delete().eq('id', id); if (error) throw error; },
  async clientPrivate(id) { const [p, b] = await Promise.all([sb.from('client_private').select('*').eq('client_id', id).maybeSingle(), sb.from('client_billing').select('*').eq('client_id', id).maybeSingle()]); return { ...(p.data || {}), billing: b.data || {} }; },
  async saveClientPrivate(id, priv, billing) { const a = await sb.from('client_private').upsert({ client_id: id, ...priv }); if (a.error) throw a.error; const b = await sb.from('client_billing').upsert({ client_id: id, ...billing }); if (b.error) throw b.error; },
  async calUrl() { const { data, error } = await sb.rpc('my_calendar_token'); if (error) throw error; return cfg.url + '/functions/v1/ical?t=' + data; },
  async people() { const { data, error } = await sb.rpc('people'); if (error) throw error; return data; },
  async invites() { const { data, error } = await sb.from('invites').select('*').order('created_at'); if (error) throw error; return data; },
  async addInvite(i) { const { error } = await sb.from('invites').upsert({ ...i, email: i.email.toLowerCase() }); if (error) throw error; },
  async removeInvite(email) { const { error } = await sb.from('invites').delete().eq('email', email); if (error) throw error; },
  async profiles() { const { data, error } = await sb.from('profiles').select('*').order('created_at'); if (error) throw error; return data; },
  async setProfile(id, patch) { const { error } = await sb.from('profiles').update(patch).eq('id', id); if (error) throw error; },
  async comments(taskId) { const { data, error } = await sb.from('task_comments').select('*').eq('task_id', taskId).order('created_at'); if (error) throw error; return data; },
  async addComment(taskId, author, body, forClient = false) { const { error } = await sb.from('task_comments').insert({ task_id: taskId, author, body, for_client: forClient }); if (error) throw error; },
};

// ---------- Demo (sin backend, solo para vista previa) ----------
const KEY = 'sala-demo-v1';
function seed() {
  const a = { id: 'u-admin', email: 'admin@demo.test', name: 'Samuel', role: 'admin', active: true };
  const t = { id: 'u-tellez', email: 'tellez@demo.test', name: 'Tellez', role: 'admin', active: true };
  const e1 = { id: 'u-lucia', email: 'lucia@demo.test', name: 'Lucía (editora)', role: 'editor', active: true };
  const e2 = { id: 'u-marc', email: 'marc@demo.test', name: 'Marc (editor)', role: 'editor', active: true };
  const c1 = { id: 'c1', name: 'Chamartín FC', kind: 'recurrente' };
  const c2 = { id: 'c2', name: 'Black Boys Barber', kind: 'puntual' };
  const c3 = { id: 'c3', name: 'Bravo Spain', kind: 'recurrente' };
  const d = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const mk = (title, client, status, priority, due, who, brief, tags) => ({ id: uid(), title, client_id: client, status, priority, due, assigned_to: who, brief, tags, reference_url: '', raw_url: '', delivery_url: '', approved: status === 'listo', created_by: 'u-admin' });
  return {
    profiles: [a, t, e1, e2], clients: [c1, c2, c3], notes: { c1: 'Equipaciones. Entregas semanales.' },
    invites: [{ email: 'nuevo.editor@demo.test', name: 'Nuevo editor', role: 'editor' }],
    tasks: [
      mk('Reel equipaciones, versión 9:16', 'c1', 'en_proceso', 'alta', d(1), 'u-lucia', 'Corte dinámico de 30 s, música con ritmo, subtítulos palabra a palabra.', ['reel', 'deporte']),
      mk('Vídeo largo barbería', 'c2', 'pendiente', 'media', d(4), 'u-marc', 'Montar entrevista y planos de corte. Referencia en el enlace.', ['largo']),
      mk('Pack de 3 anuncios Meta', 'c3', 'revision', 'alta', d(2), 'u-lucia', 'Tres ganchos distintos para el mismo producto.', ['ads']),
      mk('Subtitulado y corrección de color', 'c1', 'listo', 'baja', d(-1), 'u-marc', 'Entregado y aprobado.', ['post']),
      mk('Guion para vídeo de presentación', 'c3', 'pendiente', 'media', d(6), null, 'Sin asignar todavía.', ['guion']),
    ],
    comments: [],
  };
}
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const save = (s) => localStorage.setItem(KEY, JSON.stringify(s));
function st() { let s = load(); if (!s) { s = seed(); save(s); } return s; }
const demo = {
  async me() { const id = localStorage.getItem(KEY + '-me'); return id ? st().profiles.find((p) => p.id === id) || null : null; },
  async signIn(email) { const p = st().profiles.find((x) => x.email === email.toLowerCase()); if (!p) throw new Error('Correo o contraseña incorrectos.'); localStorage.setItem(KEY + '-me', p.id); },
  async signUp(email) { const s = st(); const inv = s.invites.find((i) => i.email === email.toLowerCase()); if (!inv) throw new Error('Este correo no está invitado. Pide a un administrador que te invite.'); s.profiles.push({ id: uid(), email: inv.email, name: inv.name, role: inv.role, active: true }); save(s); await this.signIn(email); },
  async signOut() { localStorage.removeItem(KEY + '-me'); },
  async tasks() { const s = st(); const me = await this.me(); return s.tasks.filter((t) => me.role === 'admin' || t.assigned_to === me.id); },
  async createTask(t) { const s = st(); const id = uid(); s.tasks.push({ id, approved: false, round: 0, ...t }); save(s); return id; },
  async updateTask(id, p) { const s = st(); Object.assign(s.tasks.find((t) => t.id === id), p); save(s); },
  async deleteTask(id) { const s = st(); s.tasks = s.tasks.filter((t) => t.id !== id); save(s); },
  async editorStatus(id, status) { const s = st(); const t = s.tasks.find((x) => x.id === id); if (!['pendiente', 'en_proceso', 'revision'].includes(status)) throw new Error('Solo un administrador puede marcar una tarea como lista o pedir correcciones.'); t.status = status; save(s); },
  async deliveries(id) { return (st().deliveries || []).filter((d) => d.task_id === id).sort((x, y) => x.version - y.version); },
  async addDelivery(task_id, url, note, uid_) { const s = st(); s.deliveries ||= []; const v = s.deliveries.filter((d) => d.task_id === task_id).length + 1; s.deliveries.push({ id: uid(), task_id, version: v, label: 'v' + v, url, note, feedback: '', created_by: uid_, created_at: new Date().toISOString() }); save(s); },
  async setDelivery(id, p) { const s = st(); Object.assign(s.deliveries.find((d) => d.id === id), p); save(s); },
  async pay(id) { return (st().pay || {})[id] || null; },
  async savePay(id, p) { const s = st(); s.pay ||= {}; s.pay[id] = { task_id: id, ...p }; save(s); },
  async clients() { const s = st(); const me = await this.me(); return me.role === 'admin' ? s.clients : s.clients.filter((c) => s.tasks.some((t) => t.client_id === c.id && t.assigned_to === me.id)); },
  async createClient(c) { const s = st(); s.clients.push({ id: uid(), ...c }); save(s); },
  async deleteClient(id) { const s = st(); s.clients = s.clients.filter((c) => c.id !== id); save(s); },
  async clientPrivate(id) { const s = st(); return { ...((s.cpriv || {})[id] || { status: 'activo', rounds: 2, deadline_days: 5 }), billing: ((s.cbill || {})[id] || {}) }; },
  async saveClientPrivate(id, p, b) { const s = st(); s.cpriv ||= {}; s.cbill ||= {}; s.cpriv[id] = p; s.cbill[id] = b; save(s); },
  async people() { return st().profiles.filter((p) => p.active).map(({ id, name, role }) => ({ id, name, role })); },
  async invites() { return st().invites; },
  async addInvite(i) { const s = st(); s.invites = s.invites.filter((x) => x.email !== i.email.toLowerCase()); s.invites.push({ ...i, email: i.email.toLowerCase() }); save(s); },
  async removeInvite(e) { const s = st(); s.invites = s.invites.filter((x) => x.email !== e); save(s); },
  async profiles() { return st().profiles; },
  async setProfile(id, p) { const s = st(); Object.assign(s.profiles.find((x) => x.id === id), p); save(s); },
  async comments(id) { return st().comments.filter((c) => c.task_id === id); },
  async addComment(task_id, author, body, for_client = false) { const s = st(); s.comments.push({ id: uid(), task_id, author, body, for_client, created_at: new Date().toISOString() }); save(s); },
};

demo.calUrl = async () => 'https://ejemplo.invalid/ical?t=demo';
export const api = DEMO ? demo : real;
