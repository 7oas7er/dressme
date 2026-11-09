# Third-party notices

## dictionary-of-colour-combinations (MIT)

DressMe vendors a slim Vol. 1 colour list (English names + hex + derived HSL) derived from:

- **Package:** [`dictionary-of-colour-combinations`](https://www.npmjs.com/package/dictionary-of-colour-combinations) **1.0.2**
- **Upstream:** [mattdesl/dictionary-of-colour-combinations](https://github.com/mattdesl/dictionary-of-colour-combinations)
- **License:** MIT (Copyright © 2020 Matt DesLauriers)

The dataset was originally compiled and open-sourced by **Dain M. Blodorn Kim** ([@dblodorn](https://github.com/dblodorn) / [dblodorn/sanzo-wada](https://github.com/dblodorn/sanzo-wada)). Colour names and combinations relate historically to Sanzo Wada’s *Haishoku Sōkan* / *A Dictionary of Colour Combinations*.

DressMe does **not** ship Seigensha book scans, page layouts, or Seigensha product branding. Hex values are approximate CMYK→sRGB conversions suitable for wardrobe tagging, not print matching.

Vendored files:

- `web/src/data/wada-colors.v1.json`
- `infra/lambda/wadaPalette.js` (ID allow-list twin)

Regenerate with `scripts/vendor-wada-colors.mjs` after unpacking the npm package’s `colors.json`.

### MIT License (upstream)

```
The MIT License (MIT)
Copyright (c) 2020 Matt DesLauriers

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the Software), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED AS IS, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
