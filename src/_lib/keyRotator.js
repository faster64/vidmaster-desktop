export class AllKeysExhausted extends Error {
  constructor(message = "All keys are on cooldown") {
    super(message);
    this.name = "AllKeysExhausted";
  }
}

export class KeyRotator {
  constructor(keys) {
    this.keys = [...(keys || [])];
    this.cooldownUntil = new Map();
    this.cursor = 0;
  }

  next() {
    const n = this.keys.length;
    if (n === 0) throw new AllKeysExhausted();
    const now = Date.now();
    for (let i = 0; i < n; i++) {
      const k = this.keys[(this.cursor + i) % n];
      const cd = this.cooldownUntil.get(k) || 0;
      if (cd <= now) {
        this.cursor = (this.cursor + i + 1) % n;
        return k;
      }
    }
    throw new AllKeysExhausted();
  }

  markCooldown(key, durationMs) {
    this.cooldownUntil.set(key, Date.now() + durationMs);
  }
}
