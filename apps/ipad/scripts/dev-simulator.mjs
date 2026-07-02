import { execFileSync, spawn } from "node:child_process";

function listBootedSimulators() {
  const raw = execFileSync("xcrun", ["simctl", "list", "devices", "booted", "--json"], {
    encoding: "utf8"
  });
  const parsed = JSON.parse(raw);
  const devicesByRuntime = parsed.devices && typeof parsed.devices === "object" ? parsed.devices : {};
  return Object.values(devicesByRuntime)
    .flat()
    .filter((device) => device && device.state === "Booted" && device.isAvailable !== false);
}

function chooseSimulator(devices) {
  return devices.find((device) => String(device.name).toLowerCase().includes("ipad")) ?? devices[0] ?? null;
}

let device;
try {
  device = chooseSimulator(listBootedSimulators());
} catch (error) {
  console.error("Unable to inspect booted iOS simulators.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

if (!device) {
  console.error("No booted iOS simulator found. Start an iPad simulator, then rerun this command.");
  process.exit(1);
}

console.log(`Starting Tauri iOS dev on simulator: ${device.name}`);

const child = spawn("npm", ["run", "tauri:ios:dev", "--", device.name], {
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.exit(signal === "SIGINT" ? 130 : 1);
    return;
  }
  process.exit(code ?? 0);
});
