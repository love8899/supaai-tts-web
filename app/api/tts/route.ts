import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const text = (body?.text ?? "").toString();
    const voice = (body?.voice ?? "en-US-JennyNeural").toString();
    const rate = (body?.rate ?? "0%").toString();

    if (!text.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const base = process.env.TTS_BACKEND_URL;
    if (!base) {
      return NextResponse.json(
        { error: "TTS_BACKEND_URL not set in .env.local" },
        { status: 500 }
      );
    }

    const url = new URL("/tts", base);

    const upstream = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice, rate }),
      // optional: keep requests fresh
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

