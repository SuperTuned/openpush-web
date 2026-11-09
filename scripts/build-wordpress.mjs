// Builds dist/openpush-wordpress.zip: the WordPress plugin in integrations/wordpress/openpush,
// under one top folder `openpush/`, without its dev files (tests, Composer, vendor, lint config).
// Fails when the plugin's worker file is not the line the worker CLI writes for the OpenPush server.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { workerSource } from "../bin/openpush-web.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "integrations", "wordpress", "openpush");
const out = join(root, "dist", "openpush-wordpress.zip");

/** What goes in the zip; everything else in the folder is for development. */
const INCLUDE = ["openpush.php", "uninstall.php", "readme.txt", "LICENSE", "includes", "worker"];

export const DEFAULT_SERVER = "https://app.openpush.ai";

export function pluginFiles(dir = plugin) {
  const files = [];
  const walk = (path) => {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) walk(join(path, name));
    } else {
      files.push(relative(dir, path).split(sep).join("/"));
    }
  };
  for (const entry of INCLUDE) walk(join(dir, entry));
  return files;
}

export function checkWorker(dir = plugin) {
  const shipped = readFileSync(join(dir, "worker", "openpush-sw.js"), "utf8");
  const expected = workerSource(DEFAULT_SERVER);
  if (shipped !== expected) {
    throw new Error(`worker/openpush-sw.js must be exactly: ${expected.trim()}`);
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** A zip archive (deflate) of `entries`: [{name, data}]. */
export function zip(entries, date = new Date()) {
  const { time, day } = dosTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // -rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

export function buildZip(dir = plugin, target = out) {
  checkWorker(dir);
  const entries = pluginFiles(dir).map((name) => ({ name: `openpush/${name}`, data: readFileSync(join(dir, name)) }));
  const archive = zip(entries);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, archive);
  return { path: target, files: entries.length, bytes: archive.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildZip();
  console.log(`Wrote ${relative(root, result.path)}: ${result.files} files, ${(result.bytes / 1024).toFixed(1)} KB`);
}
