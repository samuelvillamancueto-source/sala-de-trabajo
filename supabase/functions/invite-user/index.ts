import { createClient } from "npm:@supabase/supabase-js@2";
const SITE = "https://samuelvillamancueto-source.github.io/sala-de-trabajo/";
const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS" };
const out = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "content-type": "application/json" } });
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return out({ error: "Método no permitido" }, 405);
  const url = Deno.env.get("SUPABASE_URL")!;
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer /i, "");
  const sb = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: u } = await sb.auth.getUser(jwt);
  if (!u?.user) return out({ error: "No autenticado" }, 401);
  const { data: me } = await sb.from("profiles").select("role,active").eq("id", u.user.id).maybeSingle();
  if (!me || !me.active || me.role !== "admin") return out({ error: "Solo administradores" }, 403);
  let b: any; try { b = await req.json(); } catch { return out({ error: "JSON no válido" }, 400); }
  const email = String(b.email ?? "").trim().toLowerCase();
  const name = String(b.name ?? "").trim().slice(0, 80);
  const role = String(b.role ?? "");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return out({ error: "Correo no válido" }, 400);
  if (!["admin", "editor", "agent"].includes(role)) return out({ error: "Rol no válido" }, 400);
  const { data: ex } = await sb.from("profiles").select("id").eq("email", email).maybeSingle();
  if (ex) return out({ error: "Ese correo ya tiene cuenta" }, 409);
  const { error: e1 } = await sb.from("invites").upsert({ email, name, role });
  if (e1) return out({ error: "No se pudo guardar la invitación" }, 400);
  const { error: e2 } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo: SITE });
  if (!e2) return out({ ok: true, sent: true });
  // el correo integrado de Supabase tiene límites (pocos envíos por hora); damos un enlace para que el admin lo comparta a mano
  for (const type of ["invite", "recovery"] as const) {
    const { data: g, error: e3 } = await sb.auth.admin.generateLink({ type, email, options: { redirectTo: SITE } } as any);
    if (!e3 && g?.properties?.action_link) return out({ ok: true, sent: false, link: g.properties.action_link });
  }
  return out({ error: "No se pudo enviar el correo ni generar el enlace. Inténtalo más tarde." }, 400);
});
