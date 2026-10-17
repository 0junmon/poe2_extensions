# Chrome extension

> 코드 원본은 `poe2_extensions`입니다. `package.json`은 `pipeline/`에 있으므로
> 빌드 명령은 그 폴더에서 실행합니다.

1. Set the data root once per shell, then move to `pipeline/`:
   ```powershell
   $env:POBKR_ROOT = 'C:\Users\Administrator\Documents\poe2_translation'
   cd C:\Users\Administrator\Documents\poe2_extensions\pipeline
   ```
2. Run `npm run build:extension` (output: `..\dist\poe-ninja-korean`).
3. Open `chrome://extensions` and enable Developer mode.
4. Select **Load unpacked** and choose `dist/poe-ninja-korean`.

The generated extension includes the translation dictionaries, so it does not
download translation data from GitHub when a poe.ninja page opens. Rebuild the
extension after changing the userscript or translation JSON files.
## Data layout

`translations/` is grouped by what the rows describe:

| Folder | Files | Contents |
| --- | --- | --- |
| `lines/` | `item_mod_lines.json`, `skill_gem_lines.json`, `stat_lines.json`, `flavour_text.json`, `keyword_definitions.json` | line level game text: item mod lines, skill gem tooltip lines, the `.csd` stat templates, the item/unique description lines ("Only a madman would ignore a god's instructions." → `미치지 않고서야 어찌 신의 말씀을 무시할 수 있단 말인가.`) and the keyword tooltip bodies |
| `names/` | `name_dictionary.json`, `game_terms.json`, `mods.json`, `keywordpopups.json`, `area_and_quest_names.json`, `character_classes.json` | proper names: the game name dictionary (unique, area, NPC names), the merged name/term table (passives, buffs, monsters, skills, NPCs, effect labels), the `mods` and `keywordpopups` tables that are generated separately, world areas + map pins + quests, character classes |
| `items/` | `base_items.json`, `base_item_variants.json`, `unique_items.json`, `item_classes.json`, `item_class_singulars.json` | item names and their classes (the variants are the base names that only appear in a unique line, such as `Shrine Sceptre (Legacy)` or the generic `Ring`) |
| `general/` | `poe_ninja.json`, `keyword.json`, `custom.json` | the poe.ninja interface labels, the curated keywords/terms and the manual overrides |

`npm run verify:data` checks JSON shapes, placeholders, load-order conflicts,
exact-vs-template shadowing and (with `--strict-dist`) the dist copy, without a browser.

Load order of the content script (and of `search-payload.js`): the interface labels, then
`CORE_DATA_FILES`, then the line data, then **`keyword.json`** (wins over the harvested game
data) and finally **`custom.json`** (wins over every other file). Both are `{id, ko}` rows and
they are the files to edit by hand.

`custom.json` rows may use placeholders:

* `{0}` — one value, looked up as its own translation when it is a name (`Spectre: {0}`) and
  used as it is when it is a number, so a single row covers every percentage the page shows
  (`{"id":"Converted from Physical ({0}%)","ko":"물리 피해에서 전환 ({0}%)"}`).
* `#` — the same style the line data files use: any number of values, and the Korean side may
  reorder them with `{0}`/`{1}`
  (`{"id":"Provides # Units of Raw # Lifeforce when Harvested","ko":"수확 시 미가공 {1} 생기 {0}개 제공"}`).
  A `#` row from `custom.json` overrides the same template coming from a line file.

Rows whose id or value contains `[UNUSED]` or `[DNT-UNUSED]` are dropped while generating
(`build_translation_map.py`, `build_*.mjs`), so no such placeholder reaches the data set.

The row format is the same everywhere (`{id, ko}`; a `table` field is optional and is only
used by the local audit tools — the content script looks up `id` only, and
`npm run clean:translations` drops it). The paths are
listed in `STAT_LINE_DATA_FILES` / `CORE_DATA_FILES` / `INTERFACE_DATA_FILE` / `KEYWORD_DATA_FILE`
/ `CUSTOM_DATA_FILE`
of the userscript, in `scripts/build_chrome_extension.mjs`, and in `index.js` /
`search-payload.js` for the npm package and the demo page, so a move has to be applied in
all of them.

`translations/items/item_class_singulars.json` has two sections that
`build_translation_map.py` writes next to the other tables:

* `custom` — first, the entries a person added by hand in
  `itemclass_singulars_source.json` (plural name -> singular name, underscores count
  as spaces),
* `generated` — the plural -> singular pairs that actually change, keyed both by
  class id (`Warstaff`) and by the plural `ItemClasses.Name` (`Quarterstaves`), with
  the singular taken from the class name and its `itemclasscategories` display name.
  Pairs whose plural already equals the singular (`Shield -> Shield`) are left out.

A custom entry is matched by `ItemClasses.Name` first and by `ItemClasses.Id` second
and wins over the rule (so a `Name`-less class such as `Meta Skill Gem` can be filled
through its id). `items/base_items.json` stores that singular name in its `itemClass`
field — classes without a name in `itemclasses.json` get no `itemClass`. Each run
prints the overrides and the skipped classes.

`translations/items/item_classes.json` is a plain `{"<id>": "<Korean>"}` map (the
mapping is 1:1); `index.js` and the userscript accept both that map and the older
array of `{id, ko}` rows, so a pinned older data set keeps working.

## In-page widget

The content script adds a single floating button in the bottom-right corner of poe.ninja:

* the `한` / `영` button switches between the Korean translation and the original
  English text. The original text nodes and attributes are remembered while
  translating, so switching back restores the page exactly. (The in-page search box was
  removed: Korean lookups go through poe.ninja's own "Search filters..." box, see below.)

`korean-search.html` shows the same resolution with the Korean and English name next to
each other.

## Item attributes and stats

`translations/lines/item_mod_lines.json` holds the attribute/stat texts of the official
trade API, paired between

* English — `https://www.pathofexile.com/api/trade2/data/stats`
* Korean — `https://kr.pathofexile.com/api/trade2/data/stats`
  (`https://poe.game.daum.net/api/trade2/data/stats` serves the same list)

Both sites publish the same stat ids (`explicit.stat_3299347043`,
`pseudo.pseudo_total_life`), so `npm run build:trade-stats` pairs the two lists
by id. `#` is the value placeholder of the trade syntax:

| English | Korean |
| --- | --- |
| `# to maximum Life` | `생명력 최대치 #` |
| `Adds # to # Physical Damage` | `물리 피해 #~# 추가` |
| `Cannot be Frozen` | `동결될 수 없음` |

The content script turns every `#` into a numeric placeholder and tries these
stat templates right after the exact names, so `+35 to maximum Life` becomes
`생명력 최대치 +35` and `Adds 5 to 12 Physical Damage` becomes `물리 피해 5~12 추가`
(rows without a `#` are matched as exact text). The load log reports them as
`속성번역수`. The stat rows are only used for display: they are not added to the
search aliases, so the filter search payload stays unchanged.

poe.ninja draws one attribute line as several `<span>`s when the line contains
keyword tooltips, e.g.
`<span>30% increased </span><span>Charm</span><span> Charges gained</span>`.
`translateStatLine()` therefore joins the `<span>` children of such a line
before matching a template, writes the Korean line into the first text node and
empties the remaining ones. The `한` / `영` toggle restores all of those nodes.
The join happens for lines **without** a number too, because value free tooltip
lines are split the same way (`Gem Quality grants Socketed Skills an additional
effect` → `젬 퀄리티가 장착된 스킬에 추가 효과 1개 부여`,
`Sorcery Ward's Barrier can also take Physical and Chaos Damage from Hits`).
The joined text is rebuilt from the **remembered English** text of the spans, because the
keyword spans of a line may already have been translated one by one
(`...that deals 카오스 damage over time...`), and a line may be up to 2,000 characters long
(a skill description such as Contagion is split into ten keyword spans).

The translation is then written **back into the original spans** (`distributeTranslatedLine`),
so the underlined keywords keep their hover tooltips: every span that has its own Korean word
receives that word, and the surrounding text stays in the plain spans:

```
Create a storm … deals [Physical] damage over time. … absorbs that surface's [Debuff], …
  → ["적들을 빨아들이고 지속", "물리", "피해를 주는 폭풍을 생성합니다.", "원소 지대 효과", "와 겹치는 …", "디버프", "를 흡수하여 …"]
```

A keyword whose Korean word cannot be found in the translated line at all gets an empty span —
the tooltip is lost for that one word, no English is left behind, and the line stays intact.
A label the page prints with a colon (`Support Gem Requirements:`, `Category:`) is looked
up without the colon as well, and the colon is appended to the translation.

The Korean word of a keyword is found by `keywordCandidates()`, which tries the forms the page
may print instead of the term of the data — the plural/singular (`Debuff` against `Debuffs`),
`-ing`/`-ed` (`Slowing` against `Slow` → `감속`) and the doubled consonant
(`Channel` against `Channelling` → `집중 유지`). A keyword is anchored at the **earliest**
matching position, and a term printed in an inflected form is matched by its first word
(`집중 유지` is printed as `집중을 유지하여`), so the second `Channel` of a line keeps its own
span:

```
[Channel] to build … the longer you [Channel] for.
  → ["", "집중", "을 유지하여 … 일으키며,", "집중 유지", "를 지속할수록 …"]
```

An empty `<span></span>` in front of a line gets a text node before the text that belongs there
is written.

Two more poe.ninja specific shapes are handled:

* captions such as `9.6m radius · 8s duration`, which the page splits into value spans and the
  fragments `m radius ·` / `s duration` (`crit ·`, `proj /` as well). The unit letter
  (`k`/`m`/`b`/`s`) must stay as it is — translating it would break the number — so only the
  single word of the fragment is replaced with the word of the data (`radius` → `반경`,
  `proj` → `투사체`, `duration` → `지속시간`, `crit` → `치명타`), which gives
  `9.6m 반경 · 8s 지속시간`.
* comma or middle dot separated rows (`Dire Gorget, Absent Amulet`, `Ab Aeterno, Adonia's Ego`,
  `Fire Damage · 38,150`): every part is translated on its own, so a randomly generated rare
  name stays in English (`Dire Gorget, 부재 목걸이`) instead of blocking the known unique item
  next to it.
* the damage multiplier row `<span>more</span><span>×2.5</span>`, which becomes `증폭`.
  The bare word is the navigation label `More` → `더 보기` elsewhere, so this is a context rule
  of the content script (`translateMultiplierLabel()`) and not a data entry.

`build_skill_lines.mjs` converts the game's `{0}` placeholders to `#`. When the Korean line
uses the values in another order (`Recovers {0} Life over {1} Seconds` → `{1}초 동안
{0} 생명력 회복`) it keeps the indexed placeholders, and `addStatRows()` maps the captured
values back through `koreanValueOrder`, so `Recovers 1793 Life over 3 Seconds` becomes
`3초 동안 1793 생명력 회복` and not `1793초 동안 3 생명력 회복`.

Those cases can be checked manually on poe.ninja with the extension loaded
(single text node and split `<span>`s, plus the toggle).


## Skill gem lines

`translations/lines/skill_gem_lines.json` holds line level English → Korean text for skill
gem tooltips. `npm run build:skill-lines` assembles it from the game's own tables:

| Source | Example |
| --- | --- |
| `clientstrings.json` | `Attack Speed` → `공격 속도`, `{0}% of base` → `기본 수치의 {0}%`, `Tier: {0}` → `등급: {0}`. The whole `ItemDisplay…` family is taken, which covers the item property lines too: `Lasts {0} Seconds` → `{0}초 지속`, `Consumes {0} of {1} Charges on use` → `사용 시 충전 {1} 중 {0} 소모`, `Currently has {0} Charges` → `현재 충전량: {0}`, `Recovers {0} Life over {1} Seconds` → `{1}초 동안 {0} 생명력 회복` |
| `alternatequalitytypes.json` | the quality type of the tooltip: `Quality (Fire Modifiers)` → `퀄리티 (화염 속성 부여)` (13 rows) |
| `gemtags.json` | `[AoESkill\|AoE]` → `효과 범위` |
| `grantedeffectlabels.json` | `Initial Strike` → `최초 타격`, `Shockwave` → `충격파` |
| `activeskills.json` | `Boneshatter` → `뼈 박살`, plus the skill description |
| `gemeffects.json` | the `SupportText` of every support gem, e.g. `Supports Attack Skills, causing them to Cull Rare and Unique Enemies on Hit, and increasing the threshold at which they will Cull Enemies.` → `공격 스킬에 적용됩니다. 스킬이 희귀 및 고유 적을 명중하면 마무리 타격을 가하고, 스킬이 적에게 마무리 타격을 하는 한계치가 증가합니다.` (529 rows) |
| `supportgemfamily.json` | the support gem family printed as the Category: `Nova Projectiles` → `폭발 투사체`, `Burning Nova` → `불타는 폭발` (350 rows) |
| `skillgeminfo.json` | gem info description |
| `items/item_class_singulars.json` + `items/item_classes.json` | `One Hand Maces` → `한손 철퇴` |

The support gem labels come from `clientstrings.json` too: `SupportFamilyDisplayString`
(`[SupportGemCategory|Category]` → `유형`) gives `Category`, `SupportGemRequirementsLabel`
gives `Support Requirements:` and the `keywordpopups` term `SupportGemRequirements` gives
`Support Gem Requirements` → `보조 젬 요구사항`.

`Grants Skill: Level 20 Boneshatter` → `스킬 부여: 20레벨 뼈 박살` is generated for every
named skill of `activeskills.json` (737 rows), because the trade API only lists the
skills an item mod can grant. `ItemDisplayGrantedSkill` / `ItemDisplayGrantsSkill` add
the bare `Grants Skill` → `스킬 부여` and `Grants Skill: Level # #` → `스킬 부여: #레벨 #`.

Tooltip lines are often composed, so the content script also translates the parts
(`translateComposedStatText`): `Attack Speed: 60% of base` → `공격 속도: 기본 수치의 60%`,
`AoE, Melee, Strike` → `효과 범위, 근접, 타격`. A number placeholder accepts a
bracketed range as well, so `Level: (1—20)` → `레벨: (1~20)` and
`Attack Damage: (100—312)% of base` → `공격 피해: 기본 수치의 (100~312)%`.

With the extension loaded, the Boneshatter tooltip shows **25 of its 26 lines translated**
(checked manually). The last one (`Requires: Level (1—90), (4—157) Str`) is composed by the
game UI from several parts.

## Stat description lines (.csd)

`translations/lines/stat_lines.json` (25,730 rows) holds the game's own stat
description templates, which is where every line that is not a plain label comes from:

| English | Korean |
| --- | --- |
| `While Dual Wielding, both weapons hit with #% less damage` | `쌍수 장착 시 두 무기 모두 #% 감폭한 피해로 명중` |
| `Shockwave radius is # metres` | `충격파 반경 #미터` |
| `# metres to Melee Strike Range` | `근접 타격 범위 #미터` |
| `Cannot cause Stun buildup` | `기절 축적을 유발하지 않음` |
| `#% more damage with Hits for Shockwaves originating from a Unique enemy` | `고유 적에게서 비롯되는 충격파의 명중 피해 #% 증폭` |

`npm run build:csd` assembles it from the `.csd` files named above
(`Data/StatDescriptions/*.csd`, 589 files), which a GGPK tool has to export first —
see `GGPK_EXTRACTION_REQUEST.md`. They cannot be read from the installed client with a
script: `Content.ggpk` keeps them inside `Bundles2/*.bundle.bin`, which are **Oodle**
compressed (measured: `Tiny.V3.2.bundle.bin` header = 6,468,847 B uncompressed →
1,104,939 B compressed, `compressor = Mermaid(9)`, 256 KB chunks), and no
`oo2core*.dll` ships with the game.

The files are UTF-16 and hold **every language in one file**, so one client is enough:
a `description` block lists its stat ids, then one group of format lines per language
(`lang "Korean"` …), which means the English and Korean groups of a block are paired by
index. `[Term|Display]` becomes the display text the game shows and
`{0}` / `@{0}` / `{:+d}` become the `#` placeholder, so the same `addStatRows()` path as
the trade API data consumes the file.

`npm run inspect:csd` prints the state of the extracted folder (file count, encoding,
`lang` markers, block grammar, the lines we are looking for) before building.


## Proper names (world areas, map pins, quests)

`translations/names/area_and_quest_names.json` (643 rows) holds the names poe.ninja prints outside of
tooltips, which are not part of any stat text: the world area a character is in, the
map pins and the quest names, e.g.

| English | Korean |
| --- | --- |
| `Valley of the Titans` | `거신의 계곡` |
| `The Venom Crypts` | `독액 지하실` |
| `Halls of the Dead` | `죽음의 전당` |
| `Ngamahu's Test` | `나마후의 시험` |

`npm run build:game-names` pairs `worldareas.Name` (367), `mappins.Name` (171) and
`quest.Name` (105) by row id. Names shorter than 6 characters (40 rows: `Pit`, `Keth`,
`Abyss`, …) are skipped, because a bare short word is also used as a keyword elsewhere
on the page; `Qimah` is allow listed because poe.ninja prints it.

poe.ninja writes the current place as `<area> - <quest>`
(`Halls of the Dead - Ngamahu's Test`), so `translateComposedStatText` also joins the
two sides of a `" - "` line and translates each of them (`죽음의 전당 - 나마후의 시험`),
next to the existing `": "` (label and value) and `", "` (list) forms.

To check the saved poe.ninja audit pages, load the extension and open them manually; look
for English text nodes that are still untranslated. A split line may stay partly English
as fragments, so compare whole lines rather than individual fragments.

## Item description lines

`translations/lines/flavour_text.json` (2,986 rows) holds the description text of items and
uniques, paired from the game's own `flavourtext.json` and its Korean dump by row id
(3,591 rows, 3,537 of them translated):

```
"Only a madman would ignore a god's instructions." → "미치지 않고서야 어찌 신의 말씀을 무시할 수 있단 말인가."
"The tides of blood…"                             → …
```

`npm run build:flavour-text` writes the file. The source line breaks become single spaces,
because the content script normalises whitespace before it looks a line up.

## Keyword definitions

`translations/lines/keyword_definitions.json` (1,370 rows) holds the body of the keyword
tooltips, which is the `Definition` column of `keywordpopups.json`
(`npm run build:keyword-definitions`). A definition can hold several paragraphs and the
tooltip prints them as separate lines, so the English and Korean paragraphs are paired one
by one (they must have the same count) and the whole text is stored as well for a single
node rendering:

```
"Debuffs are negative effects that deal damage or penalise an entity's stats, either for a set duration or when a condition is met."
  → "디버프는 일정 시간 동안 또는 특정 조건이 충족될 때까지 피해를 주거나 대상의 능력치에 페널티를 부여하는 부정적 효과입니다."
```

Labels that only poe.ninja has (`Quality from Gem` → `젬 퀄리티`) are added to
`general/poe_ninja.json`, which is the interface translation table.

## Korean filter search

The extension patches `String.prototype.indexOf`/`includes` in the page world
(`page_search.js`) so poe.ninja's "Search filters..." box also matches Korean
text. The userscript publishes the search aliases, the unique item names and the
unique item ids of every item class to that script through a `postMessage`
payload (`entries`, `uniqueNames`, `itemClassUniqueItems`).

- Typing Korean resolves the query to the matching English ids from the
  translation data and compares those ids with the filter labels.
- When a resolved id is an item class such as `Shield` (typing `방패`), the
  unique items whose `baseItem` belongs to that class are added to the resolved
  ids and printed with the query report: `items/base_items.json` maps each base
  item to its class and `items/unique_items.json` maps each unique item to its base
  item. `방패` therefore lists the unique shields even though their English names
  never contain the word "Shield".
- A resolved base item or unique item does **not** pull in its item class, so
  typing a single item (`알켐 에이라`) only matches that item.
- Typing `고유` (or a part of it such as `고`, `유`) matches every unique item
  listed in `items/unique_items.json`; the normal Korean aliases are still searched at
  the same time. `고유` is the only keyword.
- Every Korean query is printed to the page console as
  `[poe 닌자 한글 검색] "<query>" → 영어 id N개 / 아이템 분류 N개 / 베이스 아이템 N개`
  together with the resolved English ids, item classes and base item ids. Run
  `localStorage.setItem("poe-ninja-korean-search-log", "0")` on poe.ninja to
  silence that output.

These rules are checked manually with the extension loaded.

## Duplicate diagnostics

Local-only tool (no browser needed): it mirrors the extension load order, groups the keys that
exist in more than one file/table, shows which value the extension resolves today and compares
it with the official Korean from the balance dumps.

```
npm run analyze:duplicates      # 또는 node scripts/analyze_duplicates.mjs
```

It writes `data/poe_ninja_audit/duplicates-report.txt` (readable summary) and
`duplicates-report.json` (every group, with the effective entry). `keyword.json` and
`custom.json` win over the other files, so they are reported as the effective value.

## Structural cleanup

`scripts/clean_translations.mjs` removes what the lookup does not need, which shrinks the
data set without changing any translation (the content script resolves a key to the
first loaded value, and that is exactly the row this tool keeps):

```
npm run clean:translations            # dry run — report only
npm run clean:translations -- --apply # rewrite translations/ (+ backup)
```

1. drops the `(id)` part of a value (`불의 화신(Avatar of Fire)` → `불의 화신`),
2. drops rows whose `ko` equals the `id` (nothing to translate),
3. drops the `table` field of **single-table** files (the file name is the table already;
   `game_terms.json` and `character_classes.json` merge several tables and keep it),
4. keeps one row per key **only when the rows carry the same value**: `custom.json` →
   `keyword.json` → load order → file order. A key whose rows have different values keeps
   every row (nothing is lost), and `general/` rows are never dropped.

The tables of the merged files (what `table` values each file holds):

| File | Tables |
| --- | --- |
| `names/game_terms.json` | `passiveskills`, `buffdefinitions`, `monstervarieties`, `activeskills`, `npcs`, `grantedeffectlabels` |
| `names/character_classes.json` | `ascendancy`, `characters` |
| every other array file | one table, named after the file → no `table` field |

A table that has its own file is **never merged** into `game_terms.json`. `build_translation_map.py`
lists it in `COMPACT_TABLES_KEPT_SEPARATE` (`mods`, `keywordpopups`, `baseitemtypes`,
`itemclasscategories`, `uniqueitems`, `words`) and `TRANSLATION_PATHS` maps its name to the target
file, so a rebuild writes `names/mods.json` and `names/keywordpopups.json` directly. The usual
pipeline after a rebuild is:

```
python build_translation_map.py             # generate from the balance dumps
npm run clean:translations -- --apply       # parens / id == ko / single-table table / same-value merge
```

`items/unique_items.json`, `items/base_items.json`, `names/character_classes.json` and
`items/item_class_singulars.json` are **registry files** — the content script builds the
unique item list (the 고유 search) and the base item → item class map from them, so they only
lose rows that are byte-identical duplicates inside the same file. The report lists the keys
where the dropped rows carried another value (they were already shadowed), and a backup of
every file lands in `data/translations_backup_clean/`.

Run `npm run analyze:duplicates` first when you want the official Korean comparison before
the cleanup.

## Unique item lines

poe.ninja shows a unique item as **two nodes**: `<h1><div>Runeseeker's Call</div>Runemastered Runic Fork</h1>`.
The content script translates each text node on its own, so the unique name comes from
`items/unique_items.json` and the base name from `items/base_items.json` — which already carries
every rune modified base (`Runemastered Runic Fork` → `룬숙련 룬 쇠스랑`), 740 rows.

Unique **jewels** are the only case where the page keeps both parts in **one string**
(`<div …>Heart of the Well Diamond</div>` in the jewel list, plus the same text as the icon
`alt`). The trade API marks them directly (`group` is `jewel`), so `npm run build:unique-items`
pairs the English and Korean entries there, joins the two Korean names and writes the result
into `general/poe_ninja.json` (**15 rows**), without reading any local table. No separate line
file is needed. Verified rendering:

```
Runeseeker's Call  + Runemastered Runic Fork  → 룬 탐구자의 소명 + 룬숙련 룬 쇠스랑
Guiding Palm       + Shrine Sceptre (Legacy)  → 인도하는 손바닥 + 성소 셉터 (유산)
Andvarius          + Ring                     → 앤드바리우스 + 반지
<div>Heart of the Well Diamond</div>          → 우물의 심장 다이아몬드
```

## Browser demo

`korean-search.html` (with `search-demo.js` and `search-payload.js`) is a
standalone page for the search logic: it loads `chrome-extension/page_search.js`,
feeds it the payload rebuilt from `translations/` and lists the English ids that
a Korean query resolves to (total count plus the alias, item class and base item
breakdown). Nothing from poe.ninja is required.

Serve the project over HTTP because the page fetches the translation JSON files:

```
python -m http.server 8000
```

Then open `http://localhost:8000/korean-search.html` and type a query such as
`고`, `고유`, `방패` or `알켐 에이라`.
`search-payload.js` rebuilds the same payload that the extension publishes.

`data-search.html` (with `data-search.js`, `data-search-files.js` and the generated
`data-search-data.js`) is the data browser: it loads every file of `translations/` and searches
their **keys**. The `검색` button and the 완전/부분 switch sit right of the box (switch left =
complete key, right = partial match), Enter runs the search as well, and `중복 검색` right of
`검색` lists the groups of keys that exist in several files/tables — value conflicts first,
5 items per group (`더보기` reveals the rest) and 5 groups per batch (`그룹 더보기`, value
first). Each hit shows the full file address, then the source structure — the array element for
an array file, the `id → value` entry for an object file — with the matched part and the value
in bold. Open `http://localhost:8000/data-search.html` and try `Gem Level` (완전) or `gem l`
(부분 with the switch), `Boneshatter`, `Quality from Gem`.

`npm run build:data-search` writes `data-search-data.js`, the whole data set as one internal
script, so the page also works when it is opened by a double click (`file://`) — no local
server needed. The status line then says `내장 데이터 … (생성 시각)`; rerun the command after
editing `translations/`. Check both `http://localhost:8000/data-search.html` and the `file://`
version manually after rebuilding.

In the devtools console, both on poe.ninja and on the demo page,
`__poeNinjaKoreanSearch.resolveKoreanQuery("방패")` returns the raw resolution
that the filter search uses.

## Unique items and their base items

`translations/items/unique_items.json` (463 rows) maps a unique to its base item.
`npm run build:unique-items` builds it (and `items/base_item_variants.json`) from the official
trade API item list, which classifies every entry itself:

| Entry | Meaning |
| --- | --- |
| `{"type":"Gargantuan Mana Flask"}` | a base item |
| `{"type":"Transcendent Mana Flask", "name":"Uhtred's Chalice", "text":"Uhtred's Chalice Transcendent Mana Flask", "flags":{"unique":true}}` | a unique: `name` is the unique, `type` its base item, `text` the display line |

Both languages come from the API (English `pathofexile.com`, Korean `kr.pathofexile.com` — Daum
mirror as fallback). The two lists have no id in common, so the unique entries are paired by
their order inside each category, and any category whose counts differ is skipped. Both
responses are cached in `data/trade_api/` (`items_en.json`, `items_ko.json`), so a rebuild works
offline. One unique name can be listed with several base items (the plain one plus the rune
modified `Runemastered …` variants), so `items/unique_items.json` keeps the plain (shortest) base
per unique, while `items/base_item_variants.json` holds the base names that only appear inside a
unique line (`Shrine Sceptre (Legacy)`, the generic `Ring`). Placeholders of unreleased uniques
(`INCOMPLETE Crone Knife`) are dropped.
