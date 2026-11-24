const controlCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const visibleText = /[^\s\p{Cf}\p{Cc}]/u;
const decimal = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export const SHORT_REASON_LIMIT = 500;
export const MIN_PASSWORD_LENGTH = 15;
export const MIN_REGISTRATION_PASSWORD_LENGTH = MIN_PASSWORD_LENGTH;
export const EMAIL_OTP_LENGTH = 8;
export const EMAIL_OTP_EXPIRY_SECONDS = 3600;
export const EMAIL_RESEND_INTERVAL_SECONDS = 60;

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
  if (/(.)\1{29,}/su.test(text)) return "Avoid repeating the same character many times.";
  return "";
}

export function normalizePersonName(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function personNameInputError(value: string, required = false, max = 60) {
  if (value.length > max) return `Use no more than ${max} characters.`;
  const name = normalizePersonName(value);
  if (!name) return required ? "Enter a name." : "";
  return /^[\p{L}\p{M}]+\.?(?:[ '\u2019-][\p{L}\p{M}]+\.?)*$/u.test(name)
    ? ""
    : "Use letters, spaces, hyphens, or apostrophes. A final period is allowed for an initial.";
}

export function residentNamePartsError(firstName: string, middleName: string, lastName: string) {
  const firstProblem = personNameInputError(firstName, true);
  if (firstProblem) return `First name: ${firstProblem}`;
  const middleProblem = personNameInputError(middleName);
  if (middleProblem) return `Middle name: ${middleProblem}`;
  const lastProblem = personNameInputError(lastName, true);
  if (lastProblem) return `Last name: ${lastProblem}`;
  return textInputError([firstName, middleName, lastName].map(normalizePersonName).filter(Boolean).join(" "), { min: 2, max: 100, required: true });
}

export function residentDisplayName(firstName: string, middleName: string, lastName: string) {
  return [firstName, middleName, lastName].map(normalizePersonName).filter(Boolean).join(" ");
}

export function residentAgeError(value: string, required = false) {
  const age = value.trim();
  if (!age) return required ? "Enter your age." : "";
  if (!/^\d{1,3}$/.test(age)) return "Enter age as a whole number.";
  const parsed = Number(age);
  return parsed >= 1 && parsed <= 120 ? "" : "Enter an age from 1 to 120.";
}

export function parseDecimal(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const result = typeof value === "string" && decimal.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isFinite(result) ? result : NaN;
}

export function emailInputError(value: string) {
  const email = value.trim();
  const [local, ...domains] = email.split("@");
  const domain = domains.length === 1 ? domains[0] : "";
  const labels = domain.split(".");
  const localPartValid = local.length <= 64
    && /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local);
  const domainValid = labels.length >= 2
    && labels.every((part) => part.length >= 1 && part.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(part))
    && (labels.at(-1)?.length ?? 0) >= 2;
  return email.length <= 254 && !/[\s\p{Cc}\p{Cf}]/u.test(email) && localPartValid && domainValid
    ? ""
    : "Enter a valid email address, such as name@example.com.";
}

export function normalizePhilippineMobile(value: string): string | null {
  const input = value.trim();
  if (!input) return "";
  if (!/^[+\d\s().-]+$/.test(input)) return null;
  const digits = input.replace(/\D/g, "");
  const local = digits.startsWith("639") ? digits.slice(2) : digits.startsWith("09") ? digits.slice(1) : digits;
  return local.length === 10 && local.startsWith("9") ? `+63${local}` : null;
}

export function mobileInputError(value: string, required = false) {
  if (!value.trim()) return required ? "Enter a Philippine mobile number." : "";
  return normalizePhilippineMobile(value) ? "" : "Enter a valid Philippine mobile number, such as 0917 123 4567.";
}

export function addressInputError(value: string, { min = 0, max = 240, required = false }: { min?: number; max?: number; required?: boolean } = {}) {
  const textProblem = textInputError(value, { min, max, required });
  if (textProblem) return textProblem;
  return /[\p{Extended_Pictographic}\p{Cc}\p{Cf}]/u.test(value)
    ? "Remove emojis or invisible control characters from the address."
    : "";
}

export function numericInputError(value: string, { min = -Infinity, max = Infinity, required = false, decimal = false }: { min?: number; max?: number; required?: boolean; decimal?: boolean } = {}) {
  const input = value.trim();
  if (!input) return required ? "Enter a number." : "";
  const signed = min < 0 ? "[+-]?" : "";
  const pattern = decimal ? new RegExp(`^${signed}(?:\\d+(?:\\.\\d*)?|\\.\\d+)$`) : new RegExp(`^${signed}\\d+$`);
  if (!pattern.test(input)) return decimal ? "Enter a valid number." : "Enter a whole number.";
  const number = Number(input);
  if (!Number.isFinite(number)) return "Enter a finite number.";
  if (number < min || number > max) {
    if (Number.isFinite(min) && Number.isFinite(max)) return `Enter a number from ${min} to ${max}.`;
    if (Number.isFinite(min)) return `Enter a number of at least ${min}.`;
    if (Number.isFinite(max)) return `Enter a number no greater than ${max}.`;
  }
  return "";
}

export function dateInputError(value: string, required = false) {
  if (!value) return required ? "Choose a date." : "";
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/.exec(value);
  if (parts) {
    const [, yearText, monthText, dayText] = parts;
    const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
    if (date.getUTCFullYear() !== Number(yearText) || date.getUTCMonth() + 1 !== Number(monthText) || date.getUTCDate() !== Number(dayText)) return "Choose a valid date.";
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999
    ? ""
    : "Choose a valid date.";
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
