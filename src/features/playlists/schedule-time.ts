const timeZone = "Europe/Zurich";

function parts(date: Date) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(values.find((item) => item.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

function localToUtc(year: number, month: number, day: number, hour: number, minute: number) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const localGuess = parts(new Date(guess));
  const offset = Date.UTC(localGuess.year, localGuess.month - 1, localGuess.day, localGuess.hour, localGuess.minute) - guess;
  return new Date(guess - offset);
}

export function nextZurichRunSql(now = new Date()) {
  const local = parts(now);
  const targetDay = new Date(Date.UTC(local.year, local.month - 1, local.day + (local.hour * 60 + local.minute >= 270 ? 1 : 0)));
  return localToUtc(targetDay.getUTCFullYear(), targetDay.getUTCMonth() + 1, targetDay.getUTCDate(), 4, 30)
    .toISOString().slice(0, 19).replace("T", " ");
}
