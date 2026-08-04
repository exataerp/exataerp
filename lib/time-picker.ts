export const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"))

export const MINUTES = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, "0"))

export function selectHour(value: string, hour: string): string {
  const [, minute = "00"] = value.split(":")
  return `${hour}:${minute}`
}

export function selectMinute(value: string, minute: string): string {
  const [hour] = value.split(":")
  return `${hour || "00"}:${minute}`
}
