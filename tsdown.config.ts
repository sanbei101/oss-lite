import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./oss.ts'],
  dts: true,
  format: "esm"
})