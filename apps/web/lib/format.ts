/** Centavos to pesos. Shows decimals only when non-zero, so a clean amount
 *  reads ₱2,850 while a real platform fee reads ₱142.50. */
export function peso(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const pesos = abs / 100;
  const hasCents = abs % 100 !== 0;
  return `${sign}₱${pesos.toLocaleString(undefined, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export const fmtDate = (d: string): string =>
  new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
