// ============================================================
//  Supervisor — never lets the bot stay dead.
//  - Forks src/index.js as a child process.
//  - On exit/crash/uncaught error: instantly respawns it.
//  - Exponential backoff capped at 5s so we never hammer Discord.
//  - Forwards SIGINT/SIGTERM cleanly so Ctrl-C still works.
//
//  Run with:   node src/supervisor.js
//  Or:         npm start
// ============================================================

const { fork } = require("child_process");
const path = require("path");

const ENTRY = path.join(__dirname, "index.js");
const MIN_DELAY_MS = 250;
const MAX_DELAY_MS = 5000;

let child = null;
let shuttingDown = false;
let restarts = 0;
let lastStartAt = 0;

function ts() { return new Date().toISOString().split("T")[1].slice(0, 12); }
function sup(msg, extra) {
  const tail = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`${ts()} [supervisor] ${msg}${tail}`);
}

function nextDelay() {
  // Reset backoff if the child stayed alive >30s
  const aliveFor = Date.now() - lastStartAt;
  if (aliveFor > 30_000) restarts = 0;
  const delay = Math.min(MAX_DELAY_MS, MIN_DELAY_MS * Math.pow(2, restarts));
  return delay;
}

function spawnChild() {
  if (shuttingDown) return;
  lastStartAt = Date.now();
  sup("starting bot", { entry: ENTRY, restarts });

  child = fork(ENTRY, [], {
    stdio: "inherit",
    env: { ...process.env, BOT_SUPERVISED: "1" },
  });

  child.on("exit", (code, signal) => {
    sup("bot exited", { code, signal });
    child = null;
    if (shuttingDown) return;
    restarts++;
    const delay = nextDelay();
    sup("respawn scheduled", { ms: delay });
    setTimeout(spawnChild, delay);
  });

  child.on("error", (err) => {
    sup("child error", { err: err?.message || String(err) });
  });
}

function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  sup("shutdown requested", { sig });
  if (child) {
    try { child.kill(sig === "SIGINT" ? "SIGINT" : "SIGTERM"); } catch {}
    setTimeout(() => {
      if (child) { try { child.kill("SIGKILL"); } catch {} }
      process.exit(0);
    }, 4000);
  } else {
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  sup("supervisor uncaught", { err: err?.message || String(err) });
});
process.on("unhandledRejection", (err) => {
  sup("supervisor unhandled rejection", { err: err?.message || String(err) });
});

spawnChild();
