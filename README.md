# vencode

Interactive video reencoding tool that analyzes your videos and reencodes them to save space while maintaining indistinguishable quality.

## Features

- **Interactive Preset Selection**: Every preset shows its estimated size and change up front, so the whole menu is comparable at a glance
- **Smart Analysis**: Examines video bitrate, resolution, codec, and audio streams
- **Multiple Quality Presets**: From maximum quality to maximum compression
- **Hardware Encoding**: Uses the Apple Silicon media engine where one is present, verified by a trial encode rather than assumed
- **Custom Settings**: Full control over codec, CRF, preset, and audio bitrate
- **Real-time Estimates**: See estimated file size and savings for each preset
- **Safe Operation**: Creates backup before replacing, with automatic rollback on errors
- **Extension Preservation**: Keeps the same file extension (1:1)
- **Progress Tracking**: Live progress bar with elapsed time, ETA, and encoding speed
- **Interactive Backup Management**: Choose whether to keep or delete backup after encoding
- **Batch Overview**: Scans the whole set first, reports total size and length, then tracks a running total and closes with a summary
- **Efficiency Advisory**: Flags files that are already well optimized before you spend time reencoding them
- **Lossless Audio Handling**: Copies the audio stream untouched when reencoding it could only lose quality, and never encodes above the source bitrate
- **No Codec Downgrades**: Passes through sources already using a more efficient codec instead of transcoding them into a bigger, worse file
- **Bit Depth Preservation**: Keeps 10-bit sources at 10-bit rather than flattening them to 8-bit
- **Stream Retention**: Keeps every audio track, subtitle track and attachment, not just the first of each
- **Measured Estimates**: Encodes short samples of the real file so the preset menu shows a measured size rather than a guess
- **Measured Reencode Decision**: Probes what a reencode would actually produce rather than guessing from codec names
- **Repeat-Run Safe**: Marks its own output so a second run skips it instead of adding another generation of loss
- **Safe Interrupt**: Ctrl+C stops ffmpeg, discards the partial output, restores the cursor, and leaves the original untouched
- **Non-interactive Mode**: `--yes` and `--preset` for scripted runs

## Prerequisites

The tool will automatically download and use ffmpeg and ffprobe binaries. No manual installation needed!

## Installation

```bash
npm install
```

## Usage

### Basic Usage

```bash
node index.js video.mp4
```

### Folder Usage

Pass a folder to reencode every video file found inside it (recursively):

```bash
node index.js ./my-videos-folder
```

The first file's settings are reused for the rest of the batch, same as passing multiple files explicitly.

The tool will:
1. Analyze your video file
2. Show you preset options with estimated savings
3. Let you choose a preset, custom settings, or skip
4. Encode the video with progress updates
5. Ask if you want to delete the backup file

### Options

```bash
# Show detailed video information
node index.js --verbose video.mp4

# Skip all prompts and use the balanced preset
node index.js --yes video.mp4

# Pick a preset non-interactively, and drop backups afterwards
node index.js --yes --preset=HEVC_HIGH --delete-backups ./my-videos-folder

# Show help
node index.js --help
```

| Option | Effect |
| --- | --- |
| `-v`, `--verbose` | Show detailed video information |
| `-y`, `--yes` | Skip prompts, use the balanced preset |
| `--preset=<name>` | `MAXIMUM_QUALITY`, `HIGH_QUALITY`, `BALANCED`, `MAXIMUM_COMPRESSION`, `HEVC_HIGH`, `HEVC_FAST_HW`, `H264_FAST_HW` |
| `--delete-backups` | With `--yes`, remove backups after encoding |
| `--force` | Reencode even if vencode made the file |
| `-h`, `--help` | Show this help message |

Exit codes: `0` on success, `1` on failure or bad arguments, `130` if interrupted.

## How It Works

1. **Analysis**: The tool examines your video file to understand:
   - Current resolution and bitrate
   - Video codec and format
   - Audio streams and quality
   - File size and duration

2. **Interactive Preset Selection**: You'll be presented with options:
   - **Maximum Quality** (CRF 18) - Visually lossless, larger file size
   - **High Quality** (CRF 20) - Excellent quality, good compression
   - **Balanced (Recommended)** (CRF 23) - Great quality, good size savings
   - **Maximum Compression** (CRF 26) - Smaller size, slight quality loss
   - **HEVC High Quality** (CRF 24) - Best compression with H.265
   - **HEVC Fast (hardware)** - Same quality as the above, far quicker (only where the media engine exists)
   - **H.264 Fast (hardware)** - Widest compatibility, barely touches the CPU (only where the media engine exists)
   - **Custom Settings** - Enter your own parameters
   - **Skip** - Don't reencode this file

3. **Encoding**: Once you select a preset:
   - Shows your selected settings
   - Encodes with real-time progress updates
   - Creates temporary file during encoding

4. **Replacement**: Safely replaces the original:
   - Creates backup of original
   - Verifies encoded file is valid
   - Replaces original with encoded version
   - Keeps same filename and extension

5. **Backup Management**: After successful encoding:
   - Prompts you to keep or delete the backup
   - Safe deletion or retention based on your choice

## Available Presets

### Maximum Quality
- **CRF**: 18 (visually lossless)
- **Audio**: 320 kbps AAC
- **Use case**: Archival, when quality is paramount

### High Quality
- **CRF**: 20 (excellent quality)
- **Audio**: 160 kbps AAC
- **Use case**: High-quality sharing, professional use

### Balanced (Recommended)
- **CRF**: 23 (great quality)
- **Audio**: 128 kbps AAC
- **Use case**: General purpose, best balance

### Maximum Compression
- **CRF**: 26 (good quality)
- **Audio**: 96 kbps AAC
- **Use case**: Maximum space savings, streaming

### HEVC High Quality
- **CRF**: 24 (H.265 codec)
- **Audio**: 128 kbps AAC
- **Use case**: Best compression ratio, modern devices

### HEVC Fast (hardware)
- **Quality**: 65 on the VideoToolbox scale, calibrated to libx265 at CRF 24
- **Audio**: 128 kbps AAC
- **Use case**: Large batches, or anywhere the wait matters more than the last tenth of compression

### H.264 Fast (hardware)
- **Quality**: 58 on the VideoToolbox scale, calibrated to libx264 at CRF 23
- **Audio**: 128 kbps AAC
- **Use case**: Widest playback compatibility at almost no CPU cost. Cannot carry 10-bit or HDR

The software presets use:
- **Preset**: slow (better compression)
- **Pixel Format**: yuv420p, or yuv420p10le for a 10-bit source

The hardware presets have no preset ladder, and take `p010le` for 10-bit under
HEVC. Hardware H.264 has no 10-bit format at all and says so before flattening.

## Example Session

```
  Source
  ──────────────────────────────────────────────────────────────────────────
  File          clips/interview.mp4
  Resolution    1920x1080
  Codec         h264
  Bitrate       5200 kbps
  Duration      3:00
  Size          115.3 MB
  Frame rate    30.00 fps

? Select encoding preset › - Use arrow-keys. Return to submit.
    Maximum Quality         142.8 MB  +24%
    High Quality            127.4 MB  +11%
❯   Balanced (Recommended)  105.2 MB   -9% - Great quality, good size savings (CRF 23)
    Maximum Compression      82.7 MB  -28%
    HEVC High Quality        73.6 MB  -36%
    Custom settings
    Skip

  Encoding
  ──────────────────────────────────────────────────────────────────────────
  Video         libx264, CRF 23, preset slow
  Audio         aac @ 128 kbps

  Encoding  ████████████▍░░░░░░░░  58%  ·  1:12 elapsed  ·  0:52 left  ·  2.4x  ·  ends 14:32

  Result
  ──────────────────────────────────────────────────────────────────────────
  Original      115.3 MB
  Encoded       106.8 MB
  Saved         8.5 MB (7%)
  Backup        clips/interview.backup.mp4

? Delete backup file? › No

  ·   Backup kept at clips/interview.backup.mp4

  OK  Done: clips/interview.mp4
```

Every preset row carries its own estimate, so you can compare them all without
arrowing through them. The progress bar repaints in place and sheds detail on
narrow terminals rather than wrapping; when output is piped it degrades to plain
percentage lines every 10%, keeping logs readable.

### Batch Session

A folder or multiple files is scanned up front, then processed with the settings
chosen for the first encoded file:

```
  Batch
  ──────────────────────────────────────────────────────────────────────────
  Files         40
  Total size    12.4 GB
  Total length  3:24:10
  Unreadable    1

  ── File 7 of 40 ─────────────────────────────── 2.1 GB saved so far ──
  ...

  Summary
  ──────────────────────────────────────────────────────────────────────────
  Encoded       38
  Skipped       1
  Failed        1
  Original      12.4 GB
  Encoded size  5.1 GB
  Saved         7.3 GB (59%)
```

Skipping a file moves on to the next one; only cancelling stops the batch. Files
that fail are reported and counted, and the run exits non-zero.

## Audio Handling

Reencoding lossy audio never recovers what the first encoder discarded, so
targeting a bitrate above the source only stores that generation's artifacts in
a bigger file. Each file's audio is therefore decided independently of the
chosen preset:

| Source audio | Action |
| --- | --- |
| AAC, at or below the preset target | Copied through untouched, bit for bit |
| AAC, above the preset target | Reencoded at the target (a deliberate downscale) |
| Other codec, below the target | Reencoded, capped to the source bitrate |
| Other codec, at or above the target | Reencoded at the target |
| Bitrate unreported by ffprobe | Reencoded at the target |
| No audio stream | Nothing to do |

The encoding panel states which applies, for example:

```
  Audio         copied, no re-encode (already aac at 128 kbps)
  Audio         aac @ 96 kbps (capped to the 96 kbps source)
  Audio         aac @ 320 kbps
```

In a batch the preset is shared across files but this decision is not, since
every source has its own audio. Preset size estimates use the bitrate the audio
will actually end up at, not the preset's nominal target.

Note that ffmpeg's built in AAC encoder is variable rate and saturates around
250-290 kbps for stereo, so a 320 kbps target is a ceiling rather than a promise.

## Video Handling

Like audio, the video stream is decided per file rather than blindly reencoded.

### Reencoding is decided by measurement

Whether reencoding helps cannot be answered from codec names. Codec efficiency
rankings compare codecs *at equal quality*, but a 180 Mbps near-lossless HEVC
capture is nowhere near equal quality: reencoding it to H.264 at CRF 18 measured
**75% smaller**. An already-lean HEVC file at the same settings would grow.

So a short probe encodes a few seconds at the chosen settings and projects the
result. If the reduction clears 10%, the file is reencoded; otherwise it is
copied through untouched with the measured reason given. For the software
encoders the probe uses a faster x264 preset than the real encode, which produces
*larger* output at the same CRF, so it never overstates the benefit. VideoToolbox
has no preset ladder to borrow from, so its probe runs at the real settings:
unbiased rather than conservative, and cheap because the encoder is fast.

Codec rank survives only as a fallback when no measurement is possible. The
container check is a hard constraint and outranks both, which is what fixes
`.webm` input previously failing outright because libx264 cannot be muxed into
it.

### Hardware encoding is detected, not assumed

Apple Silicon carries fixed-function video encoders that VideoToolbox exposes as
`hevc_videotoolbox` and `h264_videotoolbox`. They are worth offering and never
worth substituting silently, so they appear as their own presets rather than
quietly replacing the software ones.

Availability is established by encoding, not by asking. `ffmpeg -encoders`
reports what the binary was compiled with, which is a different question from
what the silicon underneath will accept: the same build lists both encoders on an
Intel Mac and inside a VM with no passthrough, and only fails once a real encode
starts. A trial encode of a fraction of a second settles it, costs about 100 ms
once per run, and hides the presets entirely where it fails.

The quality targets were calibrated rather than chosen. VideoToolbox has no CRF;
it takes `-q:v` on a 0-100 scale running the opposite direction. Measured against
the software presets, `-q:v 65` lands within 0.35 VMAF of libx265 at CRF 24, and
`-q:v 58` within 0.10 VMAF of libx264 at CRF 23.

What that buys, on one six-minute 720p file end to end:

| Preset | Wall clock | Output |
|---|---|---|
| HEVC High Quality (libx265 CRF 24) | 184s | 139.0 MB |
| HEVC Fast (hardware) | 29s | 169.9 MB |

Around six times quicker for a fifth more bytes, and a far larger gap in CPU
time, which is what decides whether a laptop stays cool and charged through a
batch. On the encode alone, excluding decode and I/O, the gap is nearer 14x.

Because those two families do not track each other closely, the preset menu
samples both: one anchor per family, each measured on the real file. On a test
clip the same source measured 2.74 Mbps under libx264 and 3.87 Mbps under
hardware HEVC, so scaling one into the other would have misreported every
hardware row by around 40%.

### Bit depth is preserved

10-bit sources stay 10-bit. Previously they were flattened to 8-bit while their
HDR tags survived, producing a file that claimed to be HDR PQ but had 8-bit
samples, banding included. The pixel format is a clamp rather than a
passthrough: depth is preserved, chroma is constrained to 4:2:0, so exotic
formats like `yuv444p` and `rgb24` do not reach profiles most devices cannot
decode.

Note that libx264 cannot carry HDR10 mastering metadata at all, so HDR sources
are flagged and pointed at the HEVC preset, which can.

### Every stream is kept

ffmpeg's default selection keeps only the best single stream per type, silently
discarding extra audio tracks, extra subtitles and MKV attachments. All streams
are now mapped explicitly and ride along copied.

## Size Estimates

CRF targets a quality level, not a bitrate, so output size depends on content
and cannot be derived from resolution. For files over five minutes, vencode
encodes six three-second samples at the chosen settings and anchors the preset
menu to that measurement. Against full encodes of three 90-second sources, where
the old model predicted an identical 28.2 MB for all three:

| Content | Actual | Old estimate | Sampled estimate |
| --- | --- | --- | --- |
| Low motion | 4.9 MB | +478% | +25% |
| Mixed | 12.0 MB | +134% | +11% |
| High motion | 357.5 MB | -92% | -0.1% |

Sampling costs roughly 18 seconds of encoding regardless of length, so about 6%
at the five-minute threshold and negligible on a feature-length file. Shorter
files skip it and say so.

## Repeat Runs

Every file vencode produces is marked, so a later run recognises its own output
instead of reencoding it into another generation of loss:

```
  !   Already encoded by vencode (recognised by metadata)
  ·   Skipped, no changes made. Use --force to encode it again
```

Two layers, because neither alone covers every case:

| Layer | Covers | Notes |
| --- | --- | --- |
| Embedded tag | `VENCODE` on Matroska, `comment` elsewhere | Travels with the file through moves, renames and copies; survives a stream-copy remux |
| Local index | Everything, including containers that drop tags | `~/.config/vencode/processed.json`, keyed by content so renames still match |

The index key is the file size plus its first and last 4 MB rather than a full
hash: it answers "did this tool make this file" in 0.24s where a full sha256 of
the same 2.8 GB file takes 6.0s, and it still changes whenever the file is
reencoded.

Pass `--force` to reencode anyway.

## Safety Features

- **Interactive Control**: You choose whether to encode, which preset, and whether to keep backup
- **Backup Creation**: Original file is always backed up before replacement
- **Validation**: Encoded file is checked for corruption
- **Atomic Replacement**: File replacement is done safely
- **Automatic Rollback**: If anything fails, backup is restored
- **Skip Option**: Easy to skip files you don't want to reencode
- **Interrupt Safety**: Ctrl+C mid-encode kills ffmpeg, deletes the partial output, and leaves the original file in place
- **No Silent Downgrades**: Codec, bit depth and stream losses are refused or reported, never applied quietly

## Custom Settings

When you select "Custom Settings", you can configure:

- **Video Codec**: Choose between H.264 (libx264) or H.265 (libx265)
- **CRF Value**: Set quality level from 18-28 (lower = better quality)
- **Encoding Preset**: Choose speed vs compression (ultrafast to veryslow)
- **Audio Bitrate**: Set audio quality from 64-320 kbps
