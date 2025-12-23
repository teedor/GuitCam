import React, { useEffect, useMemo, useRef, useState } from "react";

export default function VideoRecorder() {
  const videoRef = useRef(null);

  const streamRef = useRef(null); // camera+mic stream (raw)
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const timerIntervalRef = useRef(null);

  const audioContextRef = useRef(null);
  const audioDestinationRef = useRef(null);

  const [isReady, setIsReady] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [error, setError] = useState("");
  const [isInitializing, setIsInitializing] = useState(false);

  const supportsMediaRecorder = typeof window !== "undefined" && "MediaRecorder" in window;

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
    try {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
    } catch {
      // ignore
    } finally {
      audioContextRef.current = null;
      audioDestinationRef.current = null;
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
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false // we'll do our own compressor+gain pipeline
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

  function makeProcessedAudioStream(rawStream) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("Web Audio API (AudioContext) is not supported in this browser.");

    const audioTrack = rawStream.getAudioTracks()[0];
    if (!audioTrack) throw new Error("No microphone track available.");

    // Create a mic-only stream so createMediaStreamSource gets a clean input
    const micOnly = new MediaStream([audioTrack]);

    const ctx = new AudioCtx();
    audioContextRef.current = ctx;

    const source = ctx.createMediaStreamSource(micOnly);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;

    const gain = ctx.createGain();
    gain.gain.value = 1.5;

    const destination = ctx.createMediaStreamDestination();
    audioDestinationRef.current = destination;

    // Pipeline: mic -> compressor -> gain -> destination
    source.connect(compressor);
    compressor.connect(gain);
    gain.connect(destination);

    return destination.stream;
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

      cleanupAudioGraph();

      // Build processed audio (must be created on a user gesture in some browsers)
      const processedAudioStream = makeProcessedAudioStream(rawStream);

      // Combine camera video + processed audio into a new stream for recording
      const composedStream = new MediaStream([videoTrack, ...processedAudioStream.getAudioTracks()]);

      // Resume context if needed
      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume().catch(() => {});
      }

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

        // Tear down audio graph (preview stays)
        cleanupAudioGraph();
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

  const canStart = isReady && !isRecording && !isInitializing && supportsMediaRecorder;
  const canStop = isRecording;

  return (
    <div className="relative h-[100dvh] w-full bg-neutral-950 text-neutral-100">
      {/* Video Preview */}
      <div className="absolute inset-0">
        <video ref={videoRef} className="h-full w-full object-cover" autoPlay playsInline muted />
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
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-neutral-200">
                <div className="font-medium">1080p attempt • Compressor + 1.5× gain • Auto-download</div>
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

