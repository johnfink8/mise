import { createTheme } from '@mui/material/styles'

/**
 * "Lobby Card" palette — editorial cinematheque dark.
 * Warm near-black + off-white + single emerald accent.
 */
export const LOBBY = {
  bg: '#0c0b09',
  bgEl: '#15130f',
  border: 'rgba(240,232,217,0.10)',
  text: '#f0e8d9',
  dim: 'rgba(240,232,217,0.55)',
  faint: 'rgba(240,232,217,0.30)',
  accent: '#7fdca4',
  accentInk: '#06170d',
} as const

const FONT_BODY = '"Inter", system-ui, -apple-system, sans-serif'
const FONT_DISPLAY = '"Instrument Serif", "Iowan Old Style", Georgia, serif'
const FONT_MONO = '"JetBrains Mono", ui-monospace, "SFMono-Regular", monospace'
const FONT_BUTTON = '"Space Grotesk", "Inter", system-ui, sans-serif'

export const FONTS = {
  body: FONT_BODY,
  display: FONT_DISPLAY,
  mono: FONT_MONO,
  button: FONT_BUTTON,
} as const

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: LOBBY.accent, contrastText: LOBBY.accentInk },
    background: { default: LOBBY.bg, paper: LOBBY.bgEl },
    text: { primary: LOBBY.text, secondary: LOBBY.dim },
    divider: LOBBY.border,
  },
  typography: {
    fontFamily: FONT_BODY,
    h1: {
      fontFamily: FONT_DISPLAY,
      fontWeight: 400,
      fontSize: '4rem',
      lineHeight: 0.95,
      letterSpacing: '-0.02em',
    },
    h2: {
      fontFamily: FONT_DISPLAY,
      fontWeight: 400,
      fontSize: '2.4rem',
      lineHeight: 1.0,
      letterSpacing: '-0.01em',
    },
    h3: {
      fontFamily: FONT_DISPLAY,
      fontWeight: 400,
      fontSize: '1.6rem',
      lineHeight: 1.05,
    },
    overline: {
      fontFamily: FONT_MONO,
      fontSize: 10,
      letterSpacing: '0.22em',
      fontWeight: 400,
    },
  },
  shape: { borderRadius: 4 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: LOBBY.bg,
          color: LOBBY.text,
          fontFamily: FONT_BODY,
          textRendering: 'optimizeLegibility',
          WebkitFontSmoothing: 'antialiased',
        },
      },
    },
  },
})
