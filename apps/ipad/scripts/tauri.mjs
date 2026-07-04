import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(scriptPath), "..");
const rustupBin = path.join(homedir(), ".cargo", "bin");
const env = {
  ...process.env,
  PATH: existsSync(rustupBin) ? `${rustupBin}:${process.env.PATH ?? ""}` : process.env.PATH
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    env,
    stdio: "inherit",
    ...options
  });
  if (result.error) {
    throw result.error;
  }
  if (result.signal) {
    process.exit(result.signal === "SIGINT" ? 130 : 1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function read(command, args) {
  const result = spawnSync(command, args, {
    cwd: appRoot,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
}

function parseRunArgs(args) {
  const buildArgs = ["ios", "build", "--export-method", "debugging"];
  const appArgs = [];
  let device = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--") {
      appArgs.push(...args.slice(index + 1));
      break;
    }
    if (arg === "--no-watch" || arg === "--release" || arg === "-r") {
      continue;
    }
    if (arg === "--additional-watch-folders") {
      index += 1;
      continue;
    }
    if (arg === "-f" || arg === "--features" || arg === "-c" || arg === "--config") {
      buildArgs.push(arg, args[index + 1]);
      index += 1;
      continue;
    }
    if (
      arg.startsWith("--features=") ||
      arg.startsWith("--config=") ||
      arg === "--ignore-version-mismatches"
    ) {
      buildArgs.push(arg);
      continue;
    }
    if (arg === "-v" || arg === "--verbose" || arg === "-vv") {
      continue;
    }
    if (arg === "-o" || arg === "--open") {
      run("tauri", ["ios", "run", ...args]);
      process.exit(0);
    }
    if (arg.startsWith("-")) {
      console.error(`Unsupported ios run option for the local workaround: ${arg}`);
      process.exit(1);
    }
    if (!device) {
      device = arg;
      continue;
    }
    appArgs.push(arg);
  }

  return { appArgs, buildArgs, device };
}

function findDevice() {
  const outputDir = mkdtempSync(path.join(tmpdir(), "tikz-ipad-devices-"));
  const outputPath = path.join(outputDir, "devices.json");
  try {
    run("xcrun", ["devicectl", "list", "devices", "--json-output", outputPath, "--timeout", "20"], {
      stdio: "ignore"
    });
    const parsed = JSON.parse(readFileSync(outputPath, "utf8"));
    const devices = Array.isArray(parsed.result?.devices) ? parsed.result.devices : [];
    const available = devices.filter(
      (device) =>
        device.connectionProperties?.pairingState === "paired" &&
        device.deviceProperties?.bootState === "booted" &&
        device.hardwareProperties?.platform === "iOS"
    );
    const selected =
      available.find((device) => device.hardwareProperties?.deviceType === "iPad") ?? available[0];

    if (!selected) {
      console.error("No connected, paired, booted iOS device found.");
      process.exit(1);
    }

    const name = selected.deviceProperties?.name ?? selected.identifier;
    console.log(`Using iOS device: ${name}`);
    return selected.identifier;
  } finally {
    rmSync(outputDir, { force: true, recursive: true });
  }
}

function extractApp(ipaPath) {
  const tempDir = mkdtempSync(path.join(tmpdir(), "tikz-ipad-run-"));
  run("ditto", ["-x", "-k", ipaPath, tempDir]);

  const payloadDir = path.join(tempDir, "Payload");
  const appName = readdirSync(payloadDir).find((entry) => entry.endsWith(".app"));
  if (!appName) {
    console.error(`No .app bundle found in ${ipaPath}`);
    process.exit(1);
  }

  return { appPath: path.join(payloadDir, appName), tempDir };
}

function bundleIdentifier(appPath) {
  return read("plutil", ["-extract", "CFBundleIdentifier", "raw", "-o", "-", path.join(appPath, "Info.plist")]);
}

function runIosDevice(args) {
  if (args.includes("-h") || args.includes("--help") || args.includes("-V") || args.includes("--version")) {
    run("tauri", ["ios", "run", ...args]);
    return;
  }

  const { appArgs, buildArgs, device } = parseRunArgs(args);

  run("tauri", buildArgs);

  const ipaPath = path.join(appRoot, "src-tauri", "gen", "apple", "build", "arm64", "TikZ Editor.ipa");
  if (!existsSync(ipaPath)) {
    console.error(`Expected IPA was not created: ${ipaPath}`);
    process.exit(1);
  }

  const deviceId = device ?? findDevice();
  const { appPath, tempDir } = extractApp(ipaPath);
  try {
    const bundleId = bundleIdentifier(appPath);
    run("xcrun", ["devicectl", "device", "install", "app", "--device", deviceId, appPath]);
    run("xcrun", [
      "devicectl",
      "device",
      "process",
      "launch",
      "--device",
      deviceId,
      "--terminate-existing",
      bundleId,
      ...appArgs
    ]);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

const args = process.argv.slice(2);
if (args[0] === "ios" && args[1] === "run") {
  runIosDevice(args.slice(2));
} else {
  run("tauri", args);
}
