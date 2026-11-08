// The two kinds of run.
//   runJourney: a "first-time organizer" from scratch: look around, create, settings, publish (zero route), a few joins, families, list + waiting room, host / co-host, then CANCEL.
//               The game is dated days ahead and never plays, so it does not stay in the live gate (cancelled games leave it).
//   runFullGame: the same set-up with a full crowd, then the real game clock: check-in, claims (valid, duplicate, late, wrong), game-specific probes, leave, late joins,
//               forgeries, pause / resume, end, reports, erase.  Every step records what the site answered; nothing stops the run except the STOP file.
import { checkStop, sleep } from "./lib.mjs";
import * as C from "./common.mjs";
import { ensureControlKey } from "./ctl.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** POLL LOAD (1000-player ladder): every joined player asks the game the way the real phone does: the claim signal /cv every 2 s (spread over slots) and the seat list /seats every 15 s (25 s above 250 seats).
 *  Latency and answers per ask are measured here (p50/p95/p99, errors by status) and written to <out>/ladder-<run>.json. Runs for `secs` seconds. */
async function pollLoad(ctx, S, secs) {
  const ps = S.players.filter(Boolean); const stop = Date.now() + secs * 1000;
  const lat = { cv: [], seats: [] }, st = { cv: {}, seats: {} };
  const seatEvery = S.P <= 250 ? 15000 : 25000;
  const one = async (kind, p) => {
    const t0 = Date.now();
    const first = !p.__seen; if (kind === "seats") p.__seen = true; // a phone's first seat list is the full catch-up, the later ones ask only for what is new
    const path = kind === "cv" ? `/api/z/${S.eid}/cv` : `/api/z/${S.eid}/seats?after=${first ? 0 : S.P + 60}&cafter=${first ? 0 : 1000000}&v=0`;
    const r = await ctx.call("load", kind === "cv" ? "cv-poll" : "seats-poll", "GET", path, { as: null, expect: [200] });
    lat[kind].push(Date.now() - t0); const k = String(r.s ?? "x"); st[kind][k] = (st[kind][k] || 0) + 1;
  };
  await Promise.all(ps.map(async (p, i) => {
    let nextCv = Date.now() + (i % 40) * 50, nextSeats = Date.now() + (i % 25) * 600;
    while (Date.now() < stop) {
      checkStop();
      const now = Date.now();
      if (now >= nextCv) { nextCv += 2000; await one("cv", p); }
      if (now >= nextSeats) { nextSeats += seatEvery; await one("seats", p); }
      await sleep(Math.max(20, Math.min(nextCv, nextSeats) - Date.now()));
    }
  }));
  const q = (a, f) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(f * b.length))] : null; };
  const sum = {};
  for (const k of ["cv", "seats"]) sum[k] = { n: lat[k].length, p50: q(lat[k], 0.5), p95: q(lat[k], 0.95), p99: q(lat[k], 0.99), max: lat[k].length ? Math.max(...lat[k]) : null, status: st[k] };
  const bad = (k) => Object.entries(st[k]).filter(([c]) => c !== "200").reduce((a, [, n]) => a + n, 0);
  sum.errorRatePct = +(100 * (bad("cv") + bad("seats")) / Math.max(1, lat.cv.length + lat.seats.length)).toFixed(2);
  sum.players = ps.length; sum.seconds = secs;
  ctx.note("load", "summary", JSON.stringify(sum));
  try { mkdirSync(ctx.outDir, { recursive: true }); writeFileSync(join(ctx.outDir, `ladder-${ctx.runId}.json`), JSON.stringify(sum, null, 1)); } catch {}
  S.load = sum;
}

const phase = (ctx, text) => { ctx.say(`${ctx.runId}: ${text}`); };

export async function runJourney(ctx, game, o) {
  const S = C.newState(ctx, { players: o.players ?? 6, extraSlots: 30, callSeconds: o.callSeconds, play: "short", kind: "journey", leadSec: 3 * 86400, conc: 3 });
  ctx.S = S;
  try {
    phase(ctx, "journey: first look"); await C.guard(ctx, "organizer-first-look", () => C.stepFirstLook(ctx, S));
    phase(ctx, "journey: set-up");
    const ok = await C.guard(ctx, "setup", () => C.stepSetup(ctx, S, game));
    if (!ok) { S.outcome = "not-published"; return S; }
    if (game.afterSetup) await C.guard(ctx, "afterSetup", () => game.afterSetup(ctx, S));
    await C.guard(ctx, "join", () => C.stepJoinCrowd(ctx, S));
    await C.guard(ctx, "join-edge", () => C.stepJoinEdge(ctx, S));
    await C.guard(ctx, "families", () => C.stepFamilies(ctx, S));
    await C.guard(ctx, "people-list", () => C.stepPeopleWaiting(ctx, S));
    await C.guard(ctx, "host", () => C.stepTeam(ctx, S));
    await C.guard(ctx, "leave", () => C.stepLeaveRejoin(ctx, S, "before"));
    await C.guard(ctx, "announce", () => C.stepAnnounce(ctx, S));
    await C.guard(ctx, "retire", () => C.stepTeamRetire(ctx, S));
    await C.guard(ctx, "cancel", () => C.stepCancel(ctx, S));
    S.outcome = S.cancelled ? "cancelled" : "left-published";
  } finally { await cleanup(ctx, S); }
  return S;
}

export async function runFullGame(ctx, game, o) {
  const S = C.newState(ctx, { players: o.players, extraSlots: o.pollSecs ? Math.max(8, Math.min(Math.ceil(o.players * 0.1), 1000 - o.players)) : Math.max(12, Math.ceil(o.players * 0.1)), callSeconds: o.callSeconds, play: o.play, kind: "game", leadSec: o.leadSec, conc: o.conc ?? 6, runtime: o.runtime });
  ctx.S = S;
  try {
    phase(ctx, "first look"); await C.guard(ctx, "organizer-first-look", () => C.stepFirstLook(ctx, S));
    phase(ctx, "set-up (create, settings, publish, zero route)");
    const ok = await C.guard(ctx, "setup", () => C.stepSetup(ctx, S, game));
    if (!ok) { S.outcome = "not-published"; return S; }
    if (game.afterSetup) await C.guard(ctx, "afterSetup", () => game.afterSetup(ctx, S));
    phase(ctx, `joining ${S.P} people`); await C.guard(ctx, "join", () => C.stepJoinCrowd(ctx, S));
    await C.guard(ctx, "join-edge", () => C.stepJoinEdge(ctx, S));
    await C.guard(ctx, "families", () => C.stepFamilies(ctx, S));
    await C.guard(ctx, "people-list", () => C.stepPeopleWaiting(ctx, S));
    await C.guard(ctx, "host", () => C.stepTeam(ctx, S));
    await C.guard(ctx, "leave", () => C.stepLeaveRejoin(ctx, S, "before"));
    await C.guard(ctx, "announce", () => C.stepAnnounce(ctx, S));
    if (game.signedPause) await C.guard(ctx, "pause-resume", () => ensureControlKey(ctx, S.eid));
    if (game.preStart) await C.guard(ctx, "preStart", () => game.preStart(ctx, S));
    if (Date.now() > S.startMs - 5000) ctx.note("timeline", "late-for-start", `set-up finished ${Math.round((Date.now() - S.startMs) / 1000)} s after the planned start; raise --lead`);
    phase(ctx, "waiting for the start"); await C.untilMs(S.startMs - 20000, ctx);
    phase(ctx, "check-in"); await C.guard(ctx, "checkin", () => C.stepCheckin(ctx, S));
    await C.untilMs(S.startMs + 3 * S.callSeconds * 1000, ctx);
    if (o.pollSecs) { phase(ctx, `poll load ${S.P} players for ${o.pollSecs} s`); await C.guard(ctx, "load", () => pollLoad(ctx, S, o.pollSecs)); }
    phase(ctx, "claims"); if (game.claims) await C.guard(ctx, "claims", () => C.stepClaims(ctx, S, game.claims));
    else { game.absent = game.absent || {}; await C.guard(ctx, "claims", () => C.stepClaims(ctx, S, { valid: "early5", wrongPattern: "nonsense", maxIdx: 89, bogey: false })); }
    if (game.extra) { phase(ctx, "game-specific steps"); await C.guard(ctx, "game", () => game.extra(ctx, S)); }
    await C.guard(ctx, "leave", () => C.stepLeaveRejoin(ctx, S, "after"));
    await C.guard(ctx, "late-join", () => C.stepLate(ctx, S));
    await C.guard(ctx, "forgery", () => C.stepForgeries(ctx, S));
    phase(ctx, "pause and resume");
    if (game.pause) await C.guard(ctx, "pause-resume", () => game.pause(ctx, S)); else if (game.signedPause) await C.guard(ctx, "pause-resume", () => C.stepPauseResume(ctx, S));
    phase(ctx, "ending"); await C.guard(ctx, "end", () => C.stepEnd(ctx, S, game));
    if (game.finish) await C.guard(ctx, "finish", () => game.finish(ctx, S));
    await C.guard(ctx, "retire", () => C.stepTeamRetire(ctx, S));
    await C.guard(ctx, "report", () => C.stepReports(ctx, S));
    await C.guard(ctx, "erase", () => C.stepErase(ctx, S));
    S.outcome = S.ended ? "ended" : "ran-not-confirmed-ended";
  } finally { await cleanup(ctx, S); }
  return S;
}

/** If the run died before the game started, cancel it so it does not sit in the live gate; a started game ends and erases itself. */
async function cleanup(ctx, S) {
  try {
    // A run that ends early (ENV, cancel, crash) never reaches the normal retire step, and the site caps each organiser at 5 hosts: retire what this run made.
    if ((S.ids.host || S.ids.cohost) && !S.teamRetired) await C.stepTeamRetire(ctx, S);
    if (S.published && !S.cancelled && !S.ended && Date.now() < S.startMs - 30000) {
      await ctx.call("cleanup", "cancel-unfinished-run", "POST", `/api/z/${S.eid}/cancel`, { body: { confirmations: 3 }, expect: [200, 409, 404], tries: 1 });
      S.cancelled = true;
    }
  } catch { /* STOP file or network: the site's own 24 h erase still applies */ }
}
