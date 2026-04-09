type SupabaseCookieOptions = {
  path: string;
  sameSite: "lax" | "strict" | "none";
  httpOnly: boolean;
  secure: boolean;
};

export function resolveSupabaseServerCookieOptions(): SupabaseCookieOptions {
  return {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };
}
