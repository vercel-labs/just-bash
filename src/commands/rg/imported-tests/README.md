# Imported ripgrep Tests

These tests are transliterated from [ripgrep](https://github.com/BurntSushi/ripgrep), the original Rust-based search tool.

## Source

Tests were imported from the ripgrep test suite:
- https://github.com/BurntSushi/ripgrep/tree/master/tests

## Files

| File | Source | Description |
|------|--------|-------------|
| `binary.test.ts` | `tests/binary.rs` | Binary file detection and handling |
| `feature.test.ts` | `tests/feature.rs` | Feature tests from GitHub issues |
| `misc.test.ts` | `tests/misc.rs` | Miscellaneous behavior tests |
| `regression.test.ts` | `tests/regression.rs` | Regression tests from bug reports |

## Skipped Test Files

- `json.rs` - JSON output format not implemented
- `multiline.rs` - Multiline matching not implemented

## Skipped Individual Tests

Some tests are skipped due to implementation differences:
- `.ignore` file support (we only support `.gitignore`)
- Complex `-A/-B/-C` flag precedence rules
- Word boundary behavior with non-word characters

## License

ripgrep is licensed under the MIT license. See the [ripgrep repository](https://github.com/BurntSushi/ripgrep) for details.
