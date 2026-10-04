/**
 * Folds text for search: Turkish-aware lowercase, then diacritics removed, so
 * "Istanbul", "İSTANBUL" and "istanbul" all match "İstanbul", and "sisli" matches "Şişli".
 */
export function foldForSearch(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function compareTr(a: string, b: string): number {
  return a.localeCompare(b, 'tr-TR', { sensitivity: 'base' });
}
