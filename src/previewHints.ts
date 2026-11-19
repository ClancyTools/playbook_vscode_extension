import { colorAnnotations } from "./colorTokens"
import { kitColorAnnotations, loadKitColors } from "./kitColors"
import { loadColorTokens } from "./colorTokens"
import { InlineHints } from "./inlineHints"

/** A box showing the real color next to a Playbook color token (playbook.colorSwatches). */
export class ColorSwatches extends InlineHints {
  constructor(extensionPath: string) {
    super(extensionPath, "colorSwatches", (text, languageId, metadata) => [
      ...colorAnnotations(text, languageId, metadata, loadColorTokens(extensionPath)),
      ...kitColorAnnotations(text, languageId, metadata, loadKitColors(extensionPath)),
    ])
  }
}
