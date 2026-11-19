import { idb } from "./idb";
import { validateProject, type ProjectSnapshot } from "./project";

export interface SavedVersion { id: string; label: string; savedAt: number; snapshot: ProjectSnapshot }
let queue = Promise.resolve();
const key = (projectId: string) => `versions:${projectId}`;
export async function listVersions(projectId: string): Promise<SavedVersion[]> {
  await queue.catch(() => {});
  return (await idb.get<SavedVersion[]>(key(projectId))) ?? [];
}
export function saveVersion(snapshot: ProjectSnapshot, label: string): Promise<SavedVersion> {
  const version: SavedVersion = { id: crypto.randomUUID(), label: label.trim().slice(0,80) || `版本 r${snapshot.sceneRevision}`, savedAt: Date.now(), snapshot: validateProject(snapshot) };
  const operation = queue.catch(() => {}).then(async () => {
    const old = (await idb.get<SavedVersion[]>(key(snapshot.projectId))) ?? [];
    await idb.set(key(snapshot.projectId), [version, ...old].slice(0,20));
    return version;
  });
  queue = operation.then(() => {}); return operation;
}
export function versionDiff(current: ProjectSnapshot, other: ProjectSnapshot) {
  const before = new Map(current.objects.map(o => [o.id,o])), after = new Map(other.objects.map(o=>[o.id,o]));
  const stable = (v: unknown): string => v === undefined ? "null" : Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>`${k}:${stable(x)}`).join(",")}}` : JSON.stringify(v);
  return { added: [...after.keys()].filter(id=>!before.has(id)).length, removed: [...before.keys()].filter(id=>!after.has(id)).length,
    changed: [...after].filter(([id,o])=>before.has(id)&&stable(o)!==stable(before.get(id))).length,
    relationsChanged: stable(current.relations)!==stable(other.relations), settingsChanged: stable(current.settings)!==stable(other.settings) };
}
