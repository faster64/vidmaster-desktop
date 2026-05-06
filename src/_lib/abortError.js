export class AbortError extends Error {
  constructor(message = "Aborted") {
    super(message);
    this.name = "AbortError";
  }
}

export function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw new AbortError();
  }
}
