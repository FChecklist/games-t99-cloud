// Steps shared by all six games (they run on one code base: same console routes, same join page routes, same team routes).
// Every step records what the site answered (status, plain message, milliseconds, state afterwards) through ctx.call(); a step never stops the run because the site said "no":
// a refusal is a result. Only the STOP file stops everything.
import { StopError, budgetLeft, consentBody, deviceOf, nameOf, newEid, phoneOf, roundAt, roundMs, seatOfPid, sleep, checkStop } from "./lib.mjs";
import { ensureControlKey, sendControl } from "./ctl.mjs";

export async function guard(ctx, feature, fn) {
  try { return await fn(); } catch (e) { if (e instanceof StopError) throw e; ctx.notes.push(`${feature}: exception ${String(e && e.message || e).slice(0, 160)}`); ctx.note(feature, "exception", String(e && e.message || e).slice(0, 200)); return null; }
}
export async function pool(n, items, fn) {
  let k = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => { for (;;) { const i = k++; if (i >= items.length) return; out[i] = await fn(items[i], i); } }));
  return out;
}
export const untilMs = async (ms, ctx) => { for (;;) { checkStop(); const d = ms - Date.now(); if (d <= 0) return; await sleep(Math.min(d, 5000)); } };

/** The shared state of one run. */
export function newState(ctx, o) {
  const salt = parseInt(ctx.runId.replace(/\D/g, "").slice(-4) || "1", 10) % 97;
  const leadMs = Math.max(90, (o.leadSec ?? 300)) * 1000;
  const startMs = Math.ceil((Date.now() + leadMs) / 3000) * 3000;
  return {
    game: ctx.game, runId: ctx.runId, eid: newEid(), P: o.players, extra: o.extraSlots ?? 12, get cap() { return this.P + this.extra; }, conc: o.conc ?? 6,
    leadMs, startMs, get startRound() { return roundAt(this.startMs); }, callSeconds: o.callSeconds, play: o.play || "short", players: [], extras: {}, kind: o.kind || "game",
    phoneOf: (i) => phoneOf(salt, i), name: new Date().toISOString().slice(0, 16).replace("T", " ") + " " + ctx.runId.slice(-8), salt, hasIssues: [], ids: {}, runtime: o.runtime ?? 0,
  };
}
const P_PATH = (S, p) => `/api/z/${S.eid}${p}`;
export const joinBody = (ctx, S, i, o = {}) => ({ phone: o.phone === undefined ? S.phoneOf(i) : o.phone, name: o.name || nameOf(S.game, i), ...(o.noDevice ? {} : { device: o.device || deviceOf(S.runId, i) }), ...(o.noConsent ? {} : { consent: consentBody(ctx, "K4") }), ...(o.from ? { from: o.from } : {}), ...(o.token ? { token: o.token } : {}), ...(ctx.game === "bingo" && !o.noEmp ? { empId: "E" + String(S.runId).replace(/[^A-Za-z0-9]/g, "").slice(-8) + i, location: "Pune office" } : {}) });
export async function joinOne(ctx, S, feature, step, i, o = {}) {
  let r = await ctx.call(feature, step, "POST", P_PATH(S, "/join"), { body: joinBody(ctx, S, i, o), as: null, expect: o.expect || [200], tries: o.tries ?? 3 });
  if (r.s === 400 && r.j?.stale && r.j?.version && !o.noRetryConsent) { ctx.consentVersion = r.j.version; ctx.notes.push("consent version updated from the site: " + r.j.version); r = await ctx.call(feature, step + "-retry-new-consent", "POST", P_PATH(S, "/join"), { body: joinBody(ctx, S, i, o), as: null, expect: o.expect || [200] }); }
  return r;
}

// ------------------------------------------------------------------ 1. the organizer's side from scratch
/** Read-only screens an organizer meets first (no writes). */
export async function stepFirstLook(ctx, S) {
  await ctx.captureVersion();
  await ctx.signIn();
  for (const [step, p] of [["payments-status", "/api/payments/status"], ["site-mode", "/api/mode"], ["history", "/api/history"], ["team-list", "/api/org/team"], ["keys-list", "/api/org/keys"], ["ai-manifest", "/api/z/ai-manifest"], ["schedule-helper", "/api/z/schedule?at=" + encodeURIComponent(new Date(Date.now() + 86400000).toISOString())], ["credit", "/api/org/credit"], ["whoami", "/api/whoami"]])
    await ctx.call("organizer-first-look", step, "GET", p, { as: step === "payments-status" || step === "site-mode" || step === "ai-manifest" || step === "schedule-helper" ? null : "org", expect: [200, 404], tries: 1 });
}

/** Create -> settings -> publish with the ZERO route (the owner's test pack, Rs 0). */
export async function stepSetup(ctx, S, game) {
  const base = { id: S.eid, startRound: S.startRound, callSeconds: S.callSeconds, cap: S.cap, name: `SMOKE10M test ${S.game} ${S.name}`.slice(0, 40), whoCanJoin: "anyone", ...(game.createExtra ? game.createExtra(S) : {}) };
  // refusals first (nothing is created by them)
  await ctx.call("create", "refused-bad-id", "POST", "/api/z", { body: { ...base, id: "ab" }, expect: [400], tries: 0 });
  await ctx.call("create", "refused-cap-zero", "POST", "/api/z", { body: { ...base, id: newEid(), cap: 0 }, expect: [400], tries: 0 });
  await ctx.call("create", "refused-bad-gap", "POST", "/api/z", { body: { ...base, id: newEid(), callSeconds: 7 }, expect: [400], tries: 0 });
  await ctx.call("create", "refused-no-sign-in", "POST", "/api/z", { body: base, as: null, expect: [401, 403], tries: 0 });
  let c = await ctx.call("create", "create-game", "POST", "/api/z", { body: base, expect: [200] });
  { const m = c.s === 400 ? /(\d+) second(?:s| window)|one speed/i.exec(String(c.j?.error)) : null; const want = m ? Number(m[1] || 12) : 0; if (want && base.callSeconds !== want) { S.callSeconds = want; base.callSeconds = want; ctx.notes.push("site wants a " + want + "-second gap"); c = await ctx.call("create", "create-game-" + want + "s", "POST", "/api/z", { body: base, expect: [200] }); } }
  if (c.s === 400 && game.createFallback) { const b2 = game.createFallback(base, c); if (b2) c = await ctx.call("create", "create-game-fallback", "POST", "/api/z", { body: b2, expect: [200] }); }
  ctx.setState(c.ok ? `draft=${c.j?.draft} existed=${!!c.j?.existed}` : "no game");
  if (!c.ok) return false;
  const again = await ctx.call("create", "create-same-id-twice", "POST", "/api/z", { body: base, expect: [200] }); ctx.setState(`existed=${!!again.j?.existed} (never overwritten)`);
  // draft is private
  const di = await ctx.call("publish", "draft-info-public", "GET", P_PATH(S, "/info"), { as: null, expect: [200, 403, 404], tries: 1 });
  await joinOne(ctx, S, "publish", "join-before-publish", 900, { expect: [200, 403, 404, 409, 423], tries: 0 });
  await ctx.call("settings", "info-as-organizer", "GET", P_PATH(S, "/info"), { expect: [200] });
  const st = await ctx.call("settings", "save-settings", "PATCH", P_PATH(S, "/settings"), { body: { invites: { on: true, per: 4, cats: ["family", "colleagues"] }, ...(game.settings ? game.settings(S) : {}) }, expect: [200] }); ctx.setState(st.ok ? "settings saved (invitations on, up to 4 each)" : "settings not saved");
  await ctx.call("settings", "settings-bad-cap", "PATCH", P_PATH(S, "/settings"), { body: { cap: -5 }, expect: [400, 409, 402], tries: 0 });
  const sm = await ctx.call("settings", "summary-before-publish", "GET", P_PATH(S, "/summary"), { expect: [200] }); ctx.setState(summaryNote(sm.j));
  // publish: first without the tick (refused), then with it
  const pubBody = { email: "demo1@xyz.in", phone: "98765 43210" };
  await ctx.call("publish", "publish-without-consent", "POST", P_PATH(S, "/publish"), { body: pubBody, expect: [200, 400], tries: 0 });
  let pub = await ctx.call("publish", "publish", "POST", P_PATH(S, "/publish"), { body: { ...pubBody, consent: consentBody(ctx, "K1") }, expect: [200] });
  if (pub.s === 400 && pub.j?.stale && pub.j?.version) { ctx.consentVersion = pub.j.version; pub = await ctx.call("publish", "publish-retry-new-consent", "POST", P_PATH(S, "/publish"), { body: { ...pubBody, consent: consentBody(ctx, "K1") }, expect: [200] }); }
  ctx.setState(pub.ok ? `published=${pub.j?.published} paid=${pub.j?.paid} start=${pub.j?.startMs ? new Date(pub.j.startMs).toISOString().slice(11, 19) + "Z" : "?"}` : "not published");
  S.published = pub.ok; S.paid = !!pub.j?.paid;
  if (pub.ok) {
    const again2 = await ctx.call("publish", "publish-twice", "POST", P_PATH(S, "/publish"), { body: { ...pubBody, consent: consentBody(ctx, "K1") }, expect: [200] }); ctx.setState(`already=${!!again2.j?.already}`);
    const sm2 = await ctx.call("zero-coupon", "summary-after-publish", "GET", P_PATH(S, "/summary"), { expect: [200] }); ctx.setState(summaryNote(sm2.j));
    S.zero = { paid: S.paid, summary: summaryNote(sm2.j) };
    if (!S.paid) await ownerZero(ctx, S);
    ctx.note("zero-coupon", "result", S.paid ? "game is PAID at Rs 0 by the owner test pack (demo1 account): the owner-test route; no money, no invoice, no mail" : "game is NOT paid after publish: the zero route did not apply", summaryNote(sm2.j));
    const pi = await ctx.call("publish", "info-public-after-publish", "GET", P_PATH(S, "/info"), { as: null, expect: [200] }); ctx.setState(`cap=${pi.j?.cap} locked=${!!pi.j?.locked} startMs ok=${!!pi.j?.startMs}`);
  }
  return pub.ok;
}
const summaryNote = (j) => j ? `status=${j.status ?? "?"} payment=${typeof j.payment === "object" ? JSON.stringify(j.payment).slice(0, 80) : j.payment} price=${typeof j.price === "object" ? JSON.stringify(j.price).slice(0, 60) : j.price}` : "-";

/** Second zero route (only when the first did not make the game free AND the owner key of this game is on this machine): the owner price panel, "Make it free". Untested on live. */
async function ownerZero(ctx, S) {
  if (!ctx.ownerKey) { ctx.note("zero-coupon", "owner-price", "NOT RUN: owner key of this game is not on this machine (NOT FOUND, ask the BOSS)"); return; }
  const f = await ctx.call("zero-coupon", "owner-panel-facts", "GET", `/api/owner/price?eid=${S.eid}`, { as: "owner", expect: [200, 404] });
  const list = f.j?.list?.INR; if (!list) return;
  const set = await ctx.call("zero-coupon", "owner-price-free", "POST", "/api/owner/price", { as: "owner", body: { eid: S.eid, currency: "INR", direction: "down", amount: list, reason: "SMOKE10M zero test" }, expect: [200] });
  if (set.ok) { const co = await ctx.call("zero-coupon", "checkout-free", "POST", "/api/checkout", { body: { pack: 100, email: "demo1@xyz.in", org: "SMOKE10M", eid: S.eid }, expect: [200] }); ctx.setState(`mode=${co.j?.mode}`); }
}

// ------------------------------------------------------------------ 2. people join
export async function stepJoinCrowd(ctx, S) {
  const idx = Array.from({ length: S.P }, (_, i) => i + 1);
  let skipped = 0;
  await pool(S.conc, idx, async (i) => {
    if (budgetLeft().joins <= 0) { skipped++; return; }
    const r = await joinOne(ctx, S, "join", "join-" + (S.kind === "game" ? "crowd" : "few"), i, { expect: [200] });
    if (r.ok && r.j?.pid) S.players[i] = { i, pid: r.j.pid, device: deviceOf(S.runId, i), phone: S.phoneOf(i), seat: seatOfPid(r.j.pid) };
  });
  const ok = S.players.filter(Boolean).length;
  ctx.note("join", "crowd-result", `${ok} of ${S.P} joined${skipped ? `; ${skipped} skipped (daily join allowance)` : ""}`, `ok=${ok}`);
  S.joined = ok;
  const pt = await ctx.call("join", "participants-count", "GET", P_PATH(S, "/participants?limit=1"), { expect: [200] }); ctx.setState(`organizer sees total=${pt.j?.total} of ${ok} that got a ticket`);
  S.totalSeen = pt.j?.total;
}
const pl = (S, k) => S.players.filter(Boolean)[k] || null;

export async function stepJoinEdge(ctx, S) {
  const a = pl(S, 0), b = pl(S, 1), c = pl(S, 2); if (!a || !b || !c) { ctx.note("join-edge", "skipped", "not enough joined people"); return; }
  const same = await joinOne(ctx, S, "join-edge", "same-phone-again", a.i, { expect: [200] }); ctx.setState(`same ticket=${same.j?.pid === a.pid} again=${!!same.j?.again}`);
  await joinOne(ctx, S, "join-edge", "same-number-other-device", b.i, { device: deviceOf(S.runId, "other" + b.i), expect: [423, 409, 403] });
  await joinOne(ctx, S, "join-edge", "other-number-same-device", 800, { device: c.device, expect: [409, 423, 403] });
  await joinOne(ctx, S, "join-edge", "invalid-mobile", 801, { phone: "123", expect: [400] });
  await joinOne(ctx, S, "join-edge", "no-device", 802, { noDevice: true, expect: [400] });
  await joinOne(ctx, S, "join-edge", "no-consent-tick", 803, { noConsent: true, expect: [400], noRetryConsent: true });
  await ctx.call("join-edge", "unknown-game", "POST", "/api/z/SMK10M-NOGAM/join", { body: joinBody(ctx, S, 804), as: null, expect: [404, 400], tries: 0 });
  await ctx.call("join-edge", "info-unknown-game", "GET", "/api/z/SMK10M-NOGAM/info", { as: null, expect: [404], tries: 0 });
  await ctx.call("join-edge", "my-card-bad-pid", "GET", P_PATH(S, "/me?pid=1xdeadbeef"), { as: null, expect: [200, 403, 404] });
}

// ------------------------------------------------------------------ 3. families: a listed person invites up to 4
export async function stepFamilies(ctx, S) {
  const inv = pl(S, 3); if (!inv) return;
  const q = await ctx.call("families", "invites-before", "GET", P_PATH(S, `/invites?pid=${encodeURIComponent(inv.pid)}`), { as: null, expect: [200] }); ctx.setState(`on=${q.j?.on} per=${q.j?.per} used=${q.j?.used} canInvite=${q.j?.canInvite}`);
  S.family = [];
  for (let k = 1; k <= 4; k++) { const r = await joinOne(ctx, S, "families", "family-member-" + k, 600 + k, { from: inv.seat, expect: [200] }); if (r.ok) S.family.push({ i: 600 + k, pid: r.j?.pid, device: deviceOf(S.runId, 600 + k) }); }
  const fifth = await joinOne(ctx, S, "families", "fifth-invite-refused", 605, { from: inv.seat, expect: [409, 403] }); ctx.setState(`code=${fifth.j?.code} waiting=${!!fifth.j?.waiting}`);
  S.fifthWid = fifth.j?.wid || null;
  const q2 = await ctx.call("families", "invites-after", "GET", P_PATH(S, `/invites?pid=${encodeURIComponent(inv.pid)}`), { as: null, expect: [200] }); ctx.setState(`used=${q2.j?.used} of per=${q2.j?.per}`);
  await ctx.call("families", "invites-bad-pid", "GET", P_PATH(S, "/invites?pid=9x000"), { as: null, expect: [403, 404] });
  const pe = await ctx.call("families", "people-list", "GET", P_PATH(S, "/people?limit=5"), { expect: [200] }); ctx.setState(`used=${pe.j?.used} total=${pe.j?.total} waiting=${pe.j?.waiting} whoCanJoin=${pe.j?.whoCanJoin}`);
}

// ------------------------------------------------------------------ 4. people list, waiting room, admit / decline, remove
export async function stepPeopleWaiting(ctx, S) {
  const sw = await ctx.call("people-list", "switch-to-list-only", "PATCH", P_PATH(S, "/settings"), { body: { whoCanJoin: "list" }, expect: [200] });
  if (!sw.ok) { ctx.note("people-list", "skipped", "could not switch to list-only: " + sw.s); return; }
  const listed = [0, 1, 2].map((k) => ({ name: nameOf(S.game, 700 + k), phone: S.phoneOf(700 + k) }));
  const add = await ctx.call("people-list", "add-3-to-list", "POST", P_PATH(S, "/people"), { body: { people: listed, consent: consentBody(ctx, "K6") }, expect: [200] }); ctx.setState(`added=${add.j?.added} duplicates=${add.j?.duplicates} invalid=${(add.j?.invalid || []).length}`);
  await ctx.call("people-list", "add-over-limit-or-bad", "POST", P_PATH(S, "/people"), { body: { people: [{ name: "x", phone: "12" }], consent: consentBody(ctx, "K6") }, expect: [200, 400, 409] });
  const lst = await ctx.call("people-list", "list-people", "GET", P_PATH(S, "/people?limit=50"), { expect: [200] }); ctx.setState(`total=${lst.j?.total} used=${lst.j?.used} cap=${lst.j?.cap}`);
  const mine = (lst.j?.people || []).find((x) => x.status === "invited");
  const jl = await joinOne(ctx, S, "people-list", "listed-person-joins", 700, { expect: [200] });
  const w1 = await joinOne(ctx, S, "waiting-room", "unlisted-asks-to-join-1", 710, { expect: [403, 409] }); ctx.setState(`code=${w1.j?.code} wid=${w1.j?.wid ? "yes" : "no"}`);
  const w2 = await joinOne(ctx, S, "waiting-room", "unlisted-asks-to-join-2", 711, { expect: [403, 409] });
  const wl = await ctx.call("waiting-room", "waiting-list", "GET", P_PATH(S, "/waiting"), { expect: [200] }); ctx.setState(`waiting=${(wl.j?.waiting || []).length}`);
  const wid1 = w1.j?.wid || wl.j?.waiting?.[0]?.id, wid2 = w2.j?.wid || wl.j?.waiting?.[1]?.id;
  if (wid1) { const ad = await ctx.call("waiting-room", "admit", "POST", P_PATH(S, `/waiting/${wid1}`), { body: { decision: "admit" }, expect: [200] }); ctx.setState(`admitted=${!!ad.j?.admitted}`);
    const me = await ctx.call("waiting-room", "request-state-after-admit", "GET", P_PATH(S, `/me?wid=${wid1}`), { as: null, expect: [200] }); ctx.setState(`state=${me.j?.state}`);
    const rj = await joinOne(ctx, S, "waiting-room", "admitted-person-joins", 710, { expect: [200] }); ctx.setState(`got ticket=${!!rj.j?.pid}`); }
  if (wid2) { const de = await ctx.call("waiting-room", "decline", "POST", P_PATH(S, `/waiting/${wid2}`), { body: { decision: "decline" }, expect: [200] }); ctx.setState(`declined=${!!de.j?.declined}`);
    const rj2 = await joinOne(ctx, S, "waiting-room", "declined-person-tries-again", 711, { expect: [403, 409] }); ctx.setState(`code=${rj2.j?.code}`); }
  await ctx.call("waiting-room", "decision-unknown-request", "POST", P_PATH(S, "/waiting/nope"), { body: { decision: "admit" }, expect: [404, 400, 409] });
  await ctx.call("people-list", "export-csv", "GET", P_PATH(S, "/people/export"), { expect: [200] });
  if (mine?.id) { const rm = await ctx.call("remove-person", "remove-listed-person", "POST", P_PATH(S, `/people/${encodeURIComponent(mine.id)}/remove`), { body: {}, expect: [200] }); ctx.setState(`removed=${!!rm.j?.removed} during=${rm.j?.during}`); }
  await ctx.call("remove-person", "remove-unknown", "POST", P_PATH(S, "/people/nope/remove"), { body: {}, expect: [404, 400] });
  await ctx.call("people-list", "switch-back-to-anyone", "PATCH", P_PATH(S, "/settings"), { body: { whoCanJoin: "anyone" }, expect: [200] });
}

// ------------------------------------------------------------------ 5. host and co-host
// T99 (8 Nov 2026): leftover "SMOKE10M host" entries from earlier failed runs filled the shared test organizer's 5-Host limit (23 Lucky Draw runs ended ENV "up to 5 Hosts").
// Before making our host, retire every leftover host this runner made (label contains SMOKE10M, never co-hosts, never anything else) when 3 or more are found.
async function tidyLeftoverHosts(ctx) {
  const t = await ctx.call("host", "team-list-before-host", "GET", "/api/org/team", { expect: [200, 403, 404], tries: 0 });
  const left = []; const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { const lab = String(o.label || o.name || ""); if (o.id && /SMOKE10M host/i.test(lab)) left.push(o); Object.values(o).forEach(walk); } };
  walk(t.j);
  if (left.length < 3) return;
  for (const x of left) await ctx.call("host", "retire-leftover-host", "POST", "/api/org/team/retire", { body: { id: x.id }, expect: [200, 404, 409], tries: 0 });
}
export async function stepTeam(ctx, S) {
  await tidyLeftoverHosts(ctx);
  const h = await ctx.call("host", "create-host", "POST", "/api/org/host", { body: { label: "SMOKE10M host", mobile: S.phoneOf(990) }, expect: [200] });
  if (h.ok && h.j?.hostKey) { ctx.keys.host = h.j.hostKey; S.ids.host = h.j.id; } ctx.setState(h.ok ? `host made; emailed=${!!h.j?.emailed} link-only` : "no host");
  if (ctx.keys.host) {
    const w = await ctx.call("host", "whoami-as-host", "GET", "/api/whoami", { as: "host", expect: [200] }); ctx.setState(`kind=${w.j?.kind}`);
    const hs = await ctx.call("host", "host-setup-state", "GET", "/api/host/setup", { as: "host", expect: [200] }); ctx.setState(`needEmail=${hs.j?.needEmail} needMobile=${hs.j?.needMobile} ready=${hs.j?.ready}`);
    await ctx.call("host", "host-sees-participants", "GET", P_PATH(S, "/participants?limit=3"), { as: "host", expect: [200, 403] });
    const an = await ctx.call("host", "host-announces", "POST", P_PATH(S, "/announce"), { as: "host", body: { text: "SMOKE10M host hello" }, expect: [200, 403] }); ctx.setState(`sent=${!!an.j?.sent}`);
    await ctx.call("host", "host-reads-summary", "GET", P_PATH(S, "/summary"), { as: "host", expect: [200, 403] });
    await ctx.call("host", "host-reads-prizes", "GET", P_PATH(S, "/prizes"), { as: "host", expect: [200, 403] });
    await ctx.call("host", "host-reads-life", "GET", P_PATH(S, "/life"), { as: "host", expect: [200, 403] });
    await ctx.call("host", "host-cannot-create-game", "POST", "/api/z", { as: "host", body: { id: newEid(), startRound: S.startRound, callSeconds: S.callSeconds, cap: 10 }, expect: [403], tries: 0 });
    await ctx.call("host", "host-cannot-add-host", "POST", "/api/org/host", { as: "host", body: { label: "x", mobile: S.phoneOf(991) }, expect: [403], tries: 0 });
    await ctx.call("host", "host-cannot-list-keys", "GET", "/api/org/keys", { as: "host", expect: [403], tries: 0 });
  }
  const c = await ctx.call("cohost", "create-cohost", "POST", "/api/org/cohost", { body: { label: "SMOKE10M cohost", phone: S.phoneOf(992), e: S.eid }, expect: [200] });
  if (c.ok && c.j?.cohostKey) { ctx.keys.cohost = c.j.cohostKey; S.ids.cohost = c.j.id; } ctx.setState(c.ok ? "co-host made (bound to this game)" : "no co-host");
  if (ctx.keys.cohost) {
    await ctx.call("cohost", "cohost-list-before-accepting-role", "GET", P_PATH(S, "/people?limit=5"), { as: "cohost", expect: [400], tries: 0 });
    const acc = await ctx.call("cohost", "cohost-accepts-role", "POST", "/api/org/role/accept", { as: "cohost", body: { consent: consentBody(ctx, "K5") }, expect: [200] }); ctx.setState(`accepted=${acc.ok}`);
    const w = await ctx.call("cohost", "whoami-as-cohost", "GET", "/api/whoami", { as: "cohost", expect: [200] }); ctx.setState(`kind=${w.j?.kind}`);
    const cv = await ctx.call("cohost", "cohost-own-view", "GET", P_PATH(S, "/cohost"), { as: "cohost", expect: [200] }); ctx.setState(`joined=${cv.j?.joined} brought=${cv.j?.brought} link=${cv.j?.inviteLink ? "yes" : "no"}`);
    const cp = await ctx.call("cohost", "cohost-adds-own-guest", "POST", P_PATH(S, "/people"), { as: "cohost", body: { people: [{ name: nameOf(S.game, 720), phone: S.phoneOf(720) }], consent: consentBody(ctx, "K6") }, expect: [200] }); ctx.setState(`added=${cp.j?.added}`);
    await ctx.call("cohost", "cohost-own-list", "GET", P_PATH(S, "/people?limit=5"), { as: "cohost", expect: [200] });
    await ctx.call("cohost", "cohost-cannot-see-participants", "GET", P_PATH(S, "/participants?limit=3"), { as: "cohost", expect: [403], tries: 0 });
    await ctx.call("cohost", "cohost-cannot-announce", "POST", P_PATH(S, "/announce"), { as: "cohost", body: { text: "x" }, expect: [403], tries: 0 });
    await ctx.call("cohost", "cohost-cannot-change-settings", "PATCH", P_PATH(S, "/settings"), { as: "cohost", body: { name: "hack" }, expect: [403], tries: 0 });
    await ctx.call("cohost", "cohost-cannot-cancel", "POST", P_PATH(S, "/cancel"), { as: "cohost", body: { confirmations: 3 }, expect: [403], tries: 0 });
  }
  await ctx.call("host", "team-list-after", "GET", `/api/org/team?e=${S.eid}`, { expect: [200] });
  await ctx.call("host", "no-key-is-refused", "GET", P_PATH(S, "/summary"), { as: null, expect: [401, 403], tries: 0 });
}
export async function stepTeamRetire(ctx, S) {
  S.teamRetired = true;
  if (S.ids.cohost) { const r = await ctx.call("cohost", "retire-cohost", "POST", "/api/org/team/retire", { body: { id: S.ids.cohost }, expect: [200] }); ctx.setState(`revoked=${r.j?.revoked}`); if (r.ok) { const k = ctx.keys.cohost; ctx.keys.cohost = k; await ctx.call("cohost", "retired-cohost-key-is-dead", "GET", "/api/whoami", { as: "cohost", expect: [401, 403, 404], tries: 0 }); } }
  if (S.ids.host) { const r = await ctx.call("host", "retire-host", "POST", "/api/org/team/retire", { body: { id: S.ids.host }, expect: [200, 404] }); /* 404 = a sibling worker's tidyLeftoverHosts already retired this shared-org host (harness race, 8 Nov); the next line still proves the key is dead */ ctx.setState(`revoked=${r.j?.revoked}`); if (r.ok) await ctx.call("host", "retired-host-key-is-dead", "GET", "/api/whoami", { as: "host", expect: [401, 403, 404], tries: 0 }); }
}

// ------------------------------------------------------------------ 6. leaving, coming back, coming late, the announcement
export async function stepLeaveRejoin(ctx, S, when) {
  await leaveRejoinOne(ctx, S, when, pl(S, when === "before" ? 5 : 8));
  // T99 stratified sampling (8 Nov 2026): extra rejoin trials per run (first-join vs rejoin stratum). T99_REJOIN_N = rejoin trials per run in total (default 1 = old behaviour).
  const extra = Math.max(0, Number(process.env.T99_REJOIN_N || 1) - 1);
  for (let k = 0; k < extra; k++) { const p = pl(S, (when === "before" ? 12 : 12 + extra) + k); if (!p) break; await leaveRejoinOne(ctx, S, when, p); }
}
async function leaveRejoinOne(ctx, S, when, p) {
  if (!p) return;
  const f = "leave-rejoin-" + when + "-start";
  await ctx.call(f, "leave-wrong-phone", "POST", P_PATH(S, "/leave"), { as: null, body: { pid: p.pid, device: deviceOf(S.runId, "wrong") }, expect: [403, 400] });
  const l = await ctx.call(f, "leave", "POST", P_PATH(S, "/leave"), { as: null, body: { pid: p.pid, device: p.device }, expect: [200] }); ctx.setState(`left=${!!l.j?.left}`);
  const lc = await ctx.call(f, "leave-again", "POST", P_PATH(S, "/leave"), { as: null, body: { pid: p.pid, device: p.device }, expect: [403, 404, 200] });
  const rj = await joinOne(ctx, S, f, "come-back-same-phone", p.i, { expect: [200, 403, 409] }); ctx.setState(`code=${rj.j?.code || "-"} newTicket=${rj.j?.pid && rj.j.pid !== p.pid}`);
  if (rj.ok && rj.j?.pid) { p.pid = rj.j.pid; p.seat = seatOfPid(rj.j.pid); }
}
export async function stepLate(ctx, S) {
  for (let k = 0; k < 2; k++) { const r = await joinOne(ctx, S, "late-join", "join-after-start-" + (k + 1), 400 + k, { expect: [200] }); ctx.setState(`ticket=${!!r.j?.pid} code=${r.j?.code || "-"}`); if (r.ok) S.extras["late" + k] = { i: 400 + k, pid: r.j.pid, device: deviceOf(S.runId, 400 + k) }; }
}
export async function stepAnnounce(ctx, S) {
  const a = await ctx.call("announce", "send", "POST", P_PATH(S, "/announce"), { body: { text: "SMOKE10M test message" }, expect: [200] }); ctx.setState(`sent=${!!a.j?.sent}`);
  const ctl = await ctx.call("announce", "phones-read-it-in-control-file", "GET", P_PATH(S, "/control"), { as: null, expect: [200, 404] }); ctx.setState(`ann=${ctl.j?.ann ? ctl.j.ann.text?.slice(0, 30) : "none"}`);
  await ctx.call("announce", "second-within-5s", "POST", P_PATH(S, "/announce"), { body: { text: "SMOKE10M second" }, expect: [200, 429], tries: 0 });
  await ctx.call("announce", "too-long", "POST", P_PATH(S, "/announce"), { body: { text: "x".repeat(300) }, expect: [400, 200, 429], tries: 0 });
  await sleep(5200);
  await ctx.call("announce", "clear", "POST", P_PATH(S, "/announce"), { body: { text: "" }, expect: [200] });
}

// ------------------------------------------------------------------ 7. check-in (the "mark yourself present" step before a claim counts), pause / resume, claims, end, reports
export async function stepCheckin(ctx, S, who) {
  const list = who || S.players.filter(Boolean); if (!list.length) return;
  const first = list[0]; let open = null;
  for (let t = 0; t < 40; t++) {
    const r = await ctx.call("checkin", "check-in-state", "GET", P_PATH(S, `/checkin?pid=${encodeURIComponent(first.pid)}&device=${first.device}`), { as: null, expect: [200, 404, 403], tries: 1 });
    if (r.s === 404) { ctx.note("checkin", "not-in-this-game", "route answers 404: no check-in step in this game"); return "none"; }
    if (r.j?.required === false) { ctx.note("checkin", "not-required", "check-in not required for this game"); S.checkinRequired = false; return "none"; }
    if (r.j?.present) { open = r.j; break; }
    if (r.j?.open && r.j?.code) { open = r.j; break; }
    if (Date.now() > S.startMs + 60000) break;
    await sleep(15000);
  }
  if (!open) { ctx.note("checkin", "never-opened", "check-in never showed a code before the wait ended"); return "never"; }
  let ok = 0, bad = 0;
  await pool(S.conc, list, async (p) => {
    const r = await ctx.call("checkin", "check-in-state-each", "GET", P_PATH(S, `/checkin?pid=${encodeURIComponent(p.pid)}&device=${p.device}`), { as: null, expect: [200], tries: 1, quiet: false });
    if (r.j?.present) { ok++; p.present = true; return; }
    if (!r.j?.code) { bad++; return; }
    const x = await ctx.call("checkin", "mark-present", "POST", P_PATH(S, "/checkin"), { as: null, body: { pid: p.pid, device: p.device, code: r.j.code, confirmName: true, confirmMobile: true }, expect: [200] });
    if (x.ok && x.j?.present) { ok++; p.present = true; } else bad++;
  });
  ctx.note("checkin", "result", `${ok} marked present, ${bad} not`, `present=${ok}`); S.present = ok;
  const wrong = list[1]; if (wrong) await ctx.call("checkin", "wrong-code", "POST", P_PATH(S, "/checkin"), { as: null, body: { pid: wrong.pid, device: wrong.device, code: "0000", confirmName: true, confirmMobile: true }, expect: [400, 403, 200, 409] });
  return "done";
}

/** Pause -> wait -> resume -> extend, by signed messages. game.pause overrides this (Tic Tac Toe has its own routes). */
export async function stepPauseResume(ctx, S) {
  const k = await ensureControlKey(ctx, S.eid); if (!k.ok) return;
  const before = await ctx.call("pause-resume", "control-file-before", "GET", P_PATH(S, "/control"), { as: null, expect: [200, 404] }); ctx.setState(`messages=${(before.j?.messages || []).length}`);
  const p = await sendControl(ctx, S.eid, "pause", "pause-resume", "pause");
  await sleep(6000);
  const mid = await ctx.call("pause-resume", "control-file-while-paused", "GET", P_PATH(S, "/control"), { as: null, expect: [200, 404] }); ctx.setState(`messages=${(mid.j?.messages || []).length} last=${mid.j?.messages?.[mid.j.messages.length - 1]?.action || "?"}`);
  const dup = await sendControl(ctx, S.eid, "pause", "pause-resume", "pause-again", { _expect: [200, 422] });
  await sendControl(ctx, S.eid, "extend", "pause-resume", "extend-30s-while-paused", { seconds: 30, _expect: [200, 422] });
  await sleep(9000);
  const r = await sendControl(ctx, S.eid, "resume", "pause-resume", "resume");
  await sleep(6000);
  const after = await ctx.call("pause-resume", "control-file-after-resume", "GET", P_PATH(S, "/control"), { as: null, expect: [200, 404] }); ctx.setState(`messages=${(after.j?.messages || []).length} last=${after.j?.messages?.[after.j.messages.length - 1]?.action || "?"}`);
  await sendControl(ctx, S.eid, "extend", "pause-resume", "extend-when-not-paused", { seconds: 30, _expect: [200, 422] });
  await ctx.call("pause-resume", "pause-without-sign-or-key", "POST", P_PATH(S, "/control"), { as: null, body: { message: { forged: true } }, expect: [400, 403, 401], tries: 0 });
  await ctx.call("pause-resume", "request-pause-by-ai-style", "POST", P_PATH(S, "/control/request"), { body: { action: "pause", note: "SMOKE10M request" }, expect: [200, 403, 404] });
  await ctx.call("pause-resume", "list-requests", "GET", P_PATH(S, "/control/request"), { expect: [200, 403, 404] });
  await ctx.call("pause-resume", "clear-requests", "POST", P_PATH(S, "/control/request/clear"), { body: {}, expect: [200, 403, 404] });
  S.paused = p.status === 200 && r.status === 200;
}

/** Claims, the four kinds. `cfg`: {valid, wrongPattern, maxIdx, bogey}. Server rule: a claim for number N is taken until number N+1 is announced; wrong patterns are ignored. */
export async function stepClaims(ctx, S, cfg) {
  const p = S.players.filter(Boolean).find((x) => x.present !== false) || pl(S, 10), q = pl(S, 11); if (!p) return;
  const cs = S.callSeconds * 1000; const idxNow = Math.max(0, Math.floor((Date.now() - S.startMs) / cs));
  const claim = (pid, pattern, idx, extra = {}) => ({ pid, ...(extra.device ? { device: extra.device } : { device: p.device }), claims: [{ pattern, idx, round: 1 }] });
  const v = await ctx.call("claims", "valid-claim-current-number", "POST", P_PATH(S, "/claims"), { as: null, body: claim(p.pid, cfg.valid, Math.min(idxNow, cfg.maxIdx)), expect: [200, 409, 403] }); ctx.setState(`stored=${v.j?.stored} late=${v.j?.late ?? 0} code=${v.j?.code || "-"}`);
  const d = await ctx.call("claims", "duplicate-claim", "POST", P_PATH(S, "/claims"), { as: null, body: claim(p.pid, cfg.valid, Math.min(idxNow, cfg.maxIdx)), expect: [200, 409] }); ctx.setState(`stored=${d.j?.stored} (second copy stored once)`);
  const l = await ctx.call("claims", "late-claim-old-number", "POST", P_PATH(S, "/claims"), { as: null, body: claim(p.pid, cfg.valid, 0, {}), expect: [409, 200] }); ctx.setState(`stored=${l.j?.stored} code=${l.j?.code || "-"}`);
  const w1 = await ctx.call("claims", "wrong-pattern-name", "POST", P_PATH(S, "/claims"), { as: null, body: claim(p.pid, cfg.wrongPattern || "nonsense", idxNow), expect: [200, 400] }); ctx.setState(`stored=${w1.j?.stored} (ignored)`);
  const w2 = await ctx.call("claims", "wrong-number-index", "POST", P_PATH(S, "/claims"), { as: null, body: claim(p.pid, cfg.valid, 999), expect: [200, 400] }); ctx.setState(`stored=${w2.j?.stored} (ignored)`);
  await ctx.call("claims", "claim-by-stranger-pid", "POST", P_PATH(S, "/claims"), { as: null, body: { pid: "9999x0000", device: p.device, claims: [{ pattern: cfg.valid, idx: idxNow, round: 1 }] }, expect: [403] });
  await ctx.call("claims", "claim-empty-body", "POST", P_PATH(S, "/claims"), { as: null, body: {}, expect: [400] });
  if (q) await ctx.call("claims", "claim-with-other-phones-device", "POST", P_PATH(S, "/claims"), { as: null, body: { pid: q.pid, device: p.device, claims: [{ pattern: cfg.valid, idx: Math.min(idxNow, cfg.maxIdx), round: 1 }] }, expect: [403, 200, 409] });
  if (cfg.bogey) { const b = await ctx.call("claims", "false-claim-bogey", "POST", P_PATH(S, "/bogey"), { as: null, body: { pid: p.pid, device: p.device, pattern: cfg.valid, round: 1 }, expect: [200, 400, 403] }); ctx.setState(`bogey recorded=${b.j?.ok ?? b.j?.stored ?? "?"}`); }
  const g = await ctx.call("claims", "organizer-reads-claims", "GET", P_PATH(S, "/claims"), { expect: [200] }); ctx.setState(`claims=${(g.j?.claims || []).length} tooLate=${(g.j?.tooLate || []).length}`);
  await ctx.call("claims", "claims-read-without-key", "GET", P_PATH(S, "/claims"), { as: null, expect: [401, 403] , tries: 0});
  const rs = await ctx.call("claims", "results-public", "GET", P_PATH(S, "/results"), { as: null, expect: [200] }); ctx.setState(`settled=${(rs.j?.results || []).length}`);
}

export async function stepForgeries(ctx, S) {
  const p = pl(S, 12) || pl(S, 0); if (!p) return;
  await ctx.call("forgery", "forged-vote-no-device", "POST", P_PATH(S, "/vote"), { as: null, body: { pid: p.pid, results: [{ pattern: "early5", ordinal: 1, round: 1, idx: 10, pids: [p.pid] }] }, expect: [403, 400] });
  await ctx.call("forgery", "forged-game-over-no-device", "POST", P_PATH(S, "/over"), { as: null, body: { pid: p.pid }, expect: [403, 400] });
  await ctx.call("forgery", "game-over-from-other-phone", "POST", P_PATH(S, "/over"), { as: null, body: { pid: p.pid, device: deviceOf(S.runId, "forged") }, expect: [403, 400] });
  await ctx.call("forgery", "post-result-settle", "POST", P_PATH(S, "/settle"), { as: null, body: {}, expect: [403] });
}

/** End of the game. short: three phones say "over" once 20 numbers' time has passed (the site then ends the game early); full: wait for the natural end first. */
export async function stepEnd(ctx, S, game) {
  const need = Math.min(3, Math.ceil(S.joined / 2));
  const all = S.players.filter(Boolean); const phones = all.length > 24 ? all.slice(20, 20 + Math.max(need, 3)) : all.slice(0, Math.max(need, 3));
  const n = game.endAfterNumbers ?? 20;
  const earliest = S.startMs + n * S.callSeconds * 1000 + 10000;
  const natural = S.startMs + (game.totalNumbers ?? 90) * S.callSeconds * 1000 + 30000;
  await untilMs(S.play === "full" ? natural : earliest, ctx);
  const early = await ctx.call("end", "over-too-early-or-ok", "POST", P_PATH(S, "/over"), { as: null, body: { pid: phones[0]?.pid, device: phones[0]?.device }, expect: [200] }); ctx.setState(`counted=${early.j?.counted}`);
  for (const p of phones.slice(1)) await ctx.call("end", "phone-says-game-over", "POST", P_PATH(S, "/over"), { as: null, body: { pid: p.pid, device: p.device }, expect: [200] });
  await sleep(4000);
  const life = await ctx.call("end", "life-after-over", "GET", P_PATH(S, "/life"), { expect: [200] }); ctx.setState(`endSrc=${life.j?.endSrc} endMs=${life.j?.endMs ? "set" : "none"} reportState=${life.j?.reportState}`);
  S.ended = !!life.j?.endMs;
}
export async function stepReports(ctx, S) {
  const g = (feature, step, p, o = {}) => ctx.call(feature, step, "GET", P_PATH(S, p), { expect: [200], ...o });
  const rs = await g("report", "results", "/results", { as: null }); ctx.setState(`results=${(rs.j?.results || []).length}`);
  const sm = await g("report", "summary", "/summary"); ctx.setState(summaryNote(sm.j));
  const pr = await g("report", "prizes", "/prizes", { expect: [200, 404] }); ctx.setState(`prizes=${(pr.j?.prizes || []).length}`);
  const rl = await g("report", "report-link", "/reportlink", { expect: [200, 404] }); ctx.setState(`ready=${rl.j?.ready} sent=${rl.j?.sent}`);
  const lf = await g("report", "life", "/life"); ctx.setState(`endSrc=${lf.j?.endSrc} reportState=${lf.j?.reportState} erasure=${lf.j?.fullDeleteAtMs ? "scheduled" : "-"}`);
  const sd = await g("report", "seats-public", "/seats?after=0", { as: null, expect: [200, 403] }); ctx.setState(`ready=${sd.j?.ready} seats=${(sd.j?.seats || []).length}`);
  const pt = await g("report", "participants-total", "/participants?limit=1"); ctx.setState(`total=${pt.j?.total}`);
  await g("report", "info-final", "/info", { as: null });
  await ctx.call("report", "history-list", "GET", "/api/history", { expect: [200] });
}
export async function stepErase(ctx, S) {
  const e = await ctx.call("erase", "erase-people-data", "POST", P_PATH(S, "/erase"), { body: {}, expect: [200, 409] }); ctx.setState(e.s === 409 ? `refused while running (${e.j?.code}); the site erases by itself within 24 h` : `erased=${e.j?.erased}`);
  S.erased = e.ok;
}

// ------------------------------------------------------------------ journeys: an organizer builds a game from scratch, publishes it, looks around and cancels it (it never plays)
export async function stepCancel(ctx, S) {
  const pv = await ctx.call("cancel", "cancel-preview", "GET", P_PATH(S, "/cancel-preview"), { expect: [200] }); ctx.setState(`canCancel=${pv.j?.canCancel} paid=${pv.j?.paid}`);
  await ctx.call("cancel", "cancel-needs-3-confirmations", "POST", P_PATH(S, "/cancel"), { body: { confirmations: 1 }, expect: [400], tries: 0 });
  const c = await ctx.call("cancel", "cancel-game", "POST", P_PATH(S, "/cancel"), { body: { confirmations: 3 }, expect: [200] }); ctx.setState(`cancelled=${!!c.j?.cancelled}`);
  S.cancelled = c.ok;
  if (c.ok) { await joinOne(ctx, S, "cancel", "join-after-cancel", 1, { expect: [409, 403, 404, 410] }); await ctx.call("cancel", "cancel-twice", "POST", P_PATH(S, "/cancel"), { body: { confirmations: 3 }, expect: [200, 409] }); }
}
