let counter = 0;

/** Locally unique id such as "cmp_lq3x9k_7". Good enough until the backend issues ids. */
export function createId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}
