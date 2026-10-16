// data-search.html 과 scripts/build_data_search_bundle.mjs 가 함께 쓰는 파일 목록.
// content script 의 로드 순서를 따르고, 마지막 두 개(keyword.json / custom.json)가
// 직접 고치는 override 파일이다. (브라우저에서는 <script>, Node 에서는 import 로 읽는다.)
globalThis.DATA_SEARCH_FILES = [
  "general/poe_ninja.json",
  "names/game_terms.json",
  "names/mods.json",
  "names/keywordpopups.json",
  "names/name_dictionary.json",
  "items/base_items.json",
  "items/base_item_variants.json",
  "items/item_classes.json",
  "items/unique_items.json",
  "names/character_classes.json",
  "items/item_class_singulars.json",
  "lines/item_mod_lines.json",
  "lines/skill_gem_lines.json",
  "lines/stat_lines.json",
  "lines/flavour_text.json",
  "lines/keyword_definitions.json",
  "names/area_and_quest_names.json",
  "general/keyword.json",
  "general/custom.json",
];
