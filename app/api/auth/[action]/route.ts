/**
 * Dashboard sign-in through Amazon Cognito (USER_PASSWORD_AUTH over TLS on the
 * server). The refresh token is kept in an httpOnly cookie scoped to /api/auth;
 * the page receives only the short-lived access and ID tokens.
 *
 * POST /api/auth/sign-in   { email, password }
 * POST /api/auth/sign-up   { email, password }
 * POST /api/auth/confirm   { email, code }
 * POST /api/auth/resend    { email }
 * POST /api/auth/refresh
 * POST /api/auth/sign-out
 */
import { cookies } from "next/headers";
import { CognitoError, type CognitoTokens, cognito, liveConfig } from "@/lib/live/server";

const COOKIE = "aeroscope_rt";
const REFRESH_DAYS = 30;

type Body = { email?: unknown; password?: unknown; code?: unknown };

const fail = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

function email(v: unknown): string | null {
  return typeof v === "string" && /^[^\s@]{1,64}@[^\s@]{1,255}$/.test(v.trim()) ? v.trim().toLowerCase() : null;
}

async function setRefreshCookie(value: string, secure: boolean) {
  (await cookies()).set(COOKIE, value, { httpOnly: true, secure, sameSite: "strict", path: "/api/auth", maxAge: REFRESH_DAYS * 86_400 });
}

function session(tokens: { accessToken: string; idToken: string; expiresIn: number }) {
  return Response.json(tokens, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const config = await liveConfig();
  if (config.mode === "off") return fail(503, "Live mode is not configured (set AEROSCOPE_API_URL).");
  const secure = new URL(request.url).protocol === "https:";
  let body: Body = {};
  if (action !== "refresh" && action !== "sign-out") {
    try {
      body = (await request.json()) as Body;
    } catch {
      return fail(400, "Body must be JSON");
    }
  }

  // Local dev server: no Cognito. Tokens are `dev.<slug>` and identify, not authenticate.
  if (config.mode === "dev") {
    const store = await cookies();
    if (action === "sign-in" || action === "sign-up") {
      const res = await fetch(`${config.apiUrl}/dev/sign-in`, { method: "POST", body: JSON.stringify({ email: email(body.email) ?? "demo" }) });
      const dev = (await res.json()) as { token: string };
      await setRefreshCookie(dev.token, secure);
      return session({ accessToken: dev.token, idToken: dev.token, expiresIn: 86_400 });
    }
    if (action === "refresh") {
      const token = store.get(COOKIE)?.value;
      return token ? session({ accessToken: token, idToken: token, expiresIn: 86_400 }) : fail(401, "Not signed in");
    }
    if (action === "sign-out") {
      store.delete({ name: COOKIE, path: "/api/auth" });
      return Response.json({ signedOut: true });
    }
    return Response.json({ confirmed: true });
  }

  const region = config.client!.region;
  const clientId = config.client!.cognito.webClientId;
  try {
    switch (action) {
      case "sign-in": {
        const e = email(body.email);
        if (!e || typeof body.password !== "string") return fail(400, "Enter your email and password.");
        const res = await cognito<{ AuthenticationResult?: CognitoTokens; ChallengeName?: string }>(region, "InitiateAuth", {
          AuthFlow: "USER_PASSWORD_AUTH",
          ClientId: clientId,
          AuthParameters: { USERNAME: e, PASSWORD: body.password },
        });
        if (!res.AuthenticationResult) return fail(400, `Additional sign-in step required (${res.ChallengeName ?? "unknown"}).`);
        const t = res.AuthenticationResult;
        if (t.RefreshToken) await setRefreshCookie(t.RefreshToken, secure);
        return session({ accessToken: t.AccessToken, idToken: t.IdToken, expiresIn: t.ExpiresIn });
      }
      case "sign-up": {
        const e = email(body.email);
        if (!e || typeof body.password !== "string") return fail(400, "Enter an email and a password.");
        await cognito(region, "SignUp", { ClientId: clientId, Username: e, Password: body.password, UserAttributes: [{ Name: "email", Value: e }] });
        return Response.json({ confirmationRequired: true });
      }
      case "confirm": {
        const e = email(body.email);
        if (!e || typeof body.code !== "string") return fail(400, "Enter the email and the code.");
        await cognito(region, "ConfirmSignUp", { ClientId: clientId, Username: e, ConfirmationCode: body.code.trim() });
        return Response.json({ confirmed: true });
      }
      case "resend": {
        const e = email(body.email);
        if (!e) return fail(400, "Enter your email.");
        await cognito(region, "ResendConfirmationCode", { ClientId: clientId, Username: e });
        return Response.json({ sent: true });
      }
      case "refresh": {
        const token = (await cookies()).get(COOKIE)?.value;
        if (!token) return fail(401, "Not signed in");
        const res = await cognito<{ AuthenticationResult: CognitoTokens }>(region, "InitiateAuth", {
          AuthFlow: "REFRESH_TOKEN_AUTH",
          ClientId: clientId,
          AuthParameters: { REFRESH_TOKEN: token },
        });
        const t = res.AuthenticationResult;
        if (t.RefreshToken) await setRefreshCookie(t.RefreshToken, secure);
        return session({ accessToken: t.AccessToken, idToken: t.IdToken, expiresIn: t.ExpiresIn });
      }
      case "sign-out": {
        const store = await cookies();
        const token = store.get(COOKIE)?.value;
        store.delete({ name: COOKIE, path: "/api/auth" });
        // Revoking the refresh token also invalidates the access tokens issued from it.
        if (token) await cognito(region, "RevokeToken", { ClientId: clientId, Token: token }).catch(() => undefined);
        return Response.json({ signedOut: true });
      }
      default:
        return fail(404, "Unknown action");
    }
  } catch (err) {
    if (err instanceof CognitoError) {
      if (action === "refresh") (await cookies()).delete({ name: COOKIE, path: "/api/auth" });
      return fail(action === "refresh" ? 401 : err.status, err.message);
    }
    return fail(502, "Sign-in service unavailable. Try again.");
  }
}
