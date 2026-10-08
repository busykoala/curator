import { NextRequest, NextResponse } from "next/server";
export function proxy(request: NextRequest) {
  const destination = request.nextUrl.pathname + request.nextUrl.search;
  if (!request.cookies.get("curator_session")) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", destination);
    return NextResponse.redirect(login);
  }
  const headers = new Headers(request.headers);
  headers.set("x-curator-destination", destination);
  return NextResponse.next({ request: { headers } });
}
export const config = {
  matcher: [
    "/home/:path*",
    "/library/:path*",
    "/playlists/:path*",
    "/add/:path*",
    "/requests/:path*",
    "/curator/:path*",
    "/settings/:path*",
  ],
};
