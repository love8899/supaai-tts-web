export const runtime = "nodejs";
import { NextResponse } from "next/server";

type RecaptchaVerifyResult = {
  success: boolean;
  score?: number;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
};

async function verifyRecaptcha(token: string, ip?: string) {
  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) return { ok: false, reason: "missing_secret" as const };

  const form = new URLSearchParams();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);

  const r = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    cache: "no-store",
  });

  const data = (await r.json()) as RecaptchaVerifyResult;

  const minScore = Number(process.env.RECAPTCHA_MIN_SCORE ?? "0.5");
  const expectedAction = "tts_generate";
  const expectedHost = process.env.RECAPTCHA_EXPECTED_HOST ?? "tts.supaai.cloud";

  const ok =
    data.success === true &&
    (typeof data.score === "number" ? data.score >= minScore : false) &&
    data.action === expectedAction &&
    (data.hostname === expectedHost ||
      data.hostname?.endsWith(`.${expectedHost.split(".").slice(1).join(".")}`));

  return {
    ok,
    data,
    minScore,
    expectedAction,
    expectedHost,
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const text = (body?.text ?? "").toString().trim();
    const voice = (body?.voice ?? "en-US-JennyNeural").toString();
    const speed = (body?.speed ?? "normal").toString();

    if (!text) {
      return NextResponse.json({ error: "Text is required" }, { status: 400 });
    }

    const recaptchaToken = (body?.recaptchaToken ?? "").toString();
    if (!recaptchaToken) {
      return NextResponse.json({ error: "Captcha required" }, { status: 400 });
    }

    const ip =
      req.headers.get("cf-connecting-ip") ??
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      undefined;

    const v = await verifyRecaptcha(recaptchaToken, ip);
    if (!v.ok) {
      console.warn("reCAPTCHA failed", {
        ip,
        success: v.data?.success,
        score: v.data?.score,
        action: v.data?.action,
        hostname: v.data?.hostname,
        errors: v.data?.["error-codes"],
        minScore: v.minScore,
      });

      return NextResponse.json(
        { error: "Captcha verification failed" },
        { status: 403 }
      );
    }

    const base = process.env.TTS_BACKEND_URL || "http://127.0.0.1:8000";
    const url = new URL("/tts", base);

    const upstream = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, speed }),
      cache: "no-store",
    });

    if (!upstream.ok) {
      const detail = await upstream.text();
      return NextResponse.json(
        { error: "Upstream TTS failed", detail },
        { status: 502 }
      );
    }

    const buffer = await upstream.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Proxy error", detail: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}