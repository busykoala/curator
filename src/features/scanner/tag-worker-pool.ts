import { Worker } from "node:worker_threads";
import { extname } from "node:path";
import { readNativeFlac } from "./native-flac";

type Metadata = { tags: Record<string, unknown>; properties: unknown; pictures: unknown[] };
type Task = { id: number; path: string; extra: string[]; resolve: (value: Metadata) => void; reject: (error: Error) => void };
type Slot = { worker: Worker; busy: boolean; taskId?: number };
type WorkerReply = { id: number; ok: boolean; metadata?: Metadata; error?: string };

const workerSource = `
const { parentPort } = require("node:worker_threads");
let taglib;
parentPort.on("message", async ({ id, path, extra }) => {
  try {
    taglib ||= await import("taglib-wasm/simple");
    const [tags, properties, pictures] = await Promise.all([
      taglib.readTags(path, { includeProperties: extra }),
      taglib.readProperties(path),
      taglib.readPictureMetadata(path),
    ]);
    const { pictures: _binaryPictures, ...portableTags } = tags;
    parentPort.postMessage({ id, ok: true, metadata: { tags: portableTags, properties, pictures } });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error?.stack || String(error) });
  }
});`;

export class TagWorkerPool {
  private nextId = 1;
  private readonly queue: Task[] = [];
  private readonly tasks = new Map<number, Task>();
  private readonly slots: Slot[];

  constructor(size = 2) {
    this.slots = Array.from({ length: size }, () => this.createSlot());
  }

  async read(path: string, extra: string[]): Promise<Metadata> {
    try { return await this.queuedRead(path, extra); }
    catch (error) { if (extname(path).toLowerCase() === ".flac") return readNativeFlac(path); throw error; }
  }

  private queuedRead(path: string, extra: string[]): Promise<Metadata> {
    return new Promise((resolve, reject) => {
      const task = { id: this.nextId++, path, extra, resolve, reject };
      this.tasks.set(task.id, task);
      this.queue.push(task);
      this.dispatch();
    });
  }

  async close(): Promise<void> {
    await Promise.all(this.slots.map((slot) => slot.worker.terminate()));
  }

  private createSlot(): Slot {
    const slot = { worker: new Worker(workerSource, { eval: true }), busy: false } as Slot;
    slot.worker.on("message", (reply: WorkerReply) => this.finish(slot, reply));
    slot.worker.on("error", (error) => this.fail(slot, error));
    return slot;
  }

  private dispatch(): void {
    for (const slot of this.slots) {
      const task = this.queue.shift();
      if (!task) return;
      if (slot.busy) { this.queue.unshift(task); continue; }
      slot.busy = true;
      slot.taskId = task.id;
      slot.worker.postMessage({ id: task.id, path: task.path, extra: task.extra });
    }
  }

  private finish(slot: Slot, reply: WorkerReply): void {
    const task = this.tasks.get(reply.id);
    if (task) {
      this.tasks.delete(reply.id);
      if (reply.ok && reply.metadata) task.resolve(reply.metadata);
      else task.reject(new Error(reply.error ?? "Tag worker failed"));
    }
    slot.busy = false;
    slot.taskId = undefined;
    this.dispatch();
  }

  private fail(slot: Slot, error: Error): void {
    if (slot.taskId) {
      this.tasks.get(slot.taskId)?.reject(error);
      this.tasks.delete(slot.taskId);
    }
    slot.busy = false;
    slot.taskId = undefined;
  }
}
