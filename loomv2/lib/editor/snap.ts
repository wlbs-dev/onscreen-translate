// lib/editor/snap.ts
// Timeline snapping: pull dragged clip edges onto nearby targets.

/** Snap distance in screen pixels; converted to seconds at the current zoom */
export const SNAP_PX = 8

/**
 * Find the closest (point, target) pair within `threshold` seconds.
 * Returns the delta to add to every dragged point, and the target it lands on.
 */
export function findSnap(
  points: number[], targets: number[], threshold: number,
): { delta: number; target: number } | null {
  let best: { delta: number; target: number } | null = null
  for (const p of points) {
    for (const t of targets) {
      const d = t - p
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta)))
        best = { delta: d, target: t }
    }
  }
  return best
}
