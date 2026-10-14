import { readFile } from "node:fs/promises";

export function load(path: string) {
  return readFile(path, "utf8");
}

export function save(path: string, text: string) {
  return text;
}
