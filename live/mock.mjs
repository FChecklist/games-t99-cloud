// --dry: an in-memory stand-in for the site. NO socket is opened. Answers are plausible, not exact: refusal checks will show as "unexpected" in a dry run, which is fine.
let seat = 0; const seats = new Map();
const R = (status, obj) => ({ status, text: async () => JSON.stringify(obj) });
export default async function mockFetch(url, init = {}) {
  const u = new URL(url); const p = u.pathname; const m = init.method || "GET";
  await new Promise((r) => setTimeout(r, 1 + Math.random() * 4));
  if (p === "/version.json") return R(200, { commit: "dry-run", built: "mock" });
  if (p === "/api/auth/verify") return R(200, { token: "ctk_" + "ab".repeat(24), email: "demo1@xyz.in" });
  if (p === "/control.js") return R(404, {});
  if (/\/api\/z$/.test(p) && m === "POST") { const b = JSON.parse(init.body || "{}"); if (!b.id || b.id.length < 6 || !b.cap || b.cap < 1) return R(400, { error: "bad request" }); return R(200, { ok: true, draft: false, paid: true }); }
  if (/\/join$/.test(p)) { const b = JSON.parse(init.body || "{}"); if (!b.consent) return R(400, { error: "consent", code: "consent-required" }); if (!b.device) return R(400, { error: "device" }); const k = b.phone + "|" + b.device; if (!seats.has(k)) seats.set(k, ++seat); return R(200, { ok: true, pid: seats.get(k) + "x" + b.device.slice(0, 6) }); }
  if (/\/publish$/.test(p)) { const b = JSON.parse(init.body || "{}"); if (!b.consent) return R(400, { error: "tick the box" }); return R(200, { ok: true, published: true, paid: true, startMs: Date.now() + 300000 }); }
  if (/\/participants$/.test(p)) return R(200, { total: seat });
  if (/\/claims$/.test(p) && m === "POST") return R(200, { ok: true, stored: 1 });
  if (/\/over$/.test(p)) return R(200, { ok: true, counted: 1 });
  if (/\/life$/.test(p)) return R(200, { endMs: Date.now(), endSrc: "dry" });
  if (/\/org\/host$/.test(p)) return R(200, { ok: true, id: "h1", hostKey: "cth_" + "cd".repeat(24) });
  if (/\/org\/cohost$/.test(p)) return R(200, { ok: true, id: "c1", cohostKey: "ctc_" + "ef".repeat(24) });
  return R(200, { ok: true });
}
