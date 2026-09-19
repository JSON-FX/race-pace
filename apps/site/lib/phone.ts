/** Formats Philippine mobile input without blocking partial typing. */
export function formatPhilippinePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";

  let national = digits;
  if (national.startsWith("63")) national = national.slice(2);
  else if (national.startsWith("0")) national = national.slice(1);

  national = national.slice(0, 10);
  const groups = [national.slice(0, 3), national.slice(3, 6), national.slice(6, 10)].filter(Boolean);
  return `+63${groups.length ? ` ${groups.join(" ")}` : ""}`;
}
