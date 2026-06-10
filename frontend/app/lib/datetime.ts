/**
 * Helper datetime condivisi — convenzione del progetto: datetime "naive" in ora LOCALE.
 *
 * Il backend (planner, DB) salva e restituisce datetime senza timezone interpretati
 * come ora locale dell'utente. Usare SEMPRE questi helper al posto di
 * `toISOString()`, che converte in UTC e introduce shift di giorno/ora
 * per gli utenti in fusi diversi da UTC (es. Italia, UTC+1/+2).
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Data locale "YYYY-MM-DD" (equivalente locale di toISOString().slice(0,10)). */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Datetime locale "YYYY-MM-DDTHH:mm" — formato per input type="datetime-local". */
export function localDatetimeStr(d: Date = new Date()): string {
  return `${localDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Datetime locale "YYYY-MM-DDTHH:mm:ss" — formato naive da inviare alle API. */
export function localDatetimeApiStr(d: Date = new Date()): string {
  return `${localDatetimeStr(d)}:${pad(d.getSeconds())}`;
}

/**
 * Converte il valore di un input datetime-local ("YYYY-MM-DDTHH:mm")
 * nel formato naive accettato dalle API ("YYYY-MM-DDTHH:mm:ss"),
 * senza alcuna conversione di fuso orario.
 */
export function datetimeLocalToApi(value: string): string | null {
  if (!value) return null;
  return value.length === 16 ? `${value}:00` : value;
}
