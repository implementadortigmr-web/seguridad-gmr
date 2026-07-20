export function routeForRole(role) {
  if (role === "administrador") return "/admin";
  if (role === "supervisor") return "/supervisor";
  return "/guardia";
}
