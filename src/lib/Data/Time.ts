/**
 * Haskell `Data.Time` (Calendar, Clock, LocalTime, Format) subset.
 *
 * `Day` is represented as an ISO-8601 date string `"YYYY-MM-DD"` (aeson's JSON encoding of
 * `Day`), so string comparison is chronological.
 *
 * `UTCTime` is represented as milliseconds since the Unix epoch.
 */
import { Just, Nothing, type Maybe } from "./Maybe";

export type Day = string;
export type UTCTime = number;

function pad(n: number, w: number): string {
  const s = String(Math.abs(n));
  return (n < 0 ? "-" : "") + s.padStart(w, "0");
}

export function fromGregorian(y: number, m: number, d: number): Day {
  // Clip as Haskell does.
  const mm = Math.min(12, Math.max(1, m));
  const dd = Math.min(gregorianMonthLength(y, mm), Math.max(1, d));
  return `${pad(y, 4)}-${pad(mm, 2)}-${pad(dd, 2)}`;
}
export function fromGregorianValid(y: number, m: number, d: number): Maybe<Day> {
  if (m < 1 || m > 12 || d < 1 || d > gregorianMonthLength(y, m)) return Nothing;
  return Just(fromGregorian(y, m, d));
}
export function toGregorian(day: Day): [number, number, number] {
  const m = /^(-?\d+)-(\d\d)-(\d\d)$/.exec(day);
  if (!m) throw new Error("Invalid Day: " + day);
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}
export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
export function gregorianMonthLength(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Modified Julian Day number (`toModifiedJulianDay`). */
export function toModifiedJulianDay(day: Day): number {
  const [y, m, d] = toGregorian(day);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 40587;
}
export function fromModifiedJulianDay(n: number): Day {
  const dt = new Date((n - 40587) * 86400000);
  return fromGregorian(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}
export function addDays(n: number, day: Day): Day {
  return fromModifiedJulianDay(toModifiedJulianDay(day) + n);
}
export function diffDays(a: Day, b: Day): number {
  return toModifiedJulianDay(a) - toModifiedJulianDay(b);
}
export function addGregorianMonthsClip(n: number, day: Day): Day {
  const [y, m, d] = toGregorian(day);
  const total = y * 12 + (m - 1) + n;
  return fromGregorian(Math.floor(total / 12), (total % 12 + 12) % 12 + 1, d);
}
export function addGregorianYearsClip(n: number, day: Day): Day {
  return addGregorianMonthsClip(12 * n, day);
}
/** Day of week, Monday = 1 .. Sunday = 7 (as in `toWeekDate`). */
export function dayOfWeek(day: Day): number {
  const [y, m, d] = toGregorian(day);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}
/** `toWeekDate`: ISO week date (year, week, day-of-week). */
export function toWeekDate(day: Day): [number, number, number] {
  const [y, m, d] = toGregorian(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  const dow = dayOfWeek(day);
  date.setUTCDate(date.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return [date.getUTCFullYear(), week, dow];
}

/** The current date in the local time zone. */
export function today(): Day {
  const d = new Date();
  return fromGregorian(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
export function getCurrentTime(): UTCTime {
  return Date.now();
}
export function utctDay(t: UTCTime): Day {
  const d = new Date(t);
  return fromGregorian(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}
/** POSIX seconds. */
export function utcTimeToPOSIXSeconds(t: UTCTime): number {
  return t / 1000;
}
export function posixSecondsToUTCTime(s: number): UTCTime {
  return s * 1000;
}

export const monthNames = [
  "January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December",
];
export const monthAbbrevs = monthNames.map((m) => m.slice(0, 3));
export const dayNames = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const dayAbbrevs = dayNames.map((d) => d.slice(0, 3));

interface DateTimeParts {
  y: number; m: number; d: number; H: number; M: number; S: number; dow: number;
}

function partsOfDay(day: Day): DateTimeParts {
  const [y, m, d] = toGregorian(day);
  return { y, m, d, H: 0, M: 0, S: 0, dow: dayOfWeek(day) };
}
function partsOfTime(t: UTCTime, local: boolean): DateTimeParts {
  const dt = new Date(t);
  if (local) {
    const w = dt.getDay();
    return {
      y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(),
      H: dt.getHours(), M: dt.getMinutes(), S: dt.getSeconds(), dow: w === 0 ? 7 : w,
    };
  }
  const w = dt.getUTCDay();
  return {
    y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(),
    H: dt.getUTCHours(), M: dt.getUTCMinutes(), S: dt.getUTCSeconds(), dow: w === 0 ? 7 : w,
  };
}

function formatParts(fmt: string, p: DateTimeParts): string {
  let out = "";
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== "%") {
      out += c;
      continue;
    }
    let flag = "";
    let k = fmt[++i];
    if (k === "-" || k === "_" || k === "0" || k === "^" || k === "#") {
      flag = k;
      k = fmt[++i];
    }
    const num = (n: number, w: number, defPad: "0" | " " = "0") => {
      if (flag === "-") return String(n);
      if (flag === "_") return String(n).padStart(w, " ");
      if (flag === "0") return String(n).padStart(w, "0");
      return String(n).padStart(w, defPad);
    };
    const txt = (s: string) => (flag === "^" ? s.toUpperCase() : flag === "#" ? s.toLowerCase() : s);
    switch (k) {
      case "%": out += "%"; break;
      case "Y": out += String(p.y); break;
      case "y": out += num(p.y % 100, 2); break;
      case "C": out += num(Math.floor(p.y / 100), 2); break;
      case "m": out += num(p.m, 2); break;
      case "d": out += num(p.d, 2); break;
      case "e": out += num(p.d, 2, " "); break;
      case "B": out += txt(monthNames[p.m - 1]); break;
      case "b": case "h": out += txt(monthAbbrevs[p.m - 1]); break;
      case "A": out += txt(dayNames[p.dow - 1]); break;
      case "a": out += txt(dayAbbrevs[p.dow - 1]); break;
      case "u": out += String(p.dow); break;
      case "w": out += String(p.dow % 7); break;
      case "j": {
        const doy = diffDays(fromGregorian(p.y, p.m, p.d), fromGregorian(p.y, 1, 1)) + 1;
        out += num(doy, 3);
        break;
      }
      case "F": out += `${pad(p.y, 4)}-${pad(p.m, 2)}-${pad(p.d, 2)}`; break;
      case "D": out += `${pad(p.m, 2)}/${pad(p.d, 2)}/${pad(p.y % 100, 2)}`; break;
      case "x": out += `${pad(p.m, 2)}/${pad(p.d, 2)}/${pad(p.y % 100, 2)}`; break;
      case "H": out += num(p.H, 2); break;
      case "k": out += num(p.H, 2, " "); break;
      case "I": out += num(((p.H + 11) % 12) + 1, 2); break;
      case "l": out += num(((p.H + 11) % 12) + 1, 2, " "); break;
      case "M": out += num(p.M, 2); break;
      case "S": out += num(p.S, 2); break;
      case "p": out += p.H < 12 ? "AM" : "PM"; break;
      case "P": out += p.H < 12 ? "am" : "pm"; break;
      case "R": out += `${pad(p.H, 2)}:${pad(p.M, 2)}`; break;
      case "T": case "X": out += `${pad(p.H, 2)}:${pad(p.M, 2)}:${pad(p.S, 2)}`; break;
      case "c": out += `${dayAbbrevs[p.dow - 1]} ${monthAbbrevs[p.m - 1]} ${num(p.d, 2, " ")} ${pad(p.H, 2)}:${pad(p.M, 2)}:${pad(p.S, 2)} UTC ${p.y}`; break;
      case "Z": out += "UTC"; break;
      case "z": out += "+0000"; break;
      default: out += "%" + flag + (k ?? "");
    }
  }
  return out;
}

/** `formatTime defaultTimeLocale fmt day` for a `Day`. */
export function formatDay(fmt: string, day: Day): string {
  return formatParts(fmt, partsOfDay(day));
}
/** `formatTime defaultTimeLocale fmt t` for a `UTCTime` (formatted in UTC). */
export function formatUTCTime(fmt: string, t: UTCTime): string {
  return formatParts(fmt, partsOfTime(t, false));
}
/** As `formatUTCTime` but in the local time zone (`ZonedTime` / `LocalTime`). */
export function formatLocalTime(fmt: string, t: UTCTime): string {
  return formatParts(fmt, partsOfTime(t, true));
}

/**
 * `parseTimeM True defaultTimeLocale fmt str :: Maybe Day`. Supports the directives used by
 * HADES: %Y %y %C %m %d %e %B %b %h %a %A %j %F and literal text. `%c` is treated as a
 * two-digit century-relative year as in the Haskell date formats.
 */
export function parseDay(fmt: string, str: string): Maybe<Day> {
  let s = str.trim();
  let y: number | null = null, m: number | null = null, d: number | null = null;
  let century: number | null = null, yy: number | null = null;
  const takeNum = (maxLen: number): number | null => {
    const mm = new RegExp(`^[+-]?\\d{1,${maxLen}}`).exec(s);
    if (!mm) return null;
    s = s.slice(mm[0].length);
    return parseInt(mm[0], 10);
  };
  const takeName = (names: string[]): number | null => {
    const lower = s.toLowerCase();
    // Longest match first.
    let best = -1, bestLen = 0;
    names.forEach((n, i) => {
      if (lower.startsWith(n.toLowerCase()) && n.length > bestLen) {
        best = i;
        bestLen = n.length;
      }
    });
    if (best < 0) return null;
    s = s.slice(bestLen);
    return best;
  };
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c === "%") {
      let k = fmt[++i];
      if (k === "-" || k === "_" || k === "0" || k === "^" || k === "#") k = fmt[++i];
      switch (k) {
        case "Y": { const n = takeNum(9); if (n === null) return Nothing; y = n; break; }
        case "y": { const n = takeNum(2); if (n === null) return Nothing; yy = n; break; }
        case "C": { const n = takeNum(2); if (n === null) return Nothing; century = n; break; }
        case "c": { const n = takeNum(2); if (n === null) return Nothing; yy = n; break; }
        case "m": { const n = takeNum(2); if (n === null) return Nothing; m = n; break; }
        case "d": case "e": { s = s.replace(/^ +/, ""); const n = takeNum(2); if (n === null) return Nothing; d = n; break; }
        case "B": { const n = takeName(monthNames); if (n === null) return Nothing; m = n + 1; break; }
        case "b": case "h": { const n = takeName(monthAbbrevs); if (n === null) return Nothing; m = n + 1; break; }
        case "A": { if (takeName(dayNames) === null) return Nothing; break; }
        case "a": { if (takeName(dayAbbrevs) === null) return Nothing; break; }
        case "F": {
          const mm = /^(\d{1,9})-(\d{1,2})-(\d{1,2})/.exec(s);
          if (!mm) return Nothing;
          y = +mm[1]; m = +mm[2]; d = +mm[3];
          s = s.slice(mm[0].length);
          break;
        }
        case "%": if (s[0] !== "%") return Nothing; s = s.slice(1); break;
        default: return Nothing;
      }
    } else if (/\s/.test(c)) {
      s = s.replace(/^\s*/, "");
    } else {
      if (s[0] !== c) return Nothing;
      s = s.slice(1);
    }
  }
  if (s.trim().length > 0) return Nothing;
  if (y === null) {
    if (yy !== null) y = (century ?? (yy < 69 ? 20 : 19)) * 100 + yy;
    else y = 1970;
  }
  return fromGregorianValid(y, m ?? 1, d ?? 1);
}

/** `show` of a Day (ISO format). */
export function showDay(day: Day): string {
  return day;
}

/** Validate an ISO day string (aeson's FromJSON Day). */
export function readDay(s: string): Maybe<Day> {
  const m = /^(-?\d{4,})-(\d\d)-(\d\d)$/.exec(s);
  if (!m) return Nothing;
  return fromGregorianValid(+m[1], +m[2], +m[3]);
}
