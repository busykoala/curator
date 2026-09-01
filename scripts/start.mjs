import { spawn } from "node:child_process";

const children = new Set();
let stopping = false;
function launch(name, command, args, restart = false) {
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  children.add(child);
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (stopping) return;
    if (restart) {
      console.error(`${name} exited (${code ?? signal}); restarting in 2 seconds`);
      setTimeout(() => launch(name, command, args, true), 2_000);
      return;
    }
    stop(code ?? 1);
  });
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 8_000).unref();
}
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
launch("web", "./node_modules/.bin/next", ["start", "-H", "0.0.0.0", "-p", "3000"]);
launch("worker", "./node_modules/.bin/tsx", ["src/worker.ts"], true);
launch("acquisition", "./node_modules/.bin/tsx", ["src/acquisition-worker.ts"], true);
