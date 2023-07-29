import * as ts from "typescript";
import { join } from "path";
import {
    Application,
    DocumentationEntryPoint,
    LogLevel,
    TSConfigReader,
} from "typedoc";
import { test, expect } from "vitest";
import { load } from "..";

const app = new Application();
app.options.addReader(new TSConfigReader());
app.bootstrap({
    tsconfig: join(__dirname, "packages", "tsconfig.json"),
    excludeExternals: true,
    excludeInternal: true,
    logLevel: LogLevel.Warn,
});
load(app);

const program = ts.createProgram(
    app.options.getFileNames(),
    app.options.getCompilerOptions(),
);

test("No missing exports", () => {
    const entry: DocumentationEntryPoint = {
        displayName: "none",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/no-missing-exports/index.ts"),
        )!,
    };

    const project = app.converter.convert([entry]);

    expect(project.children?.map((c) => c.name)).toEqual(["foo"]);
});

test("Single missing export", () => {
    const entry: DocumentationEntryPoint = {
        displayName: "single",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/single-missing-export/index.ts"),
        )!,
    };

    const project = app.converter.convert([entry]);

    expect(project.children?.map((c) => c.name)).toEqual(["<internal>", "foo"]);

    const internal = project.children?.find((c) => c.name === "<internal>");
    expect(internal?.children?.map((c) => c.name)).toEqual(["FooType"]);
});

test("Nested missing export", () => {
    const entry: DocumentationEntryPoint = {
        displayName: "nested",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/nested-missing-export/index.ts"),
        )!,
    };

    const project = app.converter.convert([entry]);

    expect(project.children?.map((c) => c.name)).toEqual(["<internal>", "foo"]);

    const internal = project.children?.find((c) => c.name === "<internal>");
    expect(internal?.children?.map((c) => c.name)).toEqual(["Bar", "Foo"]);
});

test("Multiple entry points", () => {
    const entry: DocumentationEntryPoint = {
        displayName: "a",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/multi-entry/a.ts"),
        )!,
    };
    const entry2: DocumentationEntryPoint = {
        displayName: "b",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/multi-entry/b.ts"),
        )!,
    };

    const project = app.converter.convert([entry, entry2]);

    expect(project.children?.map((c) => c.name)).toEqual(["a", "b"]);

    const a = project.children?.find((c) => c.name === "a");
    expect(a?.children?.map((c) => c.name)).toEqual(["<internal>", "aFn"]);

    const aInternal = a?.children?.find((c) => c.name === "<internal>");
    expect(aInternal?.children?.map((c) => c.name)).toEqual(["FooNum"]);

    const b = project.children?.find((c) => c.name === "b");
    expect(b?.children?.map((c) => c.name)).toEqual(["<internal>", "bFn"]);

    const bInternal = b?.children?.find((c) => c.name === "<internal>");
    expect(bInternal?.children?.map((c) => c.name)).toEqual(["Bar", "Foo"]);
});

test("Excluded non-exported", () => {
    const entry: DocumentationEntryPoint = {
        displayName: "excluded",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/excluded/index.ts"),
        )!,
    };

    const project = app.converter.convert([entry]);

    expect(project.children?.map((c) => c.name)).toEqual(["foo"]);
});

test("Missing declaration", () => {
    const entry: DocumentationEntryPoint = {
        displayName: "decl",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/missing-declaration/index.ts"),
        )!,
    };

    const project = app.converter.convert([entry]);
    const internals = project.children?.find((x) => x.name === "<internal>");
    expect(internals).toBeDefined();

    expect(internals?.children?.map((c) => c.name)).toEqual(["Options"]);
});

// https://github.com/Gerrit0/typedoc-plugin-missing-exports/issues/15
test("Issue #15", () => {
    const entry: DocumentationEntryPoint = {
        displayName: "gh15",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/gh15/index.ts"),
        )!,
    };

    const project = app.converter.convert([entry]);
    const internals = project.children?.find((x) => x.name === "<internal>");
    expect(internals).toBeDefined();

    expect(internals?.children?.map((c) => c.name)).toEqual(["default"]);
});

test("Custom namespace name", () => {
    const entry: DocumentationEntryPoint = {
        displayName: "single",
        program,
        sourceFile: program.getSourceFile(
            join(__dirname, "packages/single-missing-export/index.ts"),
        )!,
    };

    app.options.setValue("internalModule", "internals");
    const project = app.converter.convert([entry]);
    app.options.reset("internalModule");

    expect(project.children?.map((c) => c.name)).toEqual(["internals", "foo"]);
});
