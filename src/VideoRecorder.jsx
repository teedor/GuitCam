import React, { useEffect, useMemo, useRef, useState } from "react";
import * as Progress from "@radix-ui/react-progress";

export default function VideoRecorder() {
  const videoRef = useRef(null);
  const fullscreenContainerRef = useRef(null);

  const streamRef = useRef(null); // camera+mic stream (raw)
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerIntervalRef = useRef(null);

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const meterRafRef = useRef(null);
  const lastClipAtMsRef = useRef(0);
  const meterLastUiUpdateMsRef = useRef(0);

  const [isReady, setIsReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);
  const [previewFitMode, setPreviewFitMode] = useState("contain"); // "contain" | "cover"
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rms, setRms] = useState(0);
  const [peak, setPeak] = useState(0);
  const [isClipping, setIsClipping] = useState(false);
  const [isAudioMeterEnabled, setIsAudioMeterEnabled] = useState(false);

  const supportsMediaRecorder = typeof window !== "undefined" && "MediaRecorder" in window;

  function ampToDbfs(amp) {
    if (!Number.isFinite(amp) || amp <= 0) return Number.NEGATIVE_INFINITY;
    return 20 * Math.log10(amp);
  }

  function formatDb(db) {
    if (!Number.isFinite(db)) return "-∞";
    return db.toFixed(1);
  }

  const formattedTime = useMemo(() => {
    const mm = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
    const ss = String(elapsedSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }, [elapsedSec]);

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function makeTimestampedFilename(ext) {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = pad2(d.getMonth() + 1);
    const dd = pad2(d.getDate());
    const hh = pad2(d.getHours());
    const mi = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    return `rec-${yyyy}${mm}${dd}-${hh}${mi}${ss}.${ext}`;
  }

  function pickMimeType() {
    const candidates = [
      // Prefer mp4 if supported
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
      "video/mp4",
      // WebM fallbacks
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm"
    ];

    for (const t of candidates) {
      try {
        if (window.MediaRecorder && window.MediaRecorder.isTypeSupported(t)) return t;
      } catch {
        // ignore and continue
      }
    }
    return "";
  }

  function cleanupStreamOnly() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }

  function cleanupAudioGraph() {
    if (meterRafRef.current) {
      cancelAnimationFrame(meterRafRef.current);
      meterRafRef.current = null;
    }
    try {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    } catch {
      // ignore
    } finally {
      audioContextRef.current = null;
      analyserRef.current = null;
      lastClipAtMsRef.current = 0;
      meterLastUiUpdateMsRef.current = 0;
      setIsAudioMeterEnabled(false);
      setRms(0);
      setPeak(0);
      setIsClipping(false);
    }
  }

  function startMeterLoop() {
    if (meterRafRef.current) return;
    const analyser = analyserRef.current;
    if (!analyser) return;

    const hasFloat = typeof analyser.getFloatTimeDomainData === "function";
    const floatBuf = hasFloat ? new Float32Array(analyser.fftSize) : null;
    const byteBuf = !hasFloat ? new Uint8Array(analyser.fftSize) : null;

    const tick = () => {
      const a = analyserRef.current;
      if (!a) return;

      let localPeak = 0;
      let sumSq = 0;

      if (floatBuf) {
        a.getFloatTimeDomainData(floatBuf);
        for (let i = 0; i < floatBuf.length; i += 1) {
          const v = floatBuf[i];
          const av = Math.abs(v);
          if (av > localPeak) localPeak = av;
          sumSq += v * v;
        }
      } else if (byteBuf) {
        a.getByteTimeDomainData(byteBuf);
        for (let i = 0; i < byteBuf.length; i += 1) {
          const v = (byteBuf[i] - 128) / 128;
          const av = Math.abs(v);
          if (av > localPeak) localPeak = av;
          sumSq += v * v;
        }
      }

      const localRms = Math.sqrt(sumSq / Math.max(1, analyser.fftSize));

      const now = performance.now();
      if (localPeak >= 0.98) lastClipAtMsRef.current = now;
      const clipHold = now - lastClipAtMsRef.current < 900;

      // Throttle UI updates to avoid excessive renders
      if (now - meterLastUiUpdateMsRef.current > 50) {
        meterLastUiUpdateMsRef.current = now;
        setRms(localRms);
        setPeak(localPeak);
        setIsClipping(clipHold);
      }

      meterRafRef.current = requestAnimationFrame(tick);
    };

    meterRafRef.current = requestAnimationFrame(tick);
  }

  async function enableAudioMeter() {
    try {
      const rawStream = streamRef.current;
      if (!rawStream) return;
      ensureAudioGraph(rawStream);

      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume().catch(() => {});
      }

      if (audioContextRef.current?.state === "running") {
        setIsAudioMeterEnabled(true);
        startMeterLoop();
      }
    } catch {
      // ignore; meter is optional
    }
  }

  function stopTimer() {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }

  function startTimer() {
    stopTimer();
    const start = Date.now();
    setElapsedSec(0);
    timerIntervalRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 250);
  }

  async function initMedia() {
    setError("");
    setIsInitializing(true);
    setIsReady(false);

    // Cleanup any prior stream
    cleanupStreamOnly();
    cleanupAudioGraph();

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Your browser does not support camera/microphone access (getUserMedia).");
      }

      // Attempt 1080p by default (browser may downscale)
      const constraints = {
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 60 },
          facingMode: "user"
        },
        audio: {
          // Request "raw" mic without browser processing.
          // Note: Some mobile browsers may not honor all of these.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      // Attach preview (muted to avoid echo)
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        await videoRef.current.play().catch(() => {});
      }

      // Audio meter graph is optional and only enabled on user gesture.

      setIsReady(true);
    } catch (e) {
      const msg =
        e?.name === "NotAllowedError"
          ? "Camera/microphone permission was denied. Please allow access and try again."
          : e?.name === "NotFoundError"
            ? "No camera/microphone device found."
            : e?.message || "Failed to initialize camera/microphone.";
      setError(msg);
      setIsReady(false);
    } finally {
      setIsInitializing(false);
    }
  }

  function ensureAudioGraph(rawStream) {
    // Monitoring-only graph (does not feed MediaRecorder)
    if (audioContextRef.current && analyserRef.current) {
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("Web Audio API (AudioContext) is not supported in this browser.");

    const audioTrack = rawStream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("No microphone track available.");

    // Create a mic-only stream so createMediaStreamSource gets a clean input
    const micOnly = new MediaStream([audioTrack]);

    const ctx = new AudioCtx();
    audioContextRef.current = ctx;

    const source = ctx.createMediaStreamSource(micOnly);

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    analyserRef.current = analyser;

    // Connect to a non-audible sink so the analyser updates without
    // routing microphone audio to speakers (avoids echo).
    const silent = ctx.createGain();
    silent.gain.value = 0;
    source.connect(analyser);
    analyser.connect(silent);
    silent.connect(ctx.destination);
  }

  function guessExtensionFromMime(mimeType) {
    if (mimeType && mimeType.toLowerCase().includes("mp4")) return "mp4";
    return "webm";
  }

  function triggerDownload(blob, mimeType) {
    const ext = guessExtensionFromMime(mimeType);
    const filename = makeTimestampedFilename(ext);

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function startRecording() {
    setError("");

    try {
      if (!supportsMediaRecorder) {
        throw new Error("MediaRecorder is not supported in this browser.");
      }
      const rawStream = streamRef.current;
      if (!rawStream) {
        throw new Error("Camera/microphone is not initialized.");
      }
      const videoTrack = rawStream.getVideoTracks()[0];
      if (!videoTrack) throw new Error("No camera track available.");

      // Ensure audio graph exists + meter can run (some browsers require a user gesture to start audio)
      await enableAudioMeter();

      // Record raw camera video + raw microphone audio (no WebAudio processing).
      const composedStream = new MediaStream([videoTrack, ...rawStream.getAudioTracks()]);

      const mimeType = pickMimeType();

      // Attempt highest possible bitrate, fallback to >= 2.5Mbps
      const bitrateAttempts = [
        { videoBitsPerSecond: 12_000_000, audioBitsPerSecond: 192_000 },
        { videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 },
        { videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 128_000 },
        { videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 } // minimum requirement
      ];

      let recorder = null;
      let chosenMime = mimeType;

      for (const attempt of bitrateAttempts) {
        try {
          recorder = new MediaRecorder(composedStream, {
            mimeType: chosenMime || undefined,
            videoBitsPerSecond: attempt.videoBitsPerSecond,
            audioBitsPerSecond: attempt.audioBitsPerSecond
          });
          break;
        } catch {
          recorder = null;
        }
      }

      if (!recorder) {
        recorder = new MediaRecorder(composedStream, { mimeType: chosenMime || undefined });
      }

      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onerror = () => {
        setError("Recording error occurred. Please try again.");
      };

      recorder.onstop = () => {
        stopTimer();
        setIsRecording(false);

        const finalMime = chosenMime || recorder.mimeType || "";
        const blob = new Blob(chunksRef.current, { type: finalMime || "video/webm" });
        chunksRef.current = [];

        triggerDownload(blob, finalMime);
      };

      recorder.start(250); // timeslice for steady chunking
      setIsRecording(true);
      startTimer();
    } catch (e) {
      cleanupAudioGraph();
      setIsRecording(false);
      stopTimer();
      setElapsedSec(0);
      setError(e?.message || "Failed to start recording.");
    }
  }

  function stopRecording() {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    initMedia();

    return () => {
      stopTimer();
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      } catch {
        // ignore
      }
      cleanupAudioGraph();
      cleanupStreamOnly();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onFsChange);
    onFsChange();
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen?.();
        return;
      }
      const el = fullscreenContainerRef.current;
      if (!el?.requestFullscreen) {
        throw new Error("Fullscreen is not supported in this browser.");
      }
      await el.requestFullscreen();
    } catch (e) {
      setError(e?.message || "Failed to toggle fullscreen.");
    }
  }

  const canStart = isReady && !isRecording && !isInitializing && supportsMediaRecorder;
  const canStop = isRecording;
  const rmsPct = Math.max(0, Math.min(100, rms * 100));
  const peakPct = Math.max(0, Math.min(100, peak * 100));

  return (
    <div ref={fullscreenContainerRef} className="relative h-[100dvh] w-full bg-neutral-950 text-neutral-100">
      {/* Video Preview */}
      <div className="absolute inset-0 bg-black">
        <video
          ref={videoRef}
          className={`h-full w-full ${previewFitMode === "cover" ? "object-cover" : "object-contain"}`}
          autoPlay
          playsInline
          muted
        />
        {/* Vignette for better contrast */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/55 via-black/10 to-black/60" />
      </div>

      {/* Top overlay */}
      <div className="absolute left-0 right-0 top-0 z-10 p-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400/80 shadow-[0_0_18px_rgba(16,185,129,0.55)]" />
            <span className="text-sm font-medium tracking-wide text-neutral-200">
              High-Fidelity Recorder
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              <button
                onClick={() => setPreviewFitMode((m) => (m === "contain" ? "cover" : "contain"))}
                className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-neutral-100 ring-1 ring-white/10 transition hover:bg-white/15"
                title={previewFitMode === "contain" ? "Switch to Fill (crop edges)" : "Switch to Fit (show full frame)"}
                type="button"
              >
                {previewFitMode === "contain" ? "Fit" : "Fill"}
              </button>
              <button
                onClick={toggleFullscreen}
                className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-neutral-100 ring-1 ring-white/10 transition hover:bg-white/15"
                type="button"
              >
                {isFullscreen ? "Exit Full screen" : "Full screen"}
              </button>
            </div>
            {isRecording ? (
              <div className="inline-flex items-center gap-2 rounded-full bg-red-500/15 px-3 py-1 text-sm font-semibold text-red-200 ring-1 ring-red-500/30">
                <span className="relative inline-flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-400" />
                </span>
                <span>{formattedTime}</span>
              </div>
            ) : (
              <div className="rounded-full bg-white/10 px-3 py-1 text-sm text-neutral-200 ring-1 ring-white/10">
                {isInitializing ? "Starting…" : isReady ? "Ready" : "Not ready"}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom overlay controls */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-4 pb-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-2xl bg-black/45 p-4 ring-1 ring-white/10 backdrop-blur">
            {/* Audio controls */}
            {isReady && (
              <div className="mb-4 rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-neutral-100">Audio</div>
                  <div className="flex items-center gap-2 text-xs text-neutral-300">
                    {isClipping && (
                      <span className="rounded-full bg-red-500/20 px-2 py-0.5 font-semibold text-red-200 ring-1 ring-red-500/30">
                        CLIP
                      </span>
                    )}
                    {!isAudioMeterEnabled && (
                      <button
                        type="button"
                        onClick={enableAudioMeter}
                        className="rounded-full bg-white/10 px-2 py-0.5 font-semibold text-neutral-100 ring-1 ring-white/10 transition hover:bg-white/15"
                        title="Browsers often require a gesture to start the audio meter"
                      >
                        Enable meter
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 text-xs text-neutral-300">
                    <div className="font-medium">Level (RMS)</div>
                    <div className="tabular-nums">
                      {formatDb(ampToDbfs(rms))} dBFS • Peak {formatDb(ampToDbfs(peak))} dBFS
                    </div>
                  </div>

                  <div className="relative">
                    <Progress.Root
                      value={rmsPct}
                      className="relative h-2 w-full overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10"
                    >
                      <Progress.Indicator
                        className="h-full w-full origin-left bg-emerald-400/80"
                        style={{ transform: `translateX(-${100 - rmsPct}%)` }}
                      />
                    </Progress.Root>
                    {/* Peak marker */}
                    <div
                      className="pointer-events-none absolute -top-1 bottom-[-4px] w-[2px] rounded bg-white/70 shadow-[0_0_12px_rgba(255,255,255,0.35)]"
                      style={{ left: `${peakPct}%` }}
                    />
                    {/* Clip zone hint */}
                    <div className="pointer-events-none absolute inset-y-0 right-0 w-[8%] rounded-r-full bg-red-500/10" />
                  </div>

                  <div className="mt-3">
                    <div className="mt-2 text-[11px] text-neutral-400">
                      Tip: aim for peaks around -6 to -3 dBFS to avoid clipping.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-neutral-200">
                <div className="font-medium">1080p attempt • Raw mic audio • Auto-download</div>
                <div className="mt-0.5 text-xs text-neutral-400">If MP4 isn’t supported, it saves as WebM.</div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={initMedia}
                  disabled={isRecording || isInitializing}
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-neutral-100 ring-1 ring-white/10 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Retry
                </button>

                <button
                  onClick={() => setPreviewFitMode((m) => (m === "contain" ? "cover" : "contain"))}
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-neutral-100 ring-1 ring-white/10 transition hover:bg-white/15 sm:hidden"
                  title={previewFitMode === "contain" ? "Switch to Fill (crop edges)" : "Switch to Fit (show full frame)"}
                  type="button"
                >
                  {previewFitMode === "contain" ? "Fit" : "Fill"}
                </button>

                <button
                  onClick={toggleFullscreen}
                  className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-neutral-100 ring-1 ring-white/10 transition hover:bg-white/15 sm:hidden"
                  type="button"
                >
                  {isFullscreen ? "Exit Full screen" : "Full screen"}
                </button>

                {!isRecording ? (
                  <button
                    onClick={startRecording}
                    disabled={!canStart}
                    className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-bold text-emerald-950 shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Start Recording
                  </button>
                ) : (
                  <button
                    onClick={stopRecording}
                    disabled={!canStop}
                    className="rounded-xl bg-red-500 px-5 py-2 text-sm font-bold text-red-950 shadow-sm transition hover:bg-red-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Stop Recording
                  </button>
                )}
              </div>
            </div>

            {!supportsMediaRecorder && (
              <div className="mt-3 rounded-xl bg-yellow-500/10 p-3 text-sm text-yellow-200 ring-1 ring-yellow-500/20">
                MediaRecorder isn’t supported in this browser.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl bg-neutral-900/90 p-5 ring-1 ring-white/10 backdrop-blur">
            <div className="text-base font-semibold text-neutral-100">Something went wrong</div>
            <div className="mt-2 text-sm text-neutral-200">{error}</div>

            <div className="mt-4 flex items-center justify-end gap-3">
              <button
                onClick={() => setError("")}
                className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-neutral-100 ring-1 ring-white/10 transition hover:bg-white/15"
              >
                Dismiss
              </button>
              <button
                onClick={initMedia}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-emerald-950 transition hover:bg-emerald-400"
              >
                Retry setup
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

