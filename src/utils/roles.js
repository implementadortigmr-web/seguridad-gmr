export function routeForRole(rol) {
  const normalizedRole = String(rol || "").trim().toLowerCase();

  if (normalizedRole === "administrador") return "/admin";
  if (normalizedRole === "supervisor") return "/supervisor";
  if (normalizedRole === "guardia") return "/guardia";

  return "/";
}