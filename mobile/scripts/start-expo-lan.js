#!/usr/bin/env node

const os = require("os");
const { spawn } = require("child_process");

function isPrivateIPv4(address) {
  if (!address || address === "127.0.0.1") return false;
  if (address.startsWith("10.")) return true;
  if (address.startsWith("192.168.")) return true;

  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function scoreInterface(name, address) {
  let score = 0;
  const normalized = name.toLowerCase();

  if (/^(en|eth|wlan|wi-?fi)/.test(normalized)) score += 40;
  if (normalized === "en0") score += 30;
  if (normalized === "en1") score += 20;
  if (/^(utun|awdl|llw|bridge|lo|docker|vbox|vmnet)/.test(normalized)) score -= 100;
  if (address.startsWith("192.168.")) score += 12;
  if (address.startsWith("10.")) score += 10;
  if (address.startsWith("172.")) score += 8;

  return score;
}

function findLanAddress() {
  const candidates = [];
  const interfaces = os.networkInterfaces();

  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (
        (entry.family !== "IPv4" && entry.family !== 4) ||
        entry.internal ||
        !isPrivateIPv4(entry.address)
      ) {
        continue;
      }

      candidates.push({
        name,
        address: entry.address,
        score: scoreInterface(name, entry.address),
      });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

const explicitHost = process.env.REACT_NATIVE_PACKAGER_HOSTNAME?.trim();
const selected = explicitHost
  ? { address: explicitHost, name: "REACT_NATIVE_PACKAGER_HOSTNAME" }
  : findLanAddress();

const env = { ...process.env };
if (selected?.address) {
  env.REACT_NATIVE_PACKAGER_HOSTNAME = selected.address;
  console.log(
    `Expo LAN host: ${selected.address}` +
      (selected.name ? ` (${selected.name})` : "")
  );
} else {
  console.warn(
    "Expo LAN host: no private IPv4 address found. Make sure Wi-Fi/LAN is connected."
  );
}

const expoCommand = process.platform === "win32" ? "expo.cmd" : "expo";
const extraArgs = process.argv.slice(2);
const usesDevClient = extraArgs.includes("--dev-client") || extraArgs.includes("-d");
const usesExpoGo = extraArgs.includes("--go") || extraArgs.includes("-g");
const launchModeArgs = usesDevClient || usesExpoGo ? [] : ["--go"];
const args = ["start", ...launchModeArgs, "--lan", ...extraArgs];
const child = spawn(expoCommand, args, {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code || 0);
});
