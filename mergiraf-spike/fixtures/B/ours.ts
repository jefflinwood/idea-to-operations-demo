import { readFile } from "node:fs/promises";
import { join } from "node:path";

export function load(path: string) {
  return readFile(path, "utf8");
}

export function resolve(dir: string, name: string) {
  return join(dir, name);
}
