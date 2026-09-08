// Portable: uses the same Node executable that runs this script.
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

const serverFile = fileURLToPath(new URL("../cap_web/dev-server.mjs", import.meta.url));
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill();
}

async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error(`Port ${port} is unavailable. Stop its existing server first.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());

try {
  for (const port of [8000, 8001]) await checkPort(port);
  for (const port of [8000, 8001]) {
    const child = spawn(process.execPath, [serverFile, String(port), "127.0.0.1"], {
      stdio: "inherit", windowsHide: true,
    });
    children.push(child);
    child.once("error", (error) => { console.error(error.message); stop(1); });
    child.once("exit", (code) => { if (!stopping) stop(code || 1); });
  }
  console.log("User:   http://127.0.0.1:8000/?view=overview");
  console.log("Editor: http://127.0.0.1:8001/?mode=editor&screen=overview");
  console.log("Press Ctrl+C to stop both servers. No ESP32 or AI process is started by this launcher.");
} catch (error) {
  console.error(error.message);
  stop(1);
}
