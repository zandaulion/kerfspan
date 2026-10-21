export class JobCancelledError extends Error {
  constructor(message = "Processing cancelled") {
    super(message);
    this.name = "AbortError";
  }
}

export function isJobCancelled(error) {
  return error?.name === "AbortError";
}

/**
 * Finds each transferable ArrayBuffer in a structured worker result exactly
 * once. Geometry validation returns several large typed-array label maps; if
 * they are cloned by postMessage, mobile browsers briefly need enough memory
 * for both the worker and UI copies and can appear to hang at completion.
 */
export function collectTransferableBuffers(value) {
  const buffers = new Set();
  const visited = new Set();
  const visit = (entry) => {
    if (entry === null || typeof entry !== "object" || visited.has(entry)) return;
    visited.add(entry);
    if (entry instanceof ArrayBuffer) {
      buffers.add(entry);
      return;
    }
    if (ArrayBuffer.isView(entry)) {
      if (entry.buffer instanceof ArrayBuffer) buffers.add(entry.buffer);
      return;
    }
    if (entry instanceof Map) {
      for (const [key, mapValue] of entry) {
        visit(key);
        visit(mapValue);
      }
      return;
    }
    if (entry instanceof Set) {
      for (const setValue of entry) visit(setValue);
      return;
    }
    for (const child of Object.values(entry)) visit(child);
  };
  visit(value);
  return [...buffers];
}

/**
 * Runs one latest-wins module Worker job at a time. Terminating the Worker is
 * intentional: the geometry algorithms are CPU-bound and cannot observe an
 * AbortSignal while they own their thread. The monotonically increasing id is
 * a second fence against a result already queued for delivery when cancelled.
 */
export function createWorkerJobRunner({ workerUrl, createWorker } = {}) {
  if (!workerUrl) throw new TypeError("workerUrl is required");
  const workerFactory = createWorker ?? ((url) => new Worker(url, { type: "module" }));
  let generation = 0;
  let active = null;

  const stopActive = (message, { advanceGeneration = true } = {}) => {
    if (advanceGeneration) generation += 1;
    if (!active) return false;
    const stopped = active;
    active = null;
    stopped.worker.terminate();
    stopped.reject(new JobCancelledError(message));
    return true;
  };

  return {
    get active() {
      return Boolean(active);
    },

    get generation() {
      return generation;
    },

    cancel(message = "Processing cancelled; the current geometry was kept") {
      return stopActive(message);
    },

    run(type, payload, { onProgress, transfer = [] } = {}) {
      if (!type) return Promise.reject(new TypeError("Job type is required"));
      stopActive("Superseded by newer processing", { advanceGeneration: false });
      const id = ++generation;
      const worker = workerFactory(workerUrl);

      return new Promise((resolve, reject) => {
        const finish = (callback, value) => {
          if (!active || active.id !== id || id !== generation) return;
          active = null;
          worker.terminate();
          callback(value);
        };

        active = { id, worker, reject };
        worker.onmessage = (event) => {
          const message = event?.data ?? {};
          if (message.id !== id || id !== generation) return;
          if (message.kind === "progress") {
            onProgress?.(message.progress ?? {});
            return;
          }
          if (message.kind === "result") {
            finish(resolve, message.result);
            return;
          }
          if (message.kind === "error") {
            const error = new Error(message.error?.message || "Background processing failed");
            error.name = message.error?.name || "Error";
            error.stack = message.error?.stack || error.stack;
            finish(reject, error);
          }
        };
        worker.onerror = (event) => {
          const error = event?.error instanceof Error
            ? event.error
            : new Error(event?.message || "Background processing failed");
          finish(reject, error);
        };
        try {
          worker.postMessage({ id, type, payload }, transfer);
        } catch (error) {
          finish(reject, error);
        }
      });
    },
  };
}
