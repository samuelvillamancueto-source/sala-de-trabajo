import { createClient } from "npm:@supabase/supabase-js@2";
const esc = (s: string) => String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const ST: Record<string, string> = { pendiente: "Pendiente", en_proceso: "En proceso", revision: "En revisión", correcciones: "Correcciones", listo: "Listo" };
const d8 = (s: string) => s.replaceAll("-", "");
Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[a-f0-9]{32,64}$/.test(token)) return new Response("No encontrado", { status: 404 });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: tk } = await sb.from("calendar_tokens").select("user_id,scope").eq("token", token).maybeSingle();
  if (!tk) return new Response("No encontrado", { status: 404 });
  let q = sb.from("tasks").select("id,title,status,due,priority,brief,assigned_to,updated_at").not("due", "is", null);
  if (tk.scope !== "all") q = q.eq("assigned_to", tk.user_id);
  const { data: tasks } = await q;
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sala de Trabajo//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Sala de Trabajo", "X-WR-TIMEZONE:Europe/Madrid", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const t of tasks ?? []) {
    const start = d8(t.due);
    const end = d8(new Date(new Date(t.due + "T00:00:00Z").getTime() + 86400000).toISOString().slice(0, 10));
    const done = t.status === "listo";
    L.push("BEGIN:VEVENT", `UID:${t.id}@sala-de-trabajo`, `DTSTAMP:${new Date(t.updated_at).toISOString().replace(/[-:]|\.\d+/g, "")}`,
      `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`,
      `SUMMARY:${esc((done ? "✓ " : "") + t.title + " [" + (ST[t.status] ?? t.status) + "]")}`,
      `DESCRIPTION:${esc("Prioridad: " + t.priority + "\n" + (t.brief ?? ""))}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  L.push("END:VCALENDAR");
  return new Response(L.join("\r\n") + "\r\n", { headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store" } });
});
