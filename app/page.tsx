"use client";

import { useMemo, useRef, useState } from "react";

const VOICES = [
  { id: "en-US-JennyNeural", label: "Jenny (US) - Natural" },
  { id: "en-US-GuyNeural", label: "Guy (US) - Natural" },
  { id: "en-CA-LiamNeural", label: "Liam (Canada) - Natural" },
  { id: "en-GB-SoniaNeural", label: "Sonia (UK) - Natural" },
];

const RATES = [
  { id: "0%", label: "Normal" },
  { id: "+10%", label: "Faster +10%" },
  { id: "+20%", label: "Faster +20%" },
  { id: "-10%", label: "Slower -10%" },
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function formatSeconds(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

/**
 * Rough estimate:
 * - average speaking speed ~150 wpm (2.5 wps)
 * - adjust by rate
 */
function estimateDurationSeconds(text: string, rate: string) {
  const words = (text.trim().match(/\S+/g) || []).length;
  const baseWps = 2.5; // 150 wpm
  let multiplier = 1.0;

  if (rate.startsWith("+")) {
    const pct = parseInt(rate.replace("%", "").replace("+", ""), 10) || 0;
    multiplier = 1 + pct / 100; // faster => shorter duration
  } else if (rate.startsWith("-")) {
    const pct = parseInt(rate.replace("%", "").replace("-", ""), 10) || 0;
    multiplier = 1 - pct / 100; // slower => longer duration
  }

  // duration inversely proportional to speed
  const effectiveWps = baseWps * multiplier;
  const seconds = words / Math.max(0.5, effectiveWps);
  // Add small overhead for pauses/processing in audio rendering
  return seconds + 1.5;
}

export default function Home() {
  const [text, setText] = useState("Welcome to SupaAI Cloud Text to Speech.");
  const [voice, setVoice] = useState(VOICES[0].id);
  const [rate, setRate] = useState(RATES[0].id);

  const [loading, setLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
 // add hooks
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);


  // progress UI (simulated while backend works)
  const [progress, setProgress] = useState(0);
  const timerRef = useRef<number | null>(null);

  const charCount = useMemo(() => text.length, [text]);
  const estSeconds = useMemo(() => estimateDurationSeconds(text, rate), [text, rate]);

  function startProgress() {
    setProgress(0);
    if (timerRef.current) window.clearInterval(timerRef.current);

    // Move quickly to ~85%, then wait (backend unknown duration)
    timerRef.current = window.setInterval(() => {
      setProgress((p) => {
        const next = p + (p < 60 ? 6 : p < 85 ? 2 : 0.5);
        return clamp(next, 0, 92);
      });
    }, 250);
  }

  function stopProgressSuccess() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setProgress(100);
    // reset bar after a short moment
    window.setTimeout(() => setProgress(0), 800);
  }

  function stopProgressFail() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setProgress(0);
  }

  async function generate() {
    setError(null);
    setLoading(true);
    startProgress();

    try {
      if (audioUrl) URL.revokeObjectURL(audioUrl);

      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice, rate }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(msg || "TTS failed");
      }

     // const blob = await res.blob();
     // setAudioUrl(URL.createObjectURL(blob));
     
     const blob = await res.blob();

   // revoke ONLY the previous blob url (from ref, not state)
if (blobUrlRef.current) {
  URL.revokeObjectURL(blobUrlRef.current);
  blobUrlRef.current = null;
}

const newUrl = URL.createObjectURL(blob);
blobUrlRef.current = newUrl;
setAudioUrl(newUrl);
    
    // force audio to reload the new source (Chrome fix)
setTimeout(() => {
  if (!audioRef.current) return;
  audioRef.current.load();
  audioRef.current.currentTime = 0;
  audioRef.current.play().catch(() => {});
}, 50); 
   

      stopProgressSuccess();
    } catch (e: any) {
      setError(e?.message ?? "Unknown error");
      setAudioUrl(null);
      stopProgressFail();
    } finally {
      setLoading(false);
    }
  }

  function download() {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = "speech.mp3";
    a.click();
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-5xl flex-col px-6 py-10">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">SupaAI TTS</h1>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
            Next.js + Azure Speech
          </span>
        </div>

        <p className="mt-3 text-slate-300">
          Type your text, choose a voice, generate MP3, play or download.
        </p>

        {/* Progress + ETA */}
        <div className="mt-5 rounded-2xl bg-slate-900/50 p-4 ring-1 ring-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
            <div className="flex items-center gap-2">
              <span className="font-medium">Estimated audio length:</span>
              <span className="rounded bg-slate-950 px-2 py-0.5 ring-1 ring-slate-800">
                {formatSeconds(estSeconds)}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400">
                {loading ? "Generating…" : "Idle"}
              </span>
              {loading && (
                <span className="inline-flex h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-slate-200" />
              )}
            </div>
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-950 ring-1 ring-slate-800">
            <div
              className="h-full rounded-full bg-slate-200 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="mt-2 text-xs text-slate-500">
            Note: generation time depends on Azure latency and text length.
          </div>
        </div>

        <div className="mt-8 grid flex-1 gap-6 lg:grid-cols-2">
          {/* Left card */}
          <div className="rounded-2xl bg-slate-900/60 p-6 shadow-xl ring-1 ring-slate-800">
            <label className="text-sm text-slate-300">Text</label>
            <textarea
              className="mt-2 h-44 w-full resize-none rounded-xl bg-slate-950 p-4 text-slate-100 ring-1 ring-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Enter text..."
            />

            <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
              <span>{charCount} characters</span>
              <span>Tip: keep under ~5000</span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm text-slate-300">Voice</label>
                <select
                  className="mt-2 w-full rounded-xl bg-slate-950 p-3 ring-1 ring-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500"
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                >
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-sm text-slate-300">Speed</label>
                <select
                  className="mt-2 w-full rounded-xl bg-slate-950 p-3 ring-1 ring-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500"
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                >
                  {RATES.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <button
              className="mt-6 w-full rounded-xl bg-slate-100 px-4 py-3 font-medium text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
              onClick={generate}
              disabled={loading || !text.trim()}
            >
              {loading ? "Generating..." : "Generate MP3"}
            </button>

            {error && (
              <div className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm text-red-200 ring-1 ring-red-900">
                {error}
              </div>
            )}
          </div>

          {/* Right card */}
          <div className="rounded-2xl bg-slate-900/60 p-6 shadow-xl ring-1 ring-slate-800">
            <h2 className="text-lg font-semibold">Player</h2>
            <p className="mt-2 text-sm text-slate-300">
              Your generated audio will appear here.
            </p>

            <div className="mt-6 rounded-xl bg-slate-950 p-4 ring-1 ring-slate-800">
              {audioUrl ? (
                <>
                  <audio
                    key={audioUrl}
                    ref={audioRef}
                    controls
                    preload="auto"
                    className="w-full h-14"
                    src={audioUrl}
                      />
                  <div className="mt-4 flex gap-3">
                  <button
  onClick={download}
  className="rounded-xl bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700"
>
  Download MP3
</button>

                  <button
  onClick={() => {
    audioRef.current?.pause();
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }
    setAudioUrl(null);
  }}    
		  className="rounded-xl bg-slate-950 px-4 py-2 text-sm text-slate-300 ring-1 ring-slate-800 hover:bg-slate-900"
                    >
                      Clear
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-sm text-slate-400">
                  No audio yet. Click <b>Generate MP3</b> to create one.
                </div>
              )}
            </div>

            <div className="mt-6 text-xs text-slate-500">
              Backend proxied via{" "}
              <code className="rounded bg-slate-950 px-1 py-0.5 ring-1 ring-slate-800">
                /api/tts
              </code>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-10 border-t border-slate-800 pt-6 text-center text-sm text-slate-500">
          © supaAI.cloud — created by Eric
        </footer>
      </div>
    </main>
  );
}

