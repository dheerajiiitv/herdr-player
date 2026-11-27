import { appHome, exec } from "herdr";
import * as fs from "fs/promises";
import { createHash, randomUUID } from "crypto";
import { Buffer } from "buffer";

const artTypes = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const cache = "data/music-deck/covers";

export async function findProgram(name) {
  // The mod filesystem is scoped to Herdr and the home directory. Resolve
  // system executables in the same local shell that will run the player.
  const result = await exec("/bin/sh", ["-c",
    'PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"; command -v "$1"', "music-ring", name]);
  return result.stdout.trim() || name;
}

export async function readTrack(player, withArtwork = false) {
  const args = ["get", "--now"];
  if (!withArtwork) args.push("--no-artwork");
  const result = await exec(player, args, { timeout: 4000 });
  if (result.code) throw Error(result.stderr || "Could not read Now Playing");
  return JSON.parse(result.stdout.trim() || "null");
}

export function identity(track) {
  if (!track) return "";
  return JSON.stringify([track.bundleIdentifier, track.contentItemIdentifier, track.title, track.artist, track.album]);
}

// A color image in Herdr can animate GIF frames; spin() only turns tinted SVGs.
// Prepare one small loop per distinct cover. GPUI plays it without JS redraws.
async function spinningCover(dir, hash, bytes, ext, encoder) {
  const fps = 30, seconds = 16;
  const file = hash + "-" + fps + "x" + seconds + ".gif";
  if (await fs.exists(dir + "/" + file)) return cache + "/" + file;
  const tmp = dir + "/work-" + randomUUID();
  const input = tmp + "." + ext, output = tmp + ".gif";
  const filter = [
    "crop='min(iw,ih)':'min(iw,ih)',scale=96:96,format=rgba",
    "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(hypot(X-47.5,Y-47.5),47.5),255,0)'",
    "split[base][still];[still]palettegen[p];[base]loop=loop=" + (fps * seconds - 1) + ":size=1:start=0",
    "setpts=N/(" + fps + "*TB),fps=" + fps + ",rotate=2*PI*t/" + seconds + ":c=none[turn];[turn][p]paletteuse=dither=bayer"
  ].join(",");
  try {
    await fs.writeFile(input, bytes);
    const r = await exec(encoder, ["-nostdin", "-loglevel", "error", "-framerate", String(fps), "-i", input,
      "-filter_complex", filter, "-loop", "0", "-t", String(seconds), output], { timeout: 20000 });
    if (r.code) return null;
    const move = await exec("/bin/mv", ["-f", output, dir + "/" + file]);
    return move.code ? null : cache + "/" + file;
  } catch { return null; }
  finally {
    for (const path of [input, output]) await fs.unlink(path).catch(() => {});
  }
}

export async function cacheCover(track, encoder) {
  const ext = artTypes[track?.artworkMimeType];
  if (!ext || !track.artworkData) return null;
  const bytes = Buffer.from(track.artworkData, "base64");
  if (!bytes.length) return null;
  const hash = createHash("sha256").update(bytes).digest("hex");
  const file = hash + ".svg";
  const dir = appHome() + "/" + cache;
  await fs.mkdir(dir, { recursive: true });
  if (!(await fs.exists(dir + "/" + file))) {
    // GPUI fits the whole raster in the box. Crop wide video covers before display.
    const uri = "data:" + track.artworkMimeType + ";base64," + bytes.toString("base64");
    const cover = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="96" height="96">' +
      '<defs><clipPath id="disc"><circle cx="48" cy="48" r="48"/></clipPath></defs>' +
      '<image width="96" height="96" preserveAspectRatio="xMidYMid slice" clip-path="url(#disc)" xlink:href="' + uri + '"/></svg>';
    await fs.writeFile(dir + "/" + file, cover);
  }
  const animated = encoder ? await spinningCover(dir, hash, bytes, ext, encoder) : null;
  // Retain at most sixteen covers and their animations across reloads.
  for (const other of await fs.readdir(dir)) {
    if (other !== file && cache + "/" + other !== animated &&
        other[0] === hash[0] && /^[0-9a-f]{64}(-[0-9]+x[0-9]+)?\.(jpg|png|webp|svg|gif)$/.test(other)) {
      await fs.unlink(dir + "/" + other).catch(() => {});
    }
  }
  return { still: cache + "/" + file, animated };
}
