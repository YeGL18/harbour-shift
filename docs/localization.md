# Interface languages

Settings provides four persisted interface choices: Cantonese (`zh-HK`, the default), formal Traditional Chinese (`zh-Hant`), Simplified Chinese (`zh-Hans`) and English (`en`). The language choice is separate from appearance, device language and single-player game saves. Navigation waits for locale hydration, avoiding an initial frame in the wrong language.

`src/i18n/store.ts` persists the choice in AsyncStorage. Writes are serialized and hydration cannot overwrite a newer explicit choice. A failed write leaves the current language active and Settings displays a retry message.

`src/i18n/index.tsx` supplies reactive `LocalizedText`, `LocalizedPressable`, `LocalizedTextInput` and `LocalizedSwitch`. These translate complete primitive text compositions, placeholders and accessibility labels, hints and textual values. Non-text values and user-entered input are unchanged. Native navigation titles, alerts and share messages use `t()` explicitly. Components computing place names also subscribe through `useLocale()`.

`translateForLocale()` is available without importing the native UI runtime. Reviewed written-Chinese strings and complete sentence templates live in `zh.json` and `zh-templates.json`; the formal version replaces colloquial phrasing rather than only changing characters. Simplified mode also converts remaining named places with the static character table. The table was generated using the platform's Traditional–Simplified conversion, with explicit written-Chinese sentences reviewed separately. `en.ts` contains full English strings and templates, including explanations, server errors, game logs and service-station price caveats. Translation results use a bounded cache.

`getLocalizedPlaceName()` prefers each actual record's official `nameEn`. `getLocalizedLocality()` uses the official bilingual area/town/island anchor. Embedded road names use the official Transport Department Chinese/English mapping. A name without an unambiguous English source retains its source form. Player nicknames are always rendered with `translate={false}` so a nickname such as `尖沙咀` is not converted into a place name. Room codes remain unchanged. Place search normalizes both Traditional and Simplified input, plus full-width Latin input.

The shared time input keeps a 12-hour shift: day defaults to 05:00 and night to 17:00. Multiplayer displays the authoritative room time, not a player’s local preference; the host applies a time draft once, resetting readiness through the server. Game sounds have their own persisted switch and follow media volume.

## Verification

Run:

```sh
node --import tsx scripts/audit-i18n.cjs --strict
node --import tsx --test src/i18n/*.test.ts src/multiplayer/*.test.ts src/data/localities.test.ts
npx tsc --noEmit
```

The audit recursively extracts source strings, pure JSX text and complete dynamic templates from UI, map, game, data, multiplayer and server/shared code. It also includes the visible station-price caveats from the JSON catalogue. At the current review, it checks 548 exact source strings and 89 source templates, with no missing written-Chinese entries, missing English entries or untranslated Chinese remaining in sampled English templates. Unknown runtime strings are exposed through `getUntranslatedStrings()` for further QA; a source audit alone does not prove every composed runtime message or native layout.

The focused checks cover real place/locality records, English explanations and dynamic logs, nickname preservation, formal versus colloquial wording, Simplified characters, currency/numeric templates, placeholder integrity, room setup/status, common clock rules and transport behavior. New time-input, audio and short-loop explanations are covered in all four languages. Typecheck passed during integration.

Focused Android and iOS native runs on 19 November 2026 exercised all four choices in Garage and a real two-player room. The Android room was running; the iOS language case used a live lobby, alongside a separate iOS running-match case. The observed Garage headings distinguished colloquial Cantonese, formal written Traditional Chinese, Simplified Chinese and English. English displayed official bilingual place and road names. After a force-stop/cold launch, English and the actual room session persisted. In all four room locales, the nickname `尖沙咀` and the room code remained unchanged. The native recordings and numbered screenshots are described in `multiplayer-ui-qa.md`.

Native review caught composed strings that a sampled static inventory did not cover: the surge income suffix and the Lobby/Room section headings. Specific complete-string templates and focused tests now cover `預計司機收入 · 1.15×`, `建立房間 · 2–8位玩家`, `即時名次 · 07:38` and the matching finished-results variant. The visible map label `選路` uses the short English `Route` to fit its 44pt control, while the accessibility description stays complete. The same review corrected the remaining observed multiplayer custom-wrapper labels, player counts with/without the host suffix, and actual vehicle/status compositions. The source audit now explicitly recognizes `SectionLabel` and `SupportingText`, including the static strings in Lobby and Room. Nineteen focused i18n tests pass; the composition tests exercise the actual four-vehicle catalogue and server-derived lobby status function, including fallback vehicle labels. The final dictionary-only corrections were subsequently seen on the latest iOS simulator bundle: Local garage setup, Players 1/8 with host suffix, Kam Fung taxi · Not ready, and the surge-income caption all appeared in English. This iOS observation is distinct from the earlier Android functional candidate’s installed bytes.

The focused native observations do not prove every runtime composition, all screens at every text size, every accessibility description or every networking error. The final iOS XCTest run passed all three real-backend cases, including four-language Room/Garage checks, raw-nickname preservation and English/room persistence after relaunch. Selected full-resolution attachments and native recording frames were inspected; the online map screenshot waits for rendered roads rather than accepting the loading state. VoiceOver/TalkBack, XL Dynamic Type, physical-device/TestFlight installation and the longer offline/finished-match matrix remain pending. System-owned sheets and keyboard controls follow the operating system's language.
