# vencode

Interactive video reencoding tool that analyzes your videos and reencodes them to save space while maintaining indistinguishable quality.

## Features

- **Interactive Preset Selection**: Every preset shows its estimated size and change up front, so the whole menu is comparable at a glance
- **Smart Analysis**: Examines video bitrate, resolution, codec, and audio streams
- **Multiple Quality Presets**: From maximum quality to maximum compression
- **Custom Settings**: Full control over codec, CRF, preset, and audio bitrate
- **Real-time Estimates**: See estimated file size and savings for each preset
- **Safe Operation**: Creates backup before replacing, with automatic rollback on errors
- **Extension Preservation**: Keeps the same file extension (1:1)
- **Progress Tracking**: Live progress bar with elapsed time, ETA, and encoding speed
- **Interactive Backup Management**: Choose whether to keep or delete backup after encoding
- **Batch Overview**: Scans the whole set first, reports total size and length, then tracks a running total and closes with a summary
- **Efficiency Advisory**: Flags files that are already well optimized before you spend time reencoding them
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
| `--preset=<name>` | `MAXIMUM_QUALITY`, `HIGH_QUALITY`, `BALANCED`, `MAXIMUM_COMPRESSION`, `HEVC_HIGH` |
| `--delete-backups` | With `--yes`, remove backups after encoding |
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

All presets use:
- **Preset**: slow (better compression)
- **Pixel Format**: yuv420p (maximum compatibility)

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

Every preset row carries its own estimate, so you can compare all five without
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

## Safety Features

- **Interactive Control**: You choose whether to encode, which preset, and whether to keep backup
- **Backup Creation**: Original file is always backed up before replacement
- **Validation**: Encoded file is checked for corruption
- **Atomic Replacement**: File replacement is done safely
- **Automatic Rollback**: If anything fails, backup is restored
- **Skip Option**: Easy to skip files you don't want to reencode
- **Interrupt Safety**: Ctrl+C mid-encode kills ffmpeg, deletes the partial output, and leaves the original file in place

## Custom Settings

When you select "Custom Settings", you can configure:

- **Video Codec**: Choose between H.264 (libx264) or H.265 (libx265)
- **CRF Value**: Set quality level from 18-28 (lower = better quality)
- **Encoding Preset**: Choose speed vs compression (ultrafast to veryslow)
- **Audio Bitrate**: Set audio quality from 64-320 kbps
