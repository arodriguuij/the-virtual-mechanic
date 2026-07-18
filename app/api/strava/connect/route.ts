import { NextRequest, NextResponse } from "next/server";

import { getStravaAuthorizeUrl, getStravaRedirectUri } from "@/lib/strava";

export async function GET(request: NextRequest) {
  const redirectUri = getStravaRedirectUri(request.url);
  return NextResponse.redirect(getStravaAuthorizeUrl(redirectUri));
}
