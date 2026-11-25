/** Whole kilobytes from 1 to 256 as bytes, or null when the text is not one. */
export function totMemoryTidyMaxBytesFromKb(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const kb = Number(trimmed);
  return kb >= 1 && kb <= 256 ? kb * 1024 : null;
}
