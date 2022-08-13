import * as ts from "typescript";
import { join } from "path";
import {
    Application,
    DocumentationEntryPoint,
    LogLevel,
    TSConfigReader,
} from "typedoc";
import test from "ava";
import { discoverMissingExports } from "..";

const app = new Application();
app.options.addReader(new TSConfigReader());
app.bootstrap({
    tsconfig: join(__dirname, "packages", "tsconfig.json"),
    plugin: [join(__dirname, "..", "index.js")],
    excludeExternals: true,
    logLevel: LogLevel.Warn,
});

const program = ts.createProgram(
    app.options.getFileNames(),
    app.options.getCompilerOptions()
);

test("No missing exports", (t) => {
    const entry: DocumentationEntryPoint = {
        displayName: "none",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/no-missing-exports/index.ts")
        )!,
    };

    const project = app.converter.convert([entry]);

    t.deepEqual(
        project.children?.map((c) => c.name),
        ["foo"]
    );
});

test("Single missing export", (t) => {
    const entry: DocumentationEntryPoint = {
        displayName: "single",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/single-missing-export/index.ts")
        )!,
    };

    const project = app.converter.convert([entry]);

    t.deepEqual(
        project.children?.map((c) => c.name),
        ["<internal>", "foo"]
    );

    const internal = project.children?.find((c) => c.name === "<internal>");
    t.deepEqual(
        internal?.children?.map((c) => c.name),
        ["FooType"]
    );
});

test("Nested missing export", (t) => {
    const entry: DocumentationEntryPoint = {
        displayName: "nested",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/nested-missing-export/index.ts")
        )!,
    };

    const project = app.converter.convert([entry]);

    t.deepEqual(
        project.children?.map((c) => c.name),
        ["<internal>", "foo"]
    );

    const internal = project.children?.find((c) => c.name === "<internal>");
    t.deepEqual(
        internal?.children?.map((c) => c.name),
        ["Bar", "Foo"]
    );
});

test("Multiple entry points", (t) => {
    const entry: DocumentationEntryPoint = {
        displayName: "a",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/multi-entry/a.ts")
        )!,
    };
    const entry2: DocumentationEntryPoint = {
        displayName: "b",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/multi-entry/b.ts")
        )!,
    };

    const project = app.converter.convert([entry, entry2]);

    t.deepEqual(
        project.children?.map((c) => c.name),
        ["a", "b"]
    );

    const a = project.children?.find((c) => c.name === "a");
    t.deepEqual(
        a?.children?.map((c) => c.name),
        ["<internal>", "aFn"]
    );

    const aInternal = a?.children?.find((c) => c.name === "<internal>");
    t.deepEqual(
        aInternal?.children?.map((c) => c.name),
        ["FooNum"]
    );

    const b = project.children?.find((c) => c.name === "b");
    t.deepEqual(
        b?.children?.map((c) => c.name),
        ["<internal>", "bFn"]
    );

    const bInternal = b?.children?.find((c) => c.name === "<internal>");
    t.deepEqual(
        bInternal?.children?.map((c) => c.name),
        ["Bar", "Foo"]
    );
});

test("Excluded non-exported", (t) => {
    const entry: DocumentationEntryPoint = {
        displayName: "excluded",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/excluded/index.ts")
        )!,
    };

    const project = app.converter.convert([entry]);

    t.deepEqual(
        project.children?.map((c) => c.name),
        ["foo"]
    );

    const missing = discoverMissingExports(project);
    t.is(missing.size, 1);
});

test("Missing declaration", (t) => {
    const entry: DocumentationEntryPoint = {
        displayName: "decl",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/missing-declaration/index.ts")
        )!,
    };

    const project = app.converter.convert([entry]);
    const internals = project.children?.find((x) => x.name === "<internal>");
    t.truthy(internals, "No internals namespace created");

    t.deepEqual(
        internals?.children?.map((c) => c.name),
        ["Options"]
    );
});

// https://github.com/Gerrit0/typedoc-plugin-missing-exports/issues/15
test("Issue #15", (t) => {
    const entry: DocumentationEntryPoint = {
        displayName: "gh15",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/gh15/index.ts")
        )!,
    };

    const project = app.converter.convert([entry]);
    const internals = project.children?.find((x) => x.name === "<internal>");
    t.truthy(internals, "No internals namespace created");

    t.deepEqual(
        internals?.children?.map((c) => c.name),
        ["default"]
    );
});

test.serial("Custom namespace name", (t) => {
    const entry: DocumentationEntryPoint = {
        displayName: "single",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/single-missing-export/index.ts")
        )!,
    };

    app.options.setValue("internalNamespace", "internals");
    const project = app.converter.convert([entry]);
    app.options.reset("internalNamespace");

    t.deepEqual(
        project.children?.map((c) => c.name),
        ["internals", "foo"]
    );
});
