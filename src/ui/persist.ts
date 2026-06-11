import type { OperationState } from "../sim/operation";

// Operation checkpoint persistence (owner ruling: failure-forward needs saves).
// OperationState is plain serializable data, so this is a thin localStorage
// wrapper — saved at every Interlude and battle end; the sim stays storage-free.

const KEY = "vantage.operation.v1";

export function saveOperation(op: OperationState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(op));
  } catch {
    // Storage unavailable (private mode etc.) — the run simply isn't resumable.
  }
}

export function loadOperation(): OperationState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const op = JSON.parse(raw) as OperationState;
    // Checkpoints saved before trust existed (Horizon 2, D13) load neutral;
    // ones saved before the persistent enemy (H2) fall back to fresh-per-battle.
    op.trust = op.trust ?? {};
    op.trustNotes = op.trustNotes ?? [];
    op.enemy = op.enemy ?? [];
    op.records = op.records ?? {};
    return op;
  } catch {
    return null;
  }
}

export function clearOperation(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}
