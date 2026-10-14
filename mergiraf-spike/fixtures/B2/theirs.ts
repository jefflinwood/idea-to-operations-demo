import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export function load(path: string) {
  return readFile(path, "utf8");
}

export function save(path: string, text: string) {
  return text;
}

export function digest(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
