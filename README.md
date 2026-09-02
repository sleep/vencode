# vencode

Interactive video reencoding tool that analyzes your videos and reencodes them to save space while maintaining indistinguishable quality.

## Features

- **Interactive Preset Selection**: Choose from multiple quality presets or create custom settings
- **Smart Analysis**: Examines video bitrate, resolution, codec, and audio streams
- **Multiple Quality Presets**: From maximum quality to maximum compression
- **Custom Settings**: Full control over codec, CRF, preset, and audio bitrate
- **Real-time Estimates**: See estimated file size and savings for each preset
- **Safe Operation**: Creates backup before replacing, with automatic rollback on errors
- **Extension Preservation**: Keeps the same file extension (1:1)
- **Progress Tracking**: Shows encoding progress in real-time
- **Interactive Backup Management**: Choose whether to keep or delete backup after encoding

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

# Show help
node index.js --help
```

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
- **Audio**: 192 kbps AAC
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
📹 Analyzing: /path/to/video.mp4

📊 Video Information:
  Resolution: 1920x1080
  Codec: h264
  Bitrate: 5200 kbps
  Duration: 180s
  Size: 115.3 MB
  FPS: 30.00

? Select encoding preset: (Use arrow keys)
❯ Maximum Quality - Visually lossless, larger file size (CRF 18) - Est. size: 142.8 MB - Increase 27.5 MB (24%)
  High Quality - Excellent quality, good compression (CRF 20) - Est. size: 127.4 MB - Increase 12.1 MB (11%)
  Balanced (Recommended) - Great quality, good size savings (CRF 23) - Est. size: 105.2 MB - Save 10.1 MB (9%)
  Maximum Compression - Smaller size, slight quality loss (CRF 26) - Est. size: 82.7 MB - Save 32.6 MB (28%)
  HEVC High Quality - Best compression with HEVC/H.265 (CRF 24) - Est. size: 73.6 MB - Save 41.7 MB (36%)
  Custom Settings - Enter your own encoding parameters
  Skip - Do not reencode this file

🎬 Starting encoding...
  Codec: libx264
  CRF: 23
  Preset: slow
  Audio: aac @ 128k

  Progress: 25%
  Progress: 50%
  Progress: 75%
  Progress: 100%

✅ Encoding complete!

💾 Replacing original file...

✨ Success!
  Original size: 115.3 MB
  New size: 106.8 MB
  Space saved: 8.5 MB (7%)
  Backup: /path/to/video.backup.mp4

? Delete backup file? (y/N) › No
✅ Backup kept at: /path/to/video.backup.mp4
```

## Safety Features

- **Interactive Control**: You choose whether to encode, which preset, and whether to keep backup
- **Backup Creation**: Original file is always backed up before replacement
- **Validation**: Encoded file is checked for corruption
- **Atomic Replacement**: File replacement is done safely
- **Automatic Rollback**: If anything fails, backup is restored
- **Skip Option**: Easy to skip files you don't want to reencode

## Custom Settings

When you select "Custom Settings", you can configure:

- **Video Codec**: Choose between H.264 (libx264) or H.265 (libx265)
- **CRF Value**: Set quality level from 18-28 (lower = better quality)
- **Encoding Preset**: Choose speed vs compression (ultrafast to veryslow)
- **Audio Bitrate**: Set audio quality from 64-320 kbps
