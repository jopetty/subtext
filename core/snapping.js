export const GUIDE_POSITIONS = [1 / 3, 1 / 2, 2 / 3];
export const SNAP_IN = 0.021;
export const SNAP_OUT = 0.038;
export const ROTATE_SNAP_GUIDES = [0, 45, 90, 135, 180, 225, 270, 315];
export const ROTATE_SNAP_IN_DEG = 4;
export const ROTATE_SNAP_OUT_DEG = 9;

export function snapAxis(raw, currentSnap) {
  let snap = currentSnap;
  if (snap !== null && Math.abs(raw - snap) > SNAP_OUT) snap = null;
  if (snap === null) {
    snap = GUIDE_POSITIONS.find((guide) => Math.abs(raw - guide) < SNAP_IN) ?? null;
  }
  return { pos: snap ?? raw, snap };
}

export function getNearestRotationGuide(rawDeg, targetDeg) {
  const turns = Math.round((rawDeg - targetDeg) / 360);
  return targetDeg + turns * 360;
}

export function snapRotationDeg(rawDeg, currentSnapDeg) {
  let snap = currentSnapDeg;
  if (snap !== null && Math.abs(rawDeg - snap) > ROTATE_SNAP_OUT_DEG) snap = null;
  if (snap === null) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const guide of ROTATE_SNAP_GUIDES) {
      const candidate = getNearestRotationGuide(rawDeg, guide);
      const distance = Math.abs(rawDeg - candidate);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    if (nearestDistance <= ROTATE_SNAP_IN_DEG) snap = nearest;
  }
  return { deg: snap ?? rawDeg, snap };
}

export function getRotationSnapAxis(snapDeg) {
  if (snapDeg === null || snapDeg === undefined) return null;
  const normalized = ((snapDeg % 360) + 360) % 360;
  const snappedIndex = Math.round(normalized / 45) % 8;
  if (snappedIndex === 0 || snappedIndex === 4) return 'x';
  if (snappedIndex === 2 || snappedIndex === 6) return 'y';
  if (snappedIndex === 1 || snappedIndex === 5) return 'd1';
  return 'd2';
}
