import { Matrix4, Object3D, Vector3, MathUtils } from 'three';
import { WGS84_ELLIPSOID } from '3d-tiles-renderer';

const _tmpMat = new Matrix4();

/** Convert geodetic (deg) + ellipsoidal height (m) to world space, via the tiles-group transform. */
export function geodeticToWorld(lat: number, lon: number, height: number, tilesGroup: Object3D, target = new Vector3()): Vector3 {
  WGS84_ELLIPSOID.getCartographicToPosition(lat * MathUtils.DEG2RAD, lon * MathUtils.DEG2RAD, height, target);
  target.applyMatrix4(tilesGroup.matrixWorld);
  return target;
}

/** Convert a world-space position back to geodetic degrees + height. */
export function worldToGeodetic(point: Vector3, tilesGroup: Object3D): { lat: number; lon: number; height: number } {
  const p = point.clone().applyMatrix4(_tmpMat.copy(tilesGroup.matrixWorld).invert());
  const res = { lat: 0, lon: 0, height: 0 };
  WGS84_ELLIPSOID.getPositionToCartographic(p, res);
  return { lat: res.lat * MathUtils.RAD2DEG, lon: res.lon * MathUtils.RAD2DEG, height: res.height };
}

/** Local East-North-Up frame matrix (local → world) centred at a geodetic point. +X East, +Y North, +Z Up. */
export function localEnuFrame(lat: number, lon: number, height: number, tilesGroup: Object3D, target = new Matrix4()): Matrix4 {
  const la = lat * MathUtils.DEG2RAD, lo = lon * MathUtils.DEG2RAD;
  const p = new Vector3();
  WGS84_ELLIPSOID.getCartographicToPosition(la, lo, height, p);
  const up = new Vector3(Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)).normalize();
  const east = new Vector3(-Math.sin(lo), Math.cos(lo), 0).normalize();
  const north = new Vector3().crossVectors(up, east).normalize();
  target.makeBasis(east, north, up);
  target.setPosition(p);
  target.premultiply(tilesGroup.matrixWorld);
  return target;
}

/** Meters per degree of latitude / longitude near a given latitude (spherical approx). */
export function metersPerDegree(lat: number): { mLat: number; mLon: number } {
  const r = lat * MathUtils.DEG2RAD;
  return {
    mLat: 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r),
    mLon: 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r),
  };
}

/** Horizontal distance (m) between two geodetic points (local planar approx). */
export function distMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const { mLat, mLon } = metersPerDegree((aLat + bLat) / 2);
  return Math.hypot((aLon - bLon) * mLon, (aLat - bLat) * mLat);
}
