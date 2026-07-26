export function getSessionCookieOptions(req?: { protocol?: string }) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: req?.protocol === "https",
    path: "/",
  };
}
