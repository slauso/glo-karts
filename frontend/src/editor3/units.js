/**
 * units.js — Explicit world-unit semantics for the Track Studio.
 *
 * After the unit unification, **1 world unit = 1 millimetre** everywhere
 * (rendering, physics, decor sizing, camera framing, fog, shadows, etc.).
 *
 * Existing geometry in segments.js and road-geometry.js is still AUTHORED
 * in metres (TILE = 12 m, ROAD_THICK = 0.5 m, WALL_HEIGHT = 1.6 m, etc.).
 * That authored geometry is converted to world units at the rendering /
 * physics boundary by multiplying with `WORLD_UNITS_PER_M`. This keeps
 * the segment definitions readable while making the rest of the pipeline
 * agree on a single unit system.
 */

/** 1 world unit equals this many millimetres. By definition: 1. */
export const WORLD_UNITS_PER_MM = 1;

/** Conversion factors. */
export const MM_PER_M = 1000;
export const MM_PER_CM = 10;

/** Multiply authored-in-metres values by this to get world units. */
export const WORLD_UNITS_PER_M = MM_PER_M * WORLD_UNITS_PER_MM; // = 1000

/** Helper: take a value expressed in millimetres → world units. */
export const mm = (n) => n * WORLD_UNITS_PER_MM;
/** Helper: take a value expressed in centimetres → world units. */
export const cm = (n) => n * MM_PER_CM * WORLD_UNITS_PER_MM;
/** Helper: take a value expressed in metres → world units. */
export const m = (n) => n * WORLD_UNITS_PER_M;

/** Earth gravity expressed in world units / s² (≈9810 mm/s²). */
export const GRAVITY = m(9.81);
