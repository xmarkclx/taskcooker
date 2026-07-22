# Bundled Font Provenance — JetBrainsMono Nerd Font Mono

This directory vendors a Nerd Fonts-patched version of **JetBrains Mono** so the
embedded xterm.js terminal renders CLI icons and powerline glyphs (e.g. nvim,
starship, lazygit) on machines that do not have a Nerd Font installed.

The upstream source release is pinned below and the complete third-party
license is included alongside (`LICENSE-OFL.txt`).

## Source (pinned)

- Project: Nerd Fonts — https://github.com/ryanoasis/nerd-fonts
- Release tag: **v3.4.0**
- Release page: https://github.com/ryanoasis/nerd-fonts/releases/tag/v3.4.0
- Asset downloaded: `JetBrainsMono.zip`
- Asset URL: https://github.com/ryanoasis/nerd-fonts/releases/download/v3.4.0/JetBrainsMono.zip
- Downloaded: 2026-06-22

## Upstream font

- Family: JetBrains Mono
- Upstream repo: https://github.com/JetBrains/JetBrainsMono
- Upstream version embedded in this Nerd Fonts release: **2.304**
- Patched by: Nerd Fonts patcher (v3.4.0)
- Variant chosen: **Mono** (`Nerd Font Mono` / `NFM`). The Nerd Fonts README
  recommends the `Mono` variant for monospaced/terminal contexts so every glyph
  occupies exactly one cell and terminal grid alignment is preserved.

## Files vendored (unmodified from the release archive)

Only the four weights/styles xterm.js needs are bundled (Regular, Italic, Bold,
BoldItalic). The release archive contains many more weights; they are not
included to keep the app bundle lean.

| File | Style | Weight | SHA-256 |
| --- | --- | --- | --- |
| `JetBrainsMonoNerdFontMono-Regular.ttf` | normal | 400 | `f01031f40e48dc29e1112e6b0b0450a2c6cd097f3f35cfff05c55cb311f8034c` |
| `JetBrainsMonoNerdFontMono-Italic.ttf` | italic | 400 | `ccd88b36d325e6a905edc8dd3f2522718d9690d9bed3fbb4684c7e746c34f846` |
| `JetBrainsMonoNerdFontMono-Bold.ttf` | normal | 700 | `5bdd4a873f3cd32f882d2c55545089123926e27707d5880fc9eaf84eb01b6686` |
| `JetBrainsMonoNerdFontMono-BoldItalic.ttf` | italic | 700 | `d931df2928b3216892d35980cddcad9edade1b9c9cd2e09a6c2937139f474742` |

Release archive SHA-256 (for reference): `76f05ff3ace48a464a6ca57977998784ff7bdbb65a6d915d7e401cd3927c493c`

## CSS font-family name

The bundled @font-face family is declared as `JetBrainsMono Nerd Font Mono`,
which matches the internal name table of these files. The terminal font stack
(`--font-mono` / `--terminal-font-family`) lists it first so the bundled font is
preferred, with installed Nerd Fonts and system monospace fonts as fallbacks.

## License

JetBrains Mono and its Nerd Fonts-patched derivatives are licensed under the
**SIL Open Font License, Version 1.1**. The complete license text is in
`LICENSE-OFL.txt`. The OFL permits bundling, embedding, and redistribution with
software provided the copyright notice and license are included (which they
are, here and in `LICENSE-OFL.txt`).
