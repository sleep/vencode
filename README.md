# vencode

Shrink video files without visibly losing quality.

```bash
npm install
node index.js video.mp4        # one file
node index.js ./videos         # whole folder, recursively
```

Pick a preset from the menu, watch the progress bar, done. Your original is backed up first.

## Options

| Option | Effect |
| --- | --- |
| `-y`, `--yes` | No prompts, use Balanced |
| `--preset=<name>` | `MAXIMUM_QUALITY`, `HIGH_QUALITY`, `BALANCED`, `MAXIMUM_COMPRESSION`, `HEVC_HIGH`, `HEVC_FAST_HW`, `H264_FAST_HW` |
| `--delete-backups` | Drop backups after encoding (with `--yes`) |
| `--force` | Reencode even a file vencode already made |
| `-v`, `--verbose` | Detailed video info |
| `-h`, `--help` | Help |

Scripted run:

```bash
node index.js --yes --preset=HEVC_HIGH --delete-backups ./videos
```

Exit codes: `0` ok, `1` failure or bad args, `130` interrupted.

## Presets

| Preset | Quality | Audio | Use for |
| --- | --- | --- | --- |
| Maximum Quality | x264 CRF 18 | 320k | Archival |
| High Quality | x264 CRF 20 | 160k | Sharing |
| **Balanced** | x264 CRF 23 | 128k | **Default** |
| Maximum Compression | x264 CRF 26 | 96k | Smallest H.264 |
| HEVC High Quality | x265 CRF 24 | 128k | Best compression |
| HEVC Fast (hw) | VideoToolbox q65 | 128k | Big batches, ~6x faster |
| H.264 Fast (hw) | VideoToolbox q58 | 128k | Compatibility, no 10-bit |

Hardware presets appear only on machines whose media engine actually works (proven by a trial encode, not by asking ffmpeg).

Custom settings let you set codec, CRF 18-28, ffmpeg preset, and audio bitrate.

## What it does on its own

- **Measures instead of guessing.** Encodes short samples of your real file, so every menu row shows a measured size, not a formula.
- **Refuses pointless work.** Probes whether reencoding would actually shrink the file. Under 10% gain, it copies through untouched and tells you why.
- **Won't degrade quietly.** Keeps 10-bit at 10-bit, keeps every audio/subtitle/attachment stream, never reencodes audio upward.
- **Won't reprocess itself.** Marks its output, so a second run skips it. `--force` overrides.
- **Safe to interrupt.** Ctrl+C kills ffmpeg, deletes the partial file, leaves the original alone.
- **Batches sanely.** Scans first, reports totals, reuses the first file's preset, ends with a summary. Failures are counted and exit non-zero.

ffmpeg and ffprobe download automatically. Nothing to install.

## Audio rules

Reencoding lossy audio never recovers what the first encoder threw away, so audio is decided per file, independent of the preset:

| Source | Action |
| --- | --- |
| AAC at or below target | Copied bit for bit |
| AAC above target | Reencoded at target |
| Other codec below target | Reencoded, capped to source bitrate |
| Other codec at or above target | Reencoded at target |
| Bitrate unknown | Reencoded at target |

ffmpeg's AAC encoder is variable rate and saturates near 250-290 kbps stereo, so 320k is a ceiling, not a promise.

## Example

```
  Source
  ──────────────────────────────────────────────────────────
  File          clips/interview.mp4
  Resolution    1920x1080          Codec     h264
  Bitrate       5200 kbps          Duration  3:00
  Size          115.3 MB           Frame rate 30.00 fps

? Select encoding preset ›
    Maximum Quality         142.8 MB  +24%
    High Quality            127.4 MB  +11%
❯   Balanced (Recommended)  105.2 MB   -9%
    Maximum Compression      82.7 MB  -28%
    HEVC High Quality        73.6 MB  -36%

  Encoding  ████████████▍░░░░░░░  58%  ·  1:12 elapsed  ·  0:52 left  ·  2.4x

  Result
  ──────────────────────────────────────────────────────────
  Original      115.3 MB
  Encoded       106.8 MB
  Saved         8.5 MB (7%)
  Backup        clips/interview.backup.mp4
```

Piped output degrades to plain percentage lines every 10%.

## Why it works this way

<details>
<summary>Reencode decision is measured, not ranked by codec</summary>

Codec efficiency rankings compare codecs *at equal quality*. A 180 Mbps near-lossless HEVC capture is nowhere near equal quality: reencoding it to H.264 CRF 18 measured **75% smaller**. A lean HEVC file at the same settings would grow.

So a short probe encodes a few seconds at the chosen settings and projects the result. Over 10% reduction, it encodes; otherwise it copies through. The software probe uses a faster x264 preset than the real encode, which produces *larger* output at the same CRF, so it never overstates the benefit. VideoToolbox has no preset ladder, so its probe runs at real settings: unbiased, and cheap because the encoder is fast.

Codec rank survives only as a fallback when measurement is impossible. Container compatibility is a hard constraint above both, which is what fixes `.webm` input previously failing outright (libx264 cannot be muxed into it).
</details>

<details>
<summary>Hardware encoding is detected by trial, not by asking ffmpeg</summary>

`ffmpeg -encoders` reports what the binary was compiled with, which is a different question from what the silicon will accept. The same build lists `hevc_videotoolbox` on an Intel Mac and inside a VM with no passthrough, and only fails once a real encode starts. A trial encode of a fraction of a second settles it, costs about 100 ms once per run, and hides the presets where it fails.

Quality targets were calibrated, not chosen. VideoToolbox takes `-q:v` on a 0-100 scale running opposite to CRF. Measured: `-q:v 65` lands within 0.35 VMAF of libx265 CRF 24; `-q:v 58` within 0.10 VMAF of libx264 CRF 23.

One six-minute 720p file, end to end:

| Preset | Wall clock | Output |
|---|---|---|
| HEVC High Quality (libx265 CRF 24) | 184s | 139.0 MB |
| HEVC Fast (hardware) | 29s | 169.9 MB |

Six times quicker for a fifth more bytes, and a far larger gap in CPU time (nearer 14x on the encode alone), which is what decides whether a laptop stays cool through a batch.

The two families do not track each other, so the menu samples both: on one test clip the same source measured 2.74 Mbps under libx264 and 3.87 Mbps under hardware HEVC. Scaling one into the other would have misreported every hardware row by ~40%.
</details>

<details>
<summary>Size estimates come from sampling the real file</summary>

CRF targets a quality level, not a bitrate, so size depends on content and cannot be derived from resolution. Over five minutes, vencode encodes six three-second samples at the chosen settings. Against full encodes of three 90-second sources, where the old model predicted an identical 28.2 MB for all three:

| Content | Actual | Old estimate | Sampled estimate |
| --- | --- | --- | --- |
| Low motion | 4.9 MB | +478% | +25% |
| Mixed | 12.0 MB | +134% | +11% |
| High motion | 357.5 MB | -92% | -0.1% |

Sampling costs ~18 seconds regardless of length: about 6% at the five-minute threshold, negligible on a feature. Shorter files skip it and say so.
</details>

<details>
<summary>Repeat runs are caught by two layers</summary>

| Layer | Covers | Notes |
| --- | --- | --- |
| Embedded tag | `VENCODE` on Matroska, `comment` elsewhere | Survives moves, renames, copies, stream-copy remux |
| Local index | Containers that drop tags | `~/.config/vencode/processed.json`, keyed by content |

The index key is file size plus the first and last 4 MB, not a full hash. It answers "did this tool make this file" in 0.24s where sha256 of the same 2.8 GB file takes 6.0s, and still changes whenever the file is reencoded.
</details>

<details>
<summary>Bit depth and streams are preserved</summary>

10-bit sources stay 10-bit. They were previously flattened to 8-bit while their HDR tags survived, producing a file claiming HDR PQ with 8-bit samples and visible banding. The pixel format is a clamp, not a passthrough: depth preserved, chroma constrained to 4:2:0, so `yuv444p` and `rgb24` do not reach profiles most devices cannot decode.

libx264 cannot carry HDR10 mastering metadata, so HDR sources are flagged and pointed at the HEVC preset.

ffmpeg's default stream selection keeps only the best single stream per type, silently discarding extra audio tracks, subtitles and MKV attachments. All streams are mapped explicitly and copied through.
</details>

## License

MIT
