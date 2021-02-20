import { fontFamily as _fontFamily } from 'tailwindcss/defaultTheme'

export const purge = []
export const darkMode = false
export const theme = {
  extend: {
    fontFamily: {
      sans: ['Catamaran', ..._fontFamily.sans],
    }
  },
}
export const variants = {
  extend: {},
}
export const plugins = []
