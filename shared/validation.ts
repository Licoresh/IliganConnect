const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const visibleText = /[^\s\p{Cf}\p{Cc}]/u;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export const SHORT_REASON_LIMIT = 500;

export function characterLimitHint(length: number, maximum: number) {
  if (length < maximum * 0.8) return "";
  const remaining = maximum - length;
  if (remaining === 0) return "Character limit reached";
  const count = Math.abs(remaining);
  return `${count.toLocaleString("en-US")} character${count === 1 ? "" : "s"} ${remaining > 0 ? "left" : "over the limit"}`;
}

export const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}";

export function textInputError(value: string, { min = 0, max = Infinity, required = false }: { min?: number; max?: number; required?: boolean } = {}) {
  if (value.length > max) return `Use no more than ${max} characters.`;
  if (controlCharacters.test(value)) return "Remove unsupported control characters and try again.";
  const text = value.trim();
  if (!visibleText.test(text)) return required || text.length > 0 ? "Enter text, not just spaces or invisible characters." : "";
  if (text.length < min) return `Use at least ${min} characters, excluding surrounding spaces.`;
  return "";
}

export function parseDecimal(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const result = typeof value === "string" && decimal.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isFinite(result) ? result : NaN;
}

export function emailInputError(value: string) {
  return value.trim().length <= 254 && !/[\p{Cc}\p{Cf}]/u.test(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? "" : "Enter a valid email address, such as name@example.com.";
}

export function passwordInputError(value: string, minimum = 1) {
  if (value.length < minimum) return `Use at least ${minimum} characters for the password.`;
  return value.length > 1024 ? "Use no more than 1024 characters for the password." : "";
}

export function imageHeaderError(bytes: Uint8Array, mime: string) {
  const starts = (signature: number[], offset = 0) => signature.every((value, index) => bytes[offset + index] === value);
  const valid = mime === "image/jpeg" ? starts([255, 216, 255])
    : mime === "image/png" ? starts([137, 80, 78, 71, 13, 10, 26, 10])
    : mime === "image/webp" && starts([82, 73, 70, 70]) && starts([87, 69, 66, 80], 8);
  return valid ? "" : "Choose a valid JPG, PNG, or WebP image. Renaming a file does not change its format.";
}
