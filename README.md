# typedoc-plugin-missing-exports

Automatically document symbols which aren't exported but are referenced.

> Supports TypeDoc 0.22.x

TypeDoc 0.20 switched from documenting each file individually to documenting based on entry points. TypeDoc looks at each provided entry point and documents all exports from that entry point.

For libraries which export their full exposed API, this works well, but some packages are extremely resistant to exporting everything. This plugin is for them. After TypeDoc has finished converting packages, it will look for types which are referenced, but not exported, and place them into an internal namespace for that entry point (called `<internal>` by default).

If your project references classes which are built into the language (e.g. `HTMLElement`), this package _will_ result in those types being documented to. If you want to prevent this, set TypeDoc's `excludeExternals` option to `true`. The default pattern for determining if a symbol is external will exclude everything within `node_modules`.

### Options

-   `internalNamespace` - Define the name of the namespace that internal symbols which are not exported should be placed into.

### Additional Reading

-   https://github.com/TypeStrong/typedoc/issues/1657
