/**
 * Terminal UI primitives: colour, layout, and in-place progress rendering.
 *
 * Deliberately dependency-free ANSI so the CLI stays small and predictable.
 */

const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

const INTERACTIVE = Boolean(process.stdout.isTTY);

const COLOR_ENABLED =
  INTERACTIVE &&
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb';

const wrap = (open, close) => (text) =>
  COLOR_ENABLED ? `${ESC}[${open}m${text}${ESC}[${close}m` : String(text);

export const style = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39)
};

const MIN_WIDTH = 40;
const MAX_WIDTH = 100;
const INDENT = '  ';
const LABEL_WIDTH = 14;

/** Usable render width, clamped so output stays readable on very wide terminals. */
export function termWidth() {
  const columns = process.stdout.columns || 80;
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, columns));
}

/** Length of a string ignoring ANSI escape sequences. */
function visibleLength(text) {
  return text.replace(ANSI_PATTERN, '').length;
}

const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;
const CLEAR_LINE = `${ESC}[2K`;

// Cursor visibility is process-global state, so it is tracked once here rather
// than per progress bar: a long batch would otherwise pile up exit listeners.
let cursorHidden = false;

export function hideCursor() {
  if (!INTERACTIVE || cursorHidden) return;
  process.stdout.write(HIDE_CURSOR);
  cursorHidden = true;
}

export function showCursor() {
  if (!cursorHidden) return;
  process.stdout.write(SHOW_CURSOR);
  cursorHidden = false;
}

process.on('exit', showCursor);

/** Section heading followed by a full-width rule. */
export function heading(text) {
  const rule = '─'.repeat(termWidth() - INDENT.length);
  process.stdout.write(`\n${INDENT}${style.bold(text)}\n${INDENT}${style.gray(rule)}\n`);
}

/** Aligned `label   value` row. */
export function field(label, value, width = LABEL_WIDTH) {
  const paddedLabel = String(label).padEnd(width);
  process.stdout.write(`${INDENT}${style.gray(paddedLabel)}${value}\n`);
}

/**
 * Divider announcing one item of a batch, with an optional right-aligned note
 * for running totals: `── File 7 of 40 ──────── 2.1 GB saved ──`
 */
export function divider(text, note = null) {
  const prefix = `${INDENT}${style.gray('──')} ${style.bold(text)} `;
  const suffix = note ? ` ${style.gray(note)} ${style.gray('──')}` : '';
  const fill = Math.max(
    2,
    termWidth() + INDENT.length - visibleLength(prefix) - visibleLength(suffix)
  );
  process.stdout.write(`\n${prefix}${style.gray('─'.repeat(fill))}${suffix}\n`);
}

export function blank() {
  process.stdout.write('\n');
}

export function line(text = '') {
  process.stdout.write(`${INDENT}${text}\n`);
}

export function success(text) {
  line(`${style.green('OK')}  ${text}`);
}

export function warn(text) {
  line(`${style.yellow('!')}   ${text}`);
}

export function fail(text) {
  line(`${style.red('ERR')} ${text}`);
}

export function info(text) {
  line(`${style.gray('·')}   ${text}`);
}

/** Seconds to `1:04:09` / `4:09` / `0:09`. */
export function formatDuration(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '--:--';

  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (n) => String(n).padStart(2, '0');

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

/** Local wall-clock time as `14:32`. */
export function formatClock(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** ffmpeg timemark ("00:01:23.45") to seconds. */
export function parseTimemark(timemark) {
  if (typeof timemark !== 'string') return null;

  const parts = timemark.split(':').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;

  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

// Eighth-width blocks give the bar sub-character resolution, so it advances
// smoothly instead of jumping a whole cell at a time.
const PARTIALS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];
const FULL_BLOCK = '█';
const EMPTY_BLOCK = '░';

function renderBar(fraction, width) {
  const eighths = Math.round(Math.min(Math.max(fraction, 0), 1) * width * 8);
  const full = Math.floor(eighths / 8);
  const partial = full < width ? PARTIALS[eighths % 8] : '';
  const filled = FULL_BLOCK.repeat(full) + partial;
  const empty = EMPTY_BLOCK.repeat(Math.max(0, width - filled.length));

  return style.cyan(filled) + style.gray(empty);
}

const REDRAW_INTERVAL_MS = 100;
const NON_TTY_STEP_PERCENT = 10;
const ETA_SMOOTHING = 0.2;
const SEPARATOR = '  ·  ';
const COMFORTABLE_BAR = 12;
const MINIMUM_BAR = 8;

// Richest layout first. The first one whose bar still reaches COMFORTABLE_BAR
// wins, so narrow terminals shed detail instead of wrapping. The choice depends
// only on terminal width, so it stays stable frame to frame.
const LAYOUTS = [
  { label: true, fields: ['elapsed', 'left', 'rate', 'ends'] },
  { label: true, fields: ['elapsed', 'left', 'rate'] },
  { label: true, fields: ['elapsed', 'left'] },
  { label: true, fields: ['left'] },
  { label: false, fields: ['left'] },
  { label: false, fields: [] }
];

/**
 * Smoothed estimate of the seconds remaining.
 *
 * A raw `elapsed / fraction` projection is jumpy because encoding throughput
 * swings with scene complexity, so successive readings are blended into an
 * exponential moving average.
 */
function estimateRemaining(previousEstimate, elapsedSeconds, fraction) {
  if (fraction <= 0) return null;

  const projected = (elapsedSeconds / fraction) * (1 - fraction);
  if (previousEstimate === null) return projected;

  return previousEstimate * (1 - ETA_SMOOTHING) + projected * ETA_SMOOTHING;
}

// The bar currently owning the terminal line, so an interrupt can release it.
let activeBar = null;

/** Release any live progress bar, e.g. from a signal handler. */
export function abortActiveProgress() {
  if (activeBar) activeBar.abort();
}

/**
 * An in-place progress bar. Falls back to periodic plain lines when stdout is
 * not a TTY (piped output, CI logs), where carriage-return repainting is noise.
 *
 * @param {string} label - Left-hand caption, e.g. "Encoding".
 */
export function createProgressBar(label) {
  const startedAt = Date.now();

  let remainingEstimate = null;
  let lastSpeed = null;
  let lastRedrawAt = 0;
  let lastLoggedPercent = -NON_TTY_STEP_PERCENT;
  let closed = false;

  // A resize invalidates the current line, so force an immediate repaint.
  const onResize = () => { lastRedrawAt = 0; };

  if (INTERACTIVE) {
    hideCursor();
    process.stdout.on('resize', onResize);
  }

  // Each field is padded to a fixed width so the bar keeps a constant length
  // instead of growing and shrinking as the numbers change.
  function buildFields(speed) {
    const elapsed = formatDuration((Date.now() - startedAt) / 1000).padStart(5);
    const left = (remainingEstimate === null ? '--:--' : formatDuration(remainingEstimate)).padStart(5);
    const ends = remainingEstimate === null
      ? '--:--'
      : formatClock(new Date(Date.now() + remainingEstimate * 1000));

    return {
      elapsed: `${elapsed} elapsed`,
      left: `${left} left`,
      rate: (speed ? `${speed.toFixed(1)}x` : '').padStart(5),
      ends: `ends ${ends}`
    };
  }

  function compose(fraction, speed) {
    const percent = style.bold(`${String(Math.floor(fraction * 100)).padStart(3)}%`);
    const available = buildFields(speed);

    let rendered = null;

    for (const layout of LAYOUTS) {
      const caption = layout.label ? `${style.gray(label)}  ` : '';
      const meta = [percent, ...layout.fields.map((name) => available[name])];
      const suffix = `  ${meta.join(style.gray(SEPARATOR))}`;
      const barWidth =
        termWidth() - INDENT.length - visibleLength(caption) - visibleLength(suffix);

      rendered = `${INDENT}${caption}${renderBar(fraction, Math.max(MINIMUM_BAR, barWidth))}${suffix}`;
      if (barWidth >= COMFORTABLE_BAR) break;
    }

    return rendered;
  }

  const bar = {
    /**
     * @param {number} fraction - Completion in the range 0-1.
     * @param {number} [speed] - Encoding throughput relative to realtime.
     */
    update(fraction, speed) {
      if (closed) return;

      const clamped = Math.min(Math.max(fraction, 0), 1);
      const elapsed = (Date.now() - startedAt) / 1000;
      lastSpeed = speed ?? lastSpeed;
      remainingEstimate = estimateRemaining(remainingEstimate, elapsed, clamped);

      if (!INTERACTIVE) {
        const percent = Math.floor(clamped * 100);
        if (percent >= lastLoggedPercent + NON_TTY_STEP_PERCENT) {
          lastLoggedPercent = percent - (percent % NON_TTY_STEP_PERCENT);
          line(`${label} ${lastLoggedPercent}%`);
        }
        return;
      }

      const now = Date.now();
      if (now - lastRedrawAt < REDRAW_INTERVAL_MS) return;
      lastRedrawAt = now;

      process.stdout.write(`\r${CLEAR_LINE}${compose(clamped, speed)}`);
    },

    /** Repaint at 100% and release the line. */
    finish() {
      if (closed) return;
      this.release();

      if (INTERACTIVE) {
        remainingEstimate = 0;
        process.stdout.write(`\r${CLEAR_LINE}${compose(1, lastSpeed)}\n`);
      } else if (lastLoggedPercent < 100) {
        line(`${label} 100%`);
      }
    },

    /** Abandon the line without claiming completion. */
    abort() {
      if (closed) return;
      this.release();

      if (INTERACTIVE) process.stdout.write(`\r${CLEAR_LINE}`);
    },

    /** Detach listeners and give the cursor back. */
    release() {
      closed = true;
      if (activeBar === bar) activeBar = null;
      if (INTERACTIVE) {
        process.stdout.off('resize', onResize);
        showCursor();
      }
    }
  };

  activeBar = bar;
  return bar;
}
