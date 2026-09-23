const ABC = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateCode(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ABC[b % ABC.length]).join("");
}

export function normalizeCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[^A-Z]/g, "");
  if (code.length !== 4) return null;
  return code;
}
