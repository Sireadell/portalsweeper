import { defineConfig } from "vitest/config";

// Challenge tests play whole boards, so give them room when the machine is busy.
export default defineConfig({ test: { testTimeout: 30_000 } });
