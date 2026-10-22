import { createClient } from "npm:@supabase/supabase-js@2";
const esc = (s: string) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n|\r/g, "\\n");
const ST: Record<string, string> = { pendiente: "Pendiente", en_proceso: "En proceso", revision: "En revisión", correcciones: "Correcciones", listo: "Listo" };
const fold = (l: string) => { const enc = new TextEncoder(); if (enc.encode(l).length <= 75) return l; const out: string[] = []; let cur = ""; let n = 0; for (const ch of l) { const b = enc.encode(ch).length; if (n + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; n = 0; } cur += ch; n += b; } out.push(cur); return out.join("\r\n "); };
const d8 = (s: string) => s.replaceAll("-", "");
Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Método no permitido", { status: 405 });
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[a-f0-9]{48}$/.test(token)) return new Response("No encontrado", { status: 404 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: tk } = await sb.from("calendar_tokens").select("user_id").eq("token", token).maybeSingle();
  if (!tk || !tk.user_id) return new Response("No encontrado", { status: 404 });
  // el alcance se calcula en vivo con el rol actual; usuarios desactivados o sin rol de equipo no reciben nada
  const { data: pr } = await sb.from("profiles").select("role,active").eq("id", tk.user_id).maybeSingle();
  if (!pr || !pr.active || !["admin", "editor"].includes(pr.role)) return new Response("No encontrado", { status: 404 });
  let q = sb.from("tasks").select("id,title,status,due,priority,assigned_to,also_assigned,updated_at").not("due", "is", null).order("due").limit(2000);
  if (pr.role !== "admin") q = q.eq("is_video", true).or(`assigned_to.eq.${tk.user_id},also_assigned.cs.{${tk.user_id}}`);
  const { data: tasks } = await q;
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sala de Trabajo//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Sala de Trabajo", "X-WR-TIMEZONE:Europe/Madrid", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const t of tasks ?? []) {
    const start = d8(t.due);
    const end = d8(new Date(new Date(t.due + "T00:00:00Z").getTime() + 86400000).toISOString().slice(0, 10));
    const done = t.status === "listo";
    L.push("BEGIN:VEVENT", `UID:${t.id}@sala-de-trabajo`, `DTSTAMP:${new Date(t.updated_at).toISOString().replace(/[-:]|\.\d+/g, "")}`,
      `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${esc((done ? "✓ " : "") + t.title + " [" + (ST[t.status] ?? t.status) + "]")}`,
      `DESCRIPTION:${esc("Prioridad: " + t.priority)}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return new Response(L.map(fold).join("\r\n") + "\r\n", { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" } });
});
