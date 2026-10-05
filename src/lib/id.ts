let counter = 0;

/**
 * Unique id such as "cmp_lq3x9k_7_4f2a". Time + per-process counter + random suffix, so ids from
 * the browser and from separate server processes (restarts) never collide in the database.
 */
export function createId(prefix: string): string {
  counter += 1;
  const random = Math.floor(Math.random() * 0x100000).toString(36).padStart(4, '0');
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}${random}`;
}
