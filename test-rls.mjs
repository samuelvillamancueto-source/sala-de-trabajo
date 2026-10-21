import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated;
`);
await db.exec(fs.readFileSync('supabase/schema.sql', 'utf8'));
const ids = {};
async function signup(key, email) { await db.exec(`reset role; set role postgres`); const r = await db.query(`insert into auth.users(email) values ($1) returning id`, [email]); ids[key] = r.rows[0].id; }
await db.exec(`insert into public.invites(email,name,role) values ('sam@x.es','Samuel','admin'),('tel@x.es','Tellez','admin'),('luc@x.es','Lucia','editor'),('marc@x.es','Marc','editor'),('inst@x.es','Instinct','agent')`);
for (const [k, e] of [['sam','sam@x.es'],['tel','tel@x.es'],['luc','luc@x.es'],['marc','marc@x.es'],['inst','inst@x.es']]) await signup(k, e);
let pass = 0, fail = 0;
const as = async (key) => { await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${ids[key]}',false)`); };
const q = async (key, sql, params) => { await as(key); try { const r = await db.query(sql, params); return { rows: r.rows, n: r.affectedRows }; } catch (e) { return { err: e.message }; } };
const ok = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'OK   ' : 'FAIL ') + name); };
// uninvited signup
try { await db.exec(`reset role; set role postgres`); await db.query(`insert into auth.users(email) values ('intruso@x.es')`); ok('alta sin invitacion rechazada', false); } catch (e) { ok('alta sin invitacion rechazada', /no esta invitado/.test(e.message)); }
// admin setup
await as('sam');
const c1 = (await db.query(`insert into public.clients(name) values ('Chamartin') returning id`)).rows[0].id;
const c2 = (await db.query(`insert into public.clients(name) values ('Bravo') returning id`)).rows[0].id;
await db.query(`insert into public.client_private(client_id,notes,contact_email,rate) values ($1,'secreto','c@x.es','500'),($2,'otro','b@x.es','300')`, [c1, c2]);
await db.query(`insert into public.client_billing(client_id,tax_id) values ($1,'B123')`, [c1]);
const t1 = (await db.query(`insert into public.tasks(title,client_id,assigned_to,created_by) values ('Reel',$1,$2,$3) returning id`, [c1, ids.luc, ids.sam])).rows[0].id;
const t2 = (await db.query(`insert into public.tasks(title,client_id,assigned_to,created_by) values ('Largo',$1,$2,$3) returning id`, [c2, ids.marc, ids.sam])).rows[0].id;
await db.query(`insert into public.task_pay(task_id,amount) values ($1,80),($2,120)`, [t1, t2]);
let r;
// editor Lucia
r = await q('luc', 'select title from public.tasks'); ok('editor solo ve su tarea', r.rows.length === 1 && r.rows[0].title === 'Reel');
r = await q('luc', 'select name from public.clients'); ok('editor solo ve su cliente (nombre)', r.rows.length === 1 && r.rows[0].name === 'Chamartin');
r = await q('luc', 'select * from public.client_private'); ok('editor no ve client_private', r.rows.length === 0);
r = await q('luc', 'select * from public.client_billing'); ok('editor no ve facturacion', r.rows.length === 0);
r = await q('luc', 'select * from public.task_pay'); ok('editor ve solo su pago', r.rows.length === 1 && Number(r.rows[0].amount) === 80);
r = await q('luc', 'select * from public.activity'); ok('editor no ve actividad', r.rows.length === 0);
r = await q('luc', 'select * from public.invites'); ok('editor no ve invitaciones', r.rows.length === 0);
r = await q('luc', 'select email from public.profiles'); ok('editor solo ve su perfil', r.rows.length === 1);
r = await q('luc', `update public.tasks set status='listo', approved=true where id=$1`, [t1]); ok('editor no puede UPDATE directo (0 filas)', !r.err && r.n === 0);
r = await q('luc', `update public.tasks set assigned_to=$2 where id=$1`, [t1, ids.marc]); ok('editor no puede reasignarse/pasar tarea', !r.err && r.n === 0);
r = await q('luc', `update public.profiles set role='admin' where id=$1`, [ids.luc]); ok('editor no puede subirse a admin', !r.err && r.n === 0);
r = await q('luc', `insert into public.invites(email,role) values ('z@x.es','admin')`); ok('editor no puede invitar', !!r.err);
r = await q('luc', `select public.editor_set_status($1,'revision')`, [t1]); ok('editor pasa a revision', !r.err);
r = await q('luc', `select public.editor_set_status($1,'listo')`, [t1]); ok('editor no puede marcar listo (RPC)', /administrador/.test(r.err || ''));
r = await q('luc', `select public.editor_set_status($1,'correcciones')`, [t1]); ok('editor no puede pedir correcciones', !!r.err);
r = await q('luc', `select public.editor_set_status($1,'en_proceso')`, [t2]); ok('editor no toca tarea ajena (RPC)', /no asignada/.test(r.err || ''));
r = await q('luc', `insert into public.deliveries(task_id,version,url,created_by) values ($1,0,'https://v/1',$2)`, [t1, ids.luc]); ok('editor sube entrega v1 en su tarea', !r.err);
r = await q('luc', `insert into public.deliveries(task_id,version,url,created_by) values ($1,0,'https://v/2',$2)`, [t1, ids.luc]);
r = await q('luc', `select version,label from public.deliveries order by version`); ok('versionado automatico v1,v2', r.rows.length === 2 && r.rows[1].label === 'v2');
r = await q('luc', `insert into public.deliveries(task_id,version,url,created_by) values ($1,0,'https://x',$2)`, [t2, ids.luc]); ok('editor no sube entrega a tarea ajena', !!r.err);
r = await q('luc', `insert into public.deliveries(task_id,version,url,created_by,feedback) values ($1,0,'https://x',$2,'ok')`, [t1, ids.luc]); ok('editor no puede escribir feedback', !!r.err);
r = await q('luc', `update public.deliveries set feedback='bien' where task_id=$1`, [t1]); ok('editor no puede editar entregas', !r.err && r.n === 0);
r = await q('luc', `insert into public.task_comments(task_id,author,body) values ($1,$2,'hola')`, [t1, ids.luc]); ok('editor comenta en su tarea', !r.err);
r = await q('luc', `insert into public.task_comments(task_id,author,body) values ($1,$2,'hola')`, [t2, ids.luc]); ok('editor no comenta en ajena', !!r.err);
r = await q('luc', `insert into public.task_comments(task_id,author,body) values ($1,$2,'suplanto')`, [t1, ids.sam]); ok('editor no suplanta autor', !!r.err);
r = await q('luc', `insert into public.task_comments(task_id,author,body,for_client) values ($1,$2,'x',true)`, [t1, ids.luc]); ok('editor no comenta "para cliente"', !!r.err);
// Instinct agent
r = await q('inst', 'select count(*) c from public.tasks'); ok('agent lee todas las tareas', Number(r.rows[0].c) === 2);
r = await q('inst', 'select count(*) c from public.clients'); ok('agent NO ve clientes', Number(r.rows[0].c) === 0);
r = await q('inst', 'select count(*) c from public.client_private'); ok('agent NO ve datos privados', Number(r.rows[0].c) === 0);
r = await q('inst', 'select count(*) c from public.task_pay'); ok('agent NO ve pagos', Number(r.rows[0].c) === 0);
r = await q('inst', 'select count(*) c from public.activity'); ok('agent lee actividad', Number(r.rows[0].c) > 0);
r = await q('inst', `update public.tasks set status='listo'`); ok('agent no escribe tareas', !r.err && r.n === 0);
r = await q('inst', `insert into public.tasks(title) values ('x')`); ok('agent no crea tareas', !!r.err);
r = await q('inst', `delete from public.tasks`); ok('agent no borra tareas', !r.err && r.n === 0);
r = await q('inst', `insert into public.task_comments(task_id,author,body) values ($1,$2,'aviso')`, [t1, ids.inst]); ok('agent comenta', !r.err);
r = await q('inst', `select * from public.invites`); ok('agent no ve invitaciones', r.rows.length === 0);
// Admin
r = await q('tel', 'select count(*) c from public.client_private'); ok('admin ve datos privados', Number(r.rows[0].c) === 2);
r = await q('tel', `update public.tasks set status='listo' where id=$1`, [t1]); ok('admin marca listo', !r.err && r.n === 1);
r = await q('tel', `select approved, approved_by from public.tasks where id=$1`, [t1]); ok('aprobado registra quien', r.rows[0].approved && r.rows[0].approved_by === ids.tel);
r = await q('tel', `update public.tasks set status='correcciones' where id=$1`, [t2]); r = await q('tel', `select round from public.tasks where id=$1`, [t2]); ok('ronda de correcciones sube', r.rows[0].round === 1);
// baja de editor
await q('sam', `update public.profiles set active=false where id=$1`, [ids.marc]);
r = await q('marc', 'select count(*) c from public.tasks'); ok('editor dado de baja no ve nada', Number(r.rows[0].c) === 0);
r = await q('marc', `select public.editor_set_status($1,'en_proceso')`, [t2]); ok('editor de baja no usa RPC', !!r.err);
// portal cliente
await db.exec(`reset role; set role postgres`);
await db.exec(`insert into public.invites(email,name,role,client_id) values ('cli@x.es','Cliente','client','${c1}')`);
await signup('cli', 'cli@x.es');
r = await q('cli', 'select count(*) c from public.tasks'); ok('cliente sin tareas visibles al inicio', Number(r.rows[0].c) === 0);
await q('sam', `update public.tasks set client_visible=true where id=$1`, [t1]);
await q('sam', `insert into public.task_comments(task_id,author,body,for_client) values ($1,$2,'interno',false),($1,$2,'para ti',true)`, [t1, ids.sam]);
await q('sam', `update public.deliveries set client_visible=true where task_id=$1 and version=1`, [t1]);
r = await q('cli', 'select title from public.tasks'); ok('cliente ve solo su tarea visible', r.rows.length === 1 && r.rows[0].title === 'Reel');
r = await q('cli', 'select body from public.task_comments'); ok('cliente ve solo comentarios "para cliente"', r.rows.length === 1 && r.rows[0].body === 'para ti');
r = await q('cli', 'select version from public.deliveries'); ok('cliente ve solo entregas marcadas', r.rows.length === 1 && r.rows[0].version === 1);
r = await q('cli', 'select count(*) c from public.activity'); ok('cliente no ve actividad', Number(r.rows[0].c) === 0);
r = await q('cli', 'select count(*) c from public.client_private'); ok('cliente no ve datos privados', Number(r.rows[0].c) === 0);
r = await q('cli', 'select count(*) c from public.task_pay'); ok('cliente no ve pagos', Number(r.rows[0].c) === 0);
r = await q('cli', 'select * from public.people()'); ok('cliente no ve equipo', r.rows.length === 0);
r = await q('cli', `update public.tasks set status='listo'`); ok('cliente no escribe', !r.err && r.n === 0);
r = await q('cli', 'select count(*) c from public.clients'); ok('cliente ve solo su cliente', Number(r.rows[0].c) === 1);
// anon
await db.exec(`reset role; set role anon`);
try { await db.query('select * from public.tasks'); ok('anon sin acceso', false); } catch (e) { ok('anon sin acceso', true); }
console.log(`\n${pass} ok, ${fail} fallos`);
process.exit(fail ? 1 : 0);
