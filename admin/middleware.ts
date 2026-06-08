import { NextResponse } from "next/server";
import { auth } from "./lib/auth";

// Route-level RBAC enforcement (not just UI hiding). Runs on every dashboard
// request: no session -> /login, candidate role -> /unauthorized, otherwise
// allow admins/superadmins through. `/login`, `/unauthorized`, and the
// NextAuth API routes are excluded via the matcher so the auth flow itself
// is never blocked.
export default auth((req) => {
  const { nextUrl, auth: session } = req;

  if (!session) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  if (session.user?.role === "candidate") {
    return NextResponse.redirect(new URL("/unauthorized", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!api/auth|login|unauthorized|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
