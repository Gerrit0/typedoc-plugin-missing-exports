### 4.0.0 (2025-03-21)

- BREAKING: Drop support for TypeDoc <0.28.1.
- Support TypeDoc ^0.28.1, #31.

### 3.1.0 (2024-11-24)

- Support TypeDoc 0.27

### 3.0.2 (2024-10-15)

- Do not include the file extension in derived module names.

### 3.0.1 (2024-10-15)

- Fixed an issue where modules could be created by this plugin with names
  including an absolute path, #12.

### 3.0.0 (2024-06-22)

- Support TypeDoc 0.26
- BREAKING: Drop support for TypeDoc before 0.26.

### 2.3.0 (2024-06-12)

- Added `--collapseInternalModule` option.

### 2.2.0 (2024-01-14)

- Fixed an issue where if a re-exported symbol referenced an internal symbol, and more than one entry point was provided to TypeDoc,
  this plugin would add the internal symbol to the last module, rather than the one it was associated with, #22.
- Added `--placeInternalsInOwningModule` option.

### 2.1.0 (2023-08-25)

- Added support for TypeDoc 0.25.x

### 2.0.1 (2023-07-29)

- Fixed memory leak when running in watch mode / packages mode, TypeStrong/typedoc#2339

### 2.0.0 (2023-04-15)

- BREAKING: Drop support for TypeDoc 0.22 and 0.23

### 1.0.0 (2022-08-12)

- BREAKING: Will now create an `<internals>` **module** rather than a **namespace** to allow support for referenced default exports, #15.
- BREAKING: Renamed `internalNamespace` option to `internalModule`

### 0.23.0 (2022-06-26)

- Add support for TypeDoc 0.23.x
- Dropped support for Node 12.

### 0.22.6 (2021-11-24)

- Fix crash if `@types/node` is installed and `Global` is referenced, #5.

### 0.22.5 (2021-11-24)

- Fix crash if `@types/node` is installed and `Date` is referenced, #5.

### 0.22.4 (2021-11-6)

- Fix crash if a module without types is referenced as a type, #3.

### 0.22.3 (2021-09-15)

- Fix broken published package again.

### 0.22.2 (2021-09-15)

- Fix broken published package.

### 0.22.1 (2021-09-15)

- Add repo info for linking to plugin from npm.
