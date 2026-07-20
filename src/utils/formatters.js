export function formatDate(date) {
  if (!date) return "Sin registro";

  return new Date(date).toLocaleString("es-MX", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  return `${Math.round(bytes / 1024)} KB`;
}
