# Folio · Invoice-first design

Revision: 1 November 2026

## Reference study

The final direction comes from viewing the actual [iPhone](https://www.apple.com/iphone/), [MacBook Air](https://www.apple.com/macbook-air/), and [iCloud](https://www.apple.com/icloud/) pages, including opening compositions and later sections. The earlier Envato references are not the basis of this version.

The observed iPhone category title was 80px, product titles 56px, and introductory text 28px at the desktop width inspected. Title weight was 600, with restrained tracking. Large visuals explained the actual product, while navigation stayed on a quiet horizontal line. White and soft gray established rhythm; blue identified actions. These observations inform a document tool, not a reproduction of an Apple sales page.

Apple's [design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles/) and [materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials) support the same hierarchy and restraint.

## Typography

Apple's live pages use SF Pro Display and SF Pro Text. The prior Folio font stack rendered as Segoe UI on Windows. This version uses a bundled Hanken Grotesk variable font, with no Segoe UI, Georgia, Inter or Helvetica font stack. It loads from Folio's own origin under the SIL Open Font License included in public/fonts.

Hanken Grotesk is a distinct licensed typeface, not Apple's font. Sources: [type designer's repository](https://github.com/marcologous/hanken-grotesk), [Google Fonts source](https://github.com/google/fonts/tree/main/ofl/hankengrotesk), and [Apple typography information](https://developer.apple.com/fonts/).

## Composition

The dashboard rail, four summary tiles, decorative paper stack, capitalized micro-labels, and repeated boxed panels are removed. The opening is one page title, an upload action, and a real invoice preview. A plain queue follows. Fictional control scenarios sit in a clearly labeled disclosure section.

The preview is rendered from the exact privacy-edited PDF the review action uploads. Switching between tax-invoice and e-invoice examples changes the actual source. The decision screen uses larger reading text, open sections, and a PDF beside its explanation on desktop. On narrow screens, the decision leads and source links keep the original accessible.

## Indian documents

The featured documents are genuine Turnitin India invoices published by Vignan and MIT-ADT. See public/samples/india/SOURCES.md for the original URLs, excerpt pages and privacy edits. Invoice identities, amounts, tax values and layouts are retained. No fictional Indian purchase orders or previous obligations are added.

Folio handles rupee formatting, lakh grouping, explicitly stated GST component arithmetic, and the fully labeled totals row in the included IRP print. It does not verify GST rates, place of supply, GSTIN authenticity, IRNs, QR signatures or the GST portal. Local extraction still requires source confirmation. Missing purchasing records remain review tasks.

INR and USD purchases stay in their own currencies. Demo price-variance limits are the lower of 2% and INR 100, or 2% and USD 20. These are independent policy caps, not exchange-rate equivalents.

## Accessibility and verification

Keyboard focus, the skip link, named controls, search and upload shortcuts, and reduced-motion/transparency preferences remain supported. Responsive checks cover narrow panels, phone and desktop widths. Font verification checks the loaded font rather than only the declared family. Financial regressions cover Indian grouping, currency isolation, missing purchase records, GST arithmetic, and separation of columns in the actual e-invoice layout.
