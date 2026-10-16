import argparse
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


# 기준 폴더(= data/, translations/ 가 있는 폴더).
# build-all.cmd / build_all.mjs 가 POBKR_ROOT 로 넘겨주고, 없으면 이 파일 옆 폴더를 쓴다.
# 코드(pipeline/)와 데이터(poe2_translation_kr)를 나눠 두어도 결과는 데이터 폴더에 쓰인다.
PROJECT_ROOT = Path(
    os.environ.get("POBKR_ROOT") or Path(__file__).resolve().parent
).resolve()


TRANSLATION_PATHS = {
    name: PROJECT_ROOT / "translations" / target
    for name, target in {
        "baseitemtypes.json": "items/base_items.json",
        "itemclasscategories.json": "items/item_classes.json",
        "itemclass_singulars.json": "items/item_class_singulars.json",
        "translation_merge.json": "names/game_terms.json",
        "mods.json": "names/mods.json",
        "keywordpopups.json": "names/keywordpopups.json",
        "uniqueitems.json": "items/unique_items.json",
        "words.json": "names/name_dictionary.json",
    }.items()
}

COMPACT_TABLE_ID_FIELDS = {
    "activeskills": {"DisplayedName"},
    "baseitemtypes": {"Name"},
    "buffdefinitions": {"Name"},
    "grantedeffectlabels": {"Text"},
    "keywordpopups": {"Term"},
    "mods": {"Name"},
    "monstervarieties": {"Name"},
    "npcs": {"Name"},
    "passiveskills": {"Name"},
    "supportgemfamily": {"Name"},
    "words": {"Text2"},
}
MOD_DISPLAY_NAME_PATTERN = re.compile(r">\{([^{}]+)\}")
# Game data marks unreleased or unused rows with these markers ("[DNT-UNUSED] Cleave").
UNUSED_MARKER = re.compile(r"\[(DNT-)?UNUSED\]", re.IGNORECASE)
COMPACT_TABLES_KEPT_SEPARATE = {
    "baseitemtypes",
    "itemclasscategories",
    "keywordpopups",
    "mods",
    "uniqueitems",
    "words",
}


def load_rows(path: Path) -> list[dict[str, Any]]:
    with path.open(encoding="utf-8-sig") as file:
        data = json.load(file)
    if not isinstance(data, list) or any(not isinstance(row, dict) for row in data):
        raise ValueError(f"Expected a JSON array of objects in {path}")
    return data


def row_identity(
    table_name: str, row: dict[str, Any]
) -> tuple[str, dict[str, Any] | None] | None:
    row_id = row.get("Id")
    if isinstance(row_id, str) and row_id:
        return row_id, None

    if table_name == "words":
        wordlist = row.get("Wordlist")
        wordlist_id = wordlist.get("Id") if isinstance(wordlist, dict) else None
        hash32 = row.get("HASH32")
        if isinstance(wordlist_id, str) and isinstance(hash32, int):
            match_key = {"Wordlist.Id": wordlist_id, "HASH32": hash32}
            return f"Wordlist/{wordlist_id}/HASH32/{hash32}", match_key
    return None


def index_by_id(
    rows: list[dict[str, Any]], table_name: str
) -> tuple[dict[str, dict[str, Any]], set[str]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        identity = row_identity(table_name, row)
        if identity is not None:
            grouped[identity[0]].append(row)
    duplicates = {row_id for row_id, matches in grouped.items() if len(matches) > 1}
    return (
        {row_id: matches[0] for row_id, matches in grouped.items() if len(matches) == 1},
        duplicates,
    )


def item_class_names(rows: list[dict[str, Any]]) -> dict[str, str]:
    return {
        row["Id"]: row["Name"]
        for row in rows
        if isinstance(row.get("Id"), str)
        and isinstance(row.get("Name"), str)
        and row["Id"]
    }


def item_class_id(row: dict[str, Any], item_classes: list[dict[str, Any]]) -> str | None:
    reference = row.get("ItemClass")
    if not isinstance(reference, dict) or reference.get("TableName") != "ItemClasses":
        return None
    row_index = reference.get("RowIndex")
    if not isinstance(row_index, int) or isinstance(row_index, bool):
        return None
    if row_index < 0 or row_index >= len(item_classes):
        return None
    class_id = item_classes[row_index].get("Id")
    return class_id if isinstance(class_id, str) else None


def item_class_category_name(
    row: dict[str, Any], categories: list[dict[str, Any]]
) -> str | None:
    reference = row.get("ItemClassCategory")
    if (
        not isinstance(reference, dict)
        or reference.get("TableName") != "ItemClassCategories"
    ):
        return None
    row_index = reference.get("RowIndex")
    if (
        not isinstance(row_index, int)
        or isinstance(row_index, bool)
        or row_index < 0
        or row_index >= len(categories)
    ):
        return None
    text = categories[row_index].get("Text")
    if not isinstance(text, str) or not text.strip():
        return None
    # `[Term|Display]` / `[Term]` markup is left as it is; the final data clean up
    # (scripts/clean_translations.mjs) keeps the last `|` segment.
    return text.strip()


IRREGULAR_PLURALS = {
    "focus": "foci",
    "quarterstaff": "quarterstaves",
    "staff": "staves",
}
IRREGULAR_SINGULARS = {
    plural: singular for singular, plural in IRREGULAR_PLURALS.items()
}


def pluralize_item_class_word(word: str) -> str:
    lower_word = word.casefold()
    if lower_word in IRREGULAR_PLURALS:
        return IRREGULAR_PLURALS[lower_word]
    if re.search(r"[^aeiou]y$", lower_word):
        return word[:-1] + "ies"
    if re.search(r"(?:s|x|z|ch|sh)$", lower_word):
        return word + "es"
    return word + "s"


def singularize_item_class_name(name: str) -> str:
    words = name.split()
    if not words:
        return name
    word = words[-1]
    lower_word = word.casefold()
    if lower_word in IRREGULAR_SINGULARS:
        singular = IRREGULAR_SINGULARS[lower_word]
        words[-1] = singular.capitalize() if word[:1].isupper() else singular
    elif re.search(r"[^aeiou]ies$", lower_word):
        words[-1] = word[:-3] + "y"
    elif re.search(r"(?:sses|shes|ches|xes|zes)$", lower_word):
        words[-1] = word[:-2]
    elif lower_word.endswith("s") and not lower_word.endswith("ss"):
        words[-1] = word[:-1]
    return " ".join(words)


def item_class_singular_name(name: str, category_name: str | None) -> str:
    if category_name:
        folded_name = name.casefold()
        folded_category = category_name.casefold()
        if folded_name.endswith(folded_category):
            return name[: len(name) - len(category_name)] + category_name
        pluralized_category = pluralize_item_class_word(category_name.split()[-1])
        category_words = category_name.split()
        if len(category_words) > 1:
            pluralized_category = " ".join(
                [*category_words[:-1], pluralized_category]
            )
        folded_plural = pluralized_category.casefold()
        if folded_name.endswith(folded_plural):
            return name[: len(name) - len(pluralized_category)] + category_name
    return singularize_item_class_name(name)


def input_path(file_name: str) -> Path:
    """손으로 관리하는 입력 파일은 기준 폴더에서, 없으면 이 파일 옆에서 찾는다."""
    candidates = (
        PROJECT_ROOT / file_name,
        Path(__file__).resolve().parent / file_name,
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


ITEM_CLASS_SINGULARS_SOURCE = input_path("itemclass_singulars_source.json")


def load_item_class_singulars_source(path: Path) -> dict[str, str]:
    """User added plural name -> singular name entries (underscores count as spaces).

    The file is optional: without it the singulars are generated from the game data
    alone.
    """
    if not path.exists():
        print(f"Item class singulars source not found, using generated values only: {path}")
        return {}
    with path.open(encoding="utf-8-sig") as file:
        data = json.load(file)
    if not isinstance(data, dict):
        raise ValueError(f"Expected a JSON object of plural -> singular in {path}")
    source: dict[str, str] = {}
    for plural_name, singular_name in data.items():
        if not isinstance(plural_name, str) or not isinstance(singular_name, str):
            raise ValueError(f"Expected string keys and values in {path}")
        key = plural_name.replace("_", " ").strip()
        value = singular_name.replace("_", " ").strip()
        if key and value:
            source[key] = value
    return source


def build_item_class_singulars(
    balance_dir: Path, source: dict[str, str]
) -> tuple[dict[str, str], dict[str, Any]]:
    """ItemClasses Id -> singular display name, split into custom and generated.

    Every item class gets its singular from the plural/category rule. The curated
    list (itemclass_singulars_source.json) holds the entries a person added on top
    of the game data; they are matched by ItemClasses.Name first and by
    ItemClasses.Id second and win over the rule. The report keeps the two groups
    apart for itemclass_singulars.json and for the console summary:
      * custom           : the curated entries exactly as written
      * generated        : only the plural -> singular pairs that actually change
                         (keyed by class id and by the plural ItemClasses.Name)
      * used_custom      : curated keys that did match an item class
      * unused_custom    : curated keys that match no item class
      * overrides        : curated values that differ from the rule
      * skipped_classes  : classes without a name in the game data and without a
                           curated entry, so no singular can be produced
    """
    english_classes = load_rows(balance_dir / "itemclasses.json")
    categories = load_rows(balance_dir / "itemclasscategories.json")

    generated: dict[str, str] = {}
    generated_names: dict[str, str] = {}
    custom_classes: dict[str, str] = {}
    used_custom_keys: set[str] = set()
    overrides: list[str] = []
    skipped_classes: list[str] = []
    for item_class in english_classes:
        class_id = item_class.get("Id")
        if not isinstance(class_id, str) or not class_id:
            continue
        raw_name = item_class.get("Name")
        plural_name = raw_name.strip() if isinstance(raw_name, str) else ""
        rule_singular = (
            item_class_singular_name(
                plural_name, item_class_category_name(item_class, categories)
            )
            if plural_name
            else None
        )

        custom_singular = None
        for source_key in (plural_name, class_id):
            if not source_key or source_key not in source:
                continue
            used_custom_keys.add(source_key)
            if custom_singular is None:
                custom_singular = source[source_key]
        if custom_singular is not None:
            custom_classes[class_id] = custom_singular
            if rule_singular is not None and custom_singular != rule_singular:
                overrides.append(
                    f"{class_id} ({plural_name}): {custom_singular!r} overrides rule {rule_singular!r}"
                )
            continue
        if rule_singular is None:
            skipped_classes.append(f"{class_id} (no name in itemclasses.json)")
            continue
        generated[class_id] = rule_singular
        if plural_name and plural_name != class_id:
            generated_names[plural_name] = rule_singular

    merged_generated: dict[str, str] = dict(generated)
    name_conflicts: list[str] = []
    for plural_name, singular in generated_names.items():
        existing = merged_generated.get(plural_name)
        if existing is None:
            merged_generated[plural_name] = singular
        elif existing != singular:
            name_conflicts.append(
                f"{plural_name}: {existing!r} (class id key) vs {singular!r} (name key)"
            )
    # identical plural/singular pairs carry no information
    merged_generated = {
        key: value for key, value in merged_generated.items() if key != value
    }

    singular_by_class_id = {**generated, **custom_classes}
    report: dict[str, Any] = {
        "custom": source,
        "generated": {key: merged_generated[key] for key in sorted(merged_generated)},
        "class_counts": {"custom": len(custom_classes), "generated": len(generated)},
        "overrides": overrides,
        "name_conflicts": name_conflicts,
        "skipped_classes": skipped_classes,
    }
    return singular_by_class_id, report


def translated_fields(
    english: dict[str, Any], korean: dict[str, Any]
) -> dict[str, dict[str, str]]:
    translations: dict[str, dict[str, str]] = {}
    for key, english_value in english.items():
        korean_value = korean.get(key)
        if (
            key != "Id"
            and isinstance(english_value, str)
            and isinstance(korean_value, str)
            and english_value.strip()
            and korean_value.strip()
            and english_value != korean_value
        ):
            translations[key] = {"en": english_value, "ko": korean_value}
    return translations


def shared_context(english: dict[str, Any], korean: dict[str, Any]) -> dict[str, Any]:
    context: dict[str, Any] = {}
    for key, value in english.items():
        if (
            key == "Id"
            or key.startswith("_")
            or key.startswith("HASH")
            or value is None
            or value == ""
        ):
            continue
        if isinstance(value, (str, int, float, bool)) and value == korean.get(key):
            context[key] = value
    return context


def build_map(balance_dir: Path, tables: set[str] | None) -> tuple[dict[str, Any], Counter[str]]:
    korean_dir = balance_dir / "korean"
    english_item_classes = load_rows(balance_dir / "itemclasses.json")
    korean_item_classes = load_rows(korean_dir / "itemclasses.json")
    english_class_names = item_class_names(english_item_classes)
    korean_class_names = item_class_names(korean_item_classes)

    table_files = sorted(balance_dir.glob("*.json"))
    if tables is not None:
        requested = {f"{table.lower()}.json" for table in tables}
        table_files = [path for path in table_files if path.name.lower() in requested]
        missing = requested - {path.name.lower() for path in table_files}
        if missing:
            raise FileNotFoundError(
                "Table JSON not found in the English balance folder: "
                + ", ".join(sorted(missing))
            )

    entries: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    for english_path in table_files:
        korean_path = korean_dir / english_path.name
        if not korean_path.is_file():
            counts["missing_korean_table"] += 1
            continue

        english_rows = load_rows(english_path)
        korean_rows = load_rows(korean_path)
        table_name = english_path.stem
        english_by_id, english_duplicates = index_by_id(english_rows, table_name)
        korean_by_id, korean_duplicates = index_by_id(korean_rows, table_name)
        ambiguous_ids = english_duplicates | korean_duplicates
        counts["ambiguous_ids"] += len(ambiguous_ids)

        for english in english_rows:
            identity = row_identity(table_name, english)
            if identity is None:
                continue
            row_id = identity[0]
            if row_id in ambiguous_ids or row_id not in korean_by_id:
                continue
            if UNUSED_MARKER.search(row_id):
                counts["unused_marker"] += 1
                continue
            korean = korean_by_id[row_id]
            translations = translated_fields(english, korean)
            if not translations:
                continue
            if any(
                UNUSED_MARKER.search(text)
                for pair in translations.values()
                for text in pair.values()
            ):
                counts["unused_marker"] += 1
                continue

            context = shared_context(english, korean)
            class_id = item_class_id(english, english_item_classes)
            if class_id is not None:
                class_info: dict[str, str] = {"id": class_id}
                if class_id in english_class_names:
                    class_info["en"] = english_class_names[class_id]
                if class_id in korean_class_names:
                    class_info["ko"] = korean_class_names[class_id]
                context["itemClass"] = class_info

            entry: dict[str, Any] = {
                "table": table_name,
                "id": row_id,
                "translations": translations,
                "context": context,
            }
            if table_name == "activeskills":
                english_name = english.get("DisplayedName")
                korean_name = korean.get("DisplayedName")
                if isinstance(english_name, str) and isinstance(korean_name, str):
                    entry["displayName"] = {
                        "en": english_name,
                        "ko": korean_name,
                    }
            identity = row_identity(table_name, english)
            if identity is not None and identity[1] is not None:
                entry["matchKey"] = identity[1]
            entries.append(entry)
            counts["entries"] += 1
            counts[f"table:{table_name}"] += 1

    return (
        {
            "formatVersion": 1,
            "languages": {"en": "English", "ko": "Korean"},
            "entries": entries,
        },
        counts,
    )


def add_compact(
    compact: list[dict[str, Any]],
    table_name: str,
    english: str,
    korean: str,
    item_class: str | None = None,
) -> None:
    if not english.strip() or not korean.strip() or english == korean:
        return
    entry: dict[str, Any] = {
        "id": english,
        "ko": korean,
        "table": table_name,
    }
    if item_class is not None:
        entry["itemClass"] = item_class
    compact.append(entry)


def add_long(
    long_translations: list[dict[str, Any]],
    table_name: str,
    row_id: str,
    field: str,
    english: str,
    korean: str,
    source_id: str | None = None,
) -> None:
    entry: dict[str, Any] = {
        "id": row_id,
        "field": field,
        "en": english,
        "ko": korean,
        "table": table_name,
    }
    if source_id is not None:
        entry["sourceId"] = source_id
    long_translations.append(entry)


def split_translation_map(
    translation_map: dict[str, Any],
    item_class_singulars: dict[str, str],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    compact: list[dict[str, Any]] = []
    long_translations: list[dict[str, Any]] = []

    for entry in translation_map["entries"]:
        table_name = entry["table"]
        id_fields = COMPACT_TABLE_ID_FIELDS.get(table_name)
        if id_fields is None and table_name != "itemclasscategories" and table_name != "flavourtext":
            continue
        if table_name == "words" and entry.get("matchKey", {}).get(
            "Wordlist.Id"
        ) != "UNIQUE_ITEM":
            continue

        item_class_id = entry.get("context", {}).get("itemClass", {}).get("id")
        item_class = item_class_id
        if table_name == "baseitemtypes" and item_class_id is not None:
            item_class = item_class_singulars.get(item_class_id)
        display_name = entry.get("displayName")
        if table_name == "activeskills" and isinstance(display_name, dict):
            compact_id = display_name.get("en", entry["id"])
        elif table_name == "buffdefinitions":
            compact_id = entry["translations"].get("Name", {}).get("en", entry["id"])
        elif table_name == "passiveskills":
            compact_id = entry["translations"].get("Name", {}).get("en", entry["id"])
        elif table_name == "mods":
            english_name = entry["translations"].get("Name", {}).get("en", entry["id"])
            korean_name = entry["translations"].get("Name", {}).get("ko", "")
            english_label = MOD_DISPLAY_NAME_PATTERN.search(english_name)
            korean_label = MOD_DISPLAY_NAME_PATTERN.search(korean_name)
            if english_label is not None and korean_label is not None:
                add_compact(
                    compact,
                    table_name,
                    english_label.group(1),
                    korean_label.group(1),
                )
                add_long(
                    long_translations,
                    table_name,
                    english_label.group(1),
                    "Name",
                    english_name,
                    korean_name,
                    entry["id"],
                )
                continue
            compact_id = english_name
        else:
            compact_id = entry["id"]

        if table_name == "itemclasscategories":
            english_text = entry["translations"].get("Text", {}).get("en")
            korean_text = entry["translations"].get("Text", {}).get("ko")
            if english_text is None or korean_text is None:
                continue
            add_compact(compact, table_name, english_text, korean_text)
            continue

        for field, values in entry["translations"].items():
            english = values["en"]
            korean = values["ko"]
            if table_name == "activeskills" and field in {
                "Description",
                "ShortDescription",
            }:
                continue
            if table_name == "flavourtext" or id_fields is None or field not in id_fields:
                long_id = compact_id
                add_long(
                    long_translations,
                    table_name,
                    long_id,
                    field,
                    english,
                    korean,
                    entry["id"] if long_id != entry["id"] else None,
                )
                continue

            add_compact(
                compact,
                table_name,
                english,
                korean,
                item_class if table_name == "baseitemtypes" else None,
            )

    canonical_category_pairs = {
        (entry["id"].casefold(), entry["ko"].casefold())
        for entry in compact
        if entry["table"] == "itemclasscategories"
    }

    deduplicated: list[dict[str, Any]] = []
    seen_translation_pairs: set[tuple[str, str, str]] = set()
    for entry in compact:
        pair = (entry["id"].casefold(), entry["ko"].casefold())
        if (
            entry["table"] != "itemclasscategories"
            and pair in canonical_category_pairs
        ):
            continue
        scoped_pair = (entry["table"], pair[0], pair[1])
        if scoped_pair in seen_translation_pairs:
            continue
        seen_translation_pairs.add(scoped_pair)
        deduplicated.append(entry)

    return deduplicated, long_translations


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)
        file.write("\n")


def omit_redundant_table(
    entries: list[dict[str, Any]], file_stem: str
) -> list[dict[str, Any]]:
    return [
        {key: value for key, value in entry.items() if key != "table"}
        if entry.get("table") == file_stem
        else entry
        for entry in entries
    ]


def separate_table_payload(
    table_name: str, entries: list[dict[str, Any]]
) -> Any:
    """Payload for one of the separate table files.

    itemclasscategories is a 1:1 id -> Korean map, so it is written as a plain
    object instead of an array of rows.
    """
    rows = omit_redundant_table(entries, table_name)
    if table_name == "itemclasscategories":
        return {
            row["id"]: row["ko"] for row in sorted(rows, key=lambda row: row["id"])
        }
    return rows


def write_table_files(entries: list[dict[str, Any]], directory: Path) -> int:
    entries_by_table: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        entries_by_table[entry["table"]].append(entry)

    directory.mkdir(parents=True, exist_ok=True)
    expected_files = {f"{table_name}.json" for table_name in entries_by_table}
    for existing_file in directory.glob("*.json"):
        if existing_file.name not in expected_files:
            existing_file.unlink()

    for table_name, table_entries in sorted(entries_by_table.items()):
        write_json(
            directory / f"{table_name}.json",
            omit_redundant_table(table_entries, table_name),
        )
    return len(entries_by_table)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Match English and Korean PoE balance JSON records by their shared Id."
    )
    parser.add_argument(
        "--balance-dir",
        type=Path,
        default=PROJECT_ROOT / "data" / "balance",
        help="Folder containing English JSON files and the korean subfolder.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=PROJECT_ROOT / "translations" / "general" / "translation.json",
        help="Destination JSON file.",
    )
    parser.add_argument(
        "--tables",
        help="Optional comma-separated table names, e.g. monstervarieties,baseitemtypes.",
    )
    parser.add_argument(
        "--itemclass-singulars-source",
        type=Path,
        default=ITEM_CLASS_SINGULARS_SOURCE,
        help="Curated plural name -> singular name item class list.",
    )
    args = parser.parse_args()
    selected_tables = (
        {name.strip() for name in args.tables.split(",") if name.strip()}
        if args.tables
        else None
    )
    result, counts = build_map(args.balance_dir, selected_tables)
    item_class_singulars_source = load_item_class_singulars_source(
        args.itemclass_singulars_source
    )
    item_class_singulars, singular_report = build_item_class_singulars(
        args.balance_dir, item_class_singulars_source
    )
    compact, _long_translations = split_translation_map(
        result, item_class_singulars
    )
    write_json(
        TRANSLATION_PATHS["itemclass_singulars.json"],
        {
            "custom": singular_report["custom"],
            "generated": singular_report["generated"],
        },
    )
    class_counts = singular_report["class_counts"]
    print(
        f"Item class singulars: {class_counts['custom'] + class_counts['generated']} classes "
        f"({class_counts['custom']} from custom entries, "
        f"{class_counts['generated']} from the plural/category rule) / "
        f"generated pairs: {len(singular_report['generated'])} (singular != plural)"
    )
    for line in singular_report["overrides"]:
        print(f"  override: {line}")
    for line in singular_report["name_conflicts"]:
        print(f"  plural name conflict: {line}")
    skipped = singular_report["skipped_classes"]
    if skipped:
        notable = [name for name in skipped if not name.startswith("DONOTUSE")]
        print(
            f"  skipped (no name in itemclasses.json, no custom entry): "
            f"{len(skipped)} classes, e.g. {', '.join(notable[:8])}"
            + (" …" if len(notable) > 8 else "")
        )

    compact_output = TRANSLATION_PATHS["translation_merge.json"]
    compact_combined = [
        entry
        for entry in compact
        if entry["table"] not in COMPACT_TABLES_KEPT_SEPARATE
    ]
    compact_separate = [
        entry
        for entry in compact
        if entry["table"] in COMPACT_TABLES_KEPT_SEPARATE
    ]
    write_json(compact_output, compact_combined)
    compact_entries_by_table: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in compact_separate:
        compact_entries_by_table[entry["table"]].append(entry)
    for table_name, table_entries in sorted(compact_entries_by_table.items()):
        write_json(
            TRANSLATION_PATHS.get(f"{table_name}.json", compact_output.parent / f"{table_name}.json"),
            separate_table_payload(table_name, table_entries),
        )
    print(f"Wrote {len(compact_combined)} combined translations to {compact_output}")
    print(f"Wrote {len(compact_combined)} combined translations to {compact_output}")
    print(
        f"Wrote {len(compact_entries_by_table)} separate table files "
        f"to {compact_output.parent}"
    )
    print(f"Skipped ambiguous IDs: {counts['ambiguous_ids']}")
    print(f"Skipped [UNUSED]/[DNT-UNUSED] rows: {counts['unused_marker']}")
    print(f"English tables without Korean counterparts: {counts['missing_korean_table']}")


if __name__ == "__main__":
    main()
