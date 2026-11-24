export function homePathFor(
  user: { tenant_mode?: string | null } | null | undefined,
): string {
  return user?.tenant_mode === "personal" ? "/personal" : "/dashboard";
}
