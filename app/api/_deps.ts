// One place to swap the chain stub for the real module once the chain session lands it:
// change the second line to export from "@/lib/chain".
export { generateBoard, saltCommit } from "@/lib/engine";
export { getPotMeta } from "@/lib/chain";
