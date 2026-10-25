import { NextRequest } from "next/server";

import { failFromError, ok } from "@/lib/api-response";
import { getGuestSessionManager, guestCookieName, guestNoStore, readGuestJson } from "@/lib/guest-session";

export async function POST(request: NextRequest) {
  try {
    const result = getGuestSessionManager().bootstrap(request, await readGuestJson(request));
    const response = ok(result.data);
    if (result.cookieCredential) response.cookies.set(guestCookieName(), result.cookieCredential, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: result.maxAge,
    });
    return guestNoStore(response);
  } catch (error) {
    return guestNoStore(failFromError(error));
  }
}

export async function DELETE(request: NextRequest) {
  try {
    return guestNoStore(ok(getGuestSessionManager().revoke(request, await readGuestJson(request))));
  } catch (error) {
    return guestNoStore(failFromError(error));
  }
}
