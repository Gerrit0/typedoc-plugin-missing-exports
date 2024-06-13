# typedoc-plugin-missing-exports

Automatically document symbols which aren't exported but are referenced.

> Supports TypeDoc 0.24.x and 0.25.x

TypeDoc looks at each entry point provided and documents all exports from that entry point.

For libraries which export their full exposed API, this works well, but some packages are extremely resistant to exporting everything. This plugin is for them. After TypeDoc has finished converting packages, it will look for types which are referenced, but not exported, and place them into an internal module for that entry point (called `<internal>` by default).

If your project references classes which are built into the language (e.g. `HTMLElement`), this package _will_ result in those types being documented too. If you want to prevent this, set TypeDoc's `excludeExternals` option to `true`. The default pattern for determining if a symbol is external will exclude everything within `node_modules`.

### Usage

```bash
npm install typedoc-plugin-missing-exports
npx typedoc --plugin typedoc-plugin-missing-exports
```

### Options

- `internalModule` - Define the name of the module that internal symbols which are not exported should be placed into, defaults to `<internal>`.
- `collapseInternalModule` - Include JS in the page to collapse all `<internal>` entries in the navigation on page load.
- `placeInternalsInOwningModule` - Disable creating a module for internal symbols, and instead place them into the referencing module.

### Additional Reading

- https://github.com/TypeStrong/typedoc/issues/1657
