import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function writeJson(path: string, value: unknown): Promise<string> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return target;
}

export async function readJson<T>(path: string): Promise<T> {
  const raw = await readFile(resolve(path), "utf8");
  return JSON.parse(raw) as T;
}

export async function readText(path: string): Promise<string> {
  return readFile(resolve(path), "utf8");
}

export async function writeText(path: string, value: string): Promise<string> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, value, "utf8");
  return target;
}

export async function writeDataUrl(path: string, dataUrl: string): Promise<string> {
  const target = resolve(path);
  const [, data] = dataUrl.split(",", 2);
  if (!data) {
    throw new Error("INTERNAL_ERROR: dataUrl 格式不正确");
  }
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(data, "base64"));
  return target;
}

export function safeName(value: string): string {
  return value
    .replace(/[/:\\]/g, "-")
    .replace(/[^\p{L}\p{N}._ -]+/gu, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "qa-run";
}

export function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
