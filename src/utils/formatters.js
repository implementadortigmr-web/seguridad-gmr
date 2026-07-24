export function toDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "object" && typeof value.seconds === "number") {
    const date = new Date(value.seconds * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === "string") {
    const limpia = value.trim();

    if (!limpia || limpia.toLowerCase() === "invalid date") {
      return null;
    }

    const date = new Date(limpia);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

export function formatDate(value) {
  const date = toDate(value);

  if (!date) {
    return value && String(value).toLowerCase() !== "invalid date"
      ? String(value)
      : "Sin fecha";
  }

  return date.toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}