import { colorAnnotations } from "./colorTokens"
import { kitColorAnnotations, loadKitColors } from "./kitColors"
import { loadColorTokens } from "./colorTokens"
import { InlineHints } from "./inlineHints"

/** A box showing the real color next to a Playbook color token (playbook.colorSwatches). */
export class ColorSwatches extends InlineHints {
  constructor(extensionPath: string) {
    super(extensionPath, "colorSwatches", (text, languageId, metadata) => {
      // A kit's own meaning of a name (Body "light") wins over the same-named token.
      const kit = kitColorAnnotations(text, languageId, metadata, loadKitColors(extensionPath))
      const own = new Set(kit.map((a) => a.offset))
      const tokens = colorAnnotations(text, languageId, metadata, loadColorTokens(extensionPath))
      return [...tokens.filter((a) => !own.has(a.offset)), ...kit]
    })
  }
}
