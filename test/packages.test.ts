import { outdent } from "outdent";
import { join } from "path/posix";
import {
	Application,
	ContainerReflection,
	Logger,
	LogLevel,
	Reflection,
	ReflectionKind,
	TSConfigReader,
} from "typedoc";
import * as ts from "typescript";
import { afterEach, beforeAll, expect, test } from "vitest";
import { load } from "../index.js";

let app: Application;
let program: ts.Program;
let logger: TestLogger;

function toStringHierarchy(refl: Reflection, indent = 0) {
	const text: string[] = [];

	let increment = 1;
	if (refl.kindOf(ReflectionKind.Project)) {
		increment = 0;
	} else {
		text.push(
			`${"\t".repeat(indent)}${ReflectionKind.singularString(refl.kind)} ${refl.name}`,
		);
	}

	if (refl.kindOf(ReflectionKind.Project | ReflectionKind.Module)) {
		for (const child of (refl as ContainerReflection).children || []) {
			text.push(toStringHierarchy(child, indent + increment));
		}
	}

	return text.join("\n");
}

class TestLogger extends Logger {
	messages: string[] = [];
	log(message: string, level: LogLevel): void {
		if (level === LogLevel.Verbose) return;
		this.messages.push(`${LogLevel[level]}: ${message}`);
	}

	expectMessage(message: string) {
		expect(this.messages).toContain(message);
		this.messages.splice(this.messages.indexOf(message), 1);
	}
}

beforeAll(async () => {
	app = await Application.bootstrap(
		{
			tsconfig: join(__dirname, "packages", "tsconfig.json"),
			excludeExternals: true,
			excludeInternal: true,
			logLevel: LogLevel.Warn,
		},
		[new TSConfigReader()],
	);
	app.logger = logger = new TestLogger();
	load(app);

	program = ts.createProgram(
		app.options.getFileNames(),
		app.options.getCompilerOptions(),
	);
});

afterEach(() => {
	app.options.reset("internalModule");
	app.options.reset("placeInternalsInOwningModule");
	app.options.reset("basePath");

	expect(logger.messages).toEqual([]);
	logger.messages = [];
});

function convert(...paths: string[]) {
	const entries = paths.map((path) => {
		return {
			displayName: path,
			program,
			sourceFile: program.getSourceFile(join(__dirname, "packages", path))!,
		};
	});

	return app.converter.convert(entries);
}

test("No missing exports", () => {
	const project = convert("no-missing-exports/index.ts");

	expect(project.children?.map((c) => c.name)).toEqual(["foo"]);
});

test("Single missing export", () => {
	const project = convert("single-missing-export/index.ts");

	const hierarchy = outdent`
		Module <internal>
			Type Alias FooType
		Function foo
	`;

	expect(toStringHierarchy(project)).toBe(hierarchy);
});

test("Nested missing export", () => {
	const project = convert("nested-missing-export/index.ts");

	const hierarchy = outdent`
		Module <internal>
			Class Bar
			Class Foo
		Function foo
	`;

	expect(toStringHierarchy(project)).toBe(hierarchy);
});

test("Multiple entry points", () => {
	const project = convert("multi-entry/a.ts", "multi-entry/b.ts");

	const hierarchy = outdent`
		Module multi-entry/a.ts
			Module <internal>
				Type Alias FooNum
			Function aFn
		Module multi-entry/b.ts
			Module <internal>
				Class Bar
				Class Foo
			Function bFn
	`;

	expect(toStringHierarchy(project)).toBe(hierarchy);
});

test("Excluded non-exported", () => {
	const project = convert("excluded/index.ts");

	expect(project.children?.map((c) => c.name)).toEqual(["foo"]);
});

test("Missing declaration", () => {
	const project = convert("missing-declaration/index.ts");

	const hierarchy = outdent`
		Module <internal>
			Type Alias Options
		Function f
	`;

	expect(toStringHierarchy(project)).toBe(hierarchy);
});

// https://github.com/Gerrit0/typedoc-plugin-missing-exports/issues/12
test("Issue #12", () => {
	const project = convert("gh12/index.ts");

	const hierarchy = outdent`
		Module <internal>
			Namespace test/packages/gh12/mod
		Variable ReferencesModule
	`;

	expect(toStringHierarchy(project)).toBe(hierarchy);

	app.options.setValue("basePath", "test/packages");
	const project2 = convert("gh12/index.ts");

	const hierarchy2 = outdent`
		Module <internal>
			Namespace gh12/mod
		Variable ReferencesModule
	`;

	expect(toStringHierarchy(project2)).toBe(hierarchy2);
});

// https://github.com/Gerrit0/typedoc-plugin-missing-exports/issues/15
test("Issue #15", () => {
	const project = convert("gh15/index.ts");

	const hierarchy = outdent`
		Module <internal>
			Variable default
		Type Alias F
	`;

	expect(toStringHierarchy(project)).toBe(hierarchy);
});

// https://github.com/Gerrit0/typedoc-plugin-missing-exports/issues/22
test("Issue #22", () => {
	const project = convert("gh22/entry-a.ts", "gh22/entry-b.ts");

	const hierarchy = outdent`
		Module gh22/entry-a.ts
			Module <internal>
				Interface ReExport
			Variable a
		Module gh22/entry-b.ts
			Variable b
	`;

	expect(toStringHierarchy(project)).toBe(hierarchy);
});

// https://github.com/Gerrit0/typedoc-plugin-missing-exports/issues/33
test("Issue #33", () => {
	{
		const project = convert("gh33/index.ts");

		const hierarchy = outdent`
			Variable myGreatSymbol
		`;

		expect(toStringHierarchy(project)).toBe(hierarchy);
	}
	app.options.setValue("includeDocCommentReferences", true);
	{
		const project = convert("gh33/index.ts");

		// NOTE: `ShamefullyHidden` is deliberately not included, as this plugin does not (automatically) add exports to parents of referenced symbols.
		const hierarchy = outdent`
			Module <internal>
				Class GreatnessFactoryFactoryBuilderAdapterSingleton
				Type Alias SecretType
				Type Alias SecretType2
				Variable myBasicSymbol
				Function greatnessFactory
			Variable myGreatSymbol
		`;

		expect(toStringHierarchy(project)).toBe(hierarchy);
	}
});

test("Custom module name", () => {
	app.options.setValue("internalModule", "internals");
	const project = convert("single-missing-export/index.ts");

	expect(project.children?.map((c) => c.name)).toEqual(["internals", "foo"]);
});

test("Disabling <internals> module, #16", () => {
	app.options.setValue("placeInternalsInOwningModule", true);
	const project = convert("single-missing-export/index.ts");

	const hierarchy = outdent`
		Type Alias FooType
		Function foo
	`;

	expect(toStringHierarchy(project)).toBe(hierarchy);
});

test("Disabling <internals> module but internalModule is set gives warning", () => {
	app.options.setValue("placeInternalsInOwningModule", true);
	app.options.setValue("internalModule", "internals");
	convert("single-missing-export/index.ts");

	logger.expectMessage(
		"Warn: [typedoc-plugin-missing-exports] Both placeInternalsInOwningModule and internalModule are set, the internalModule option will be ignored.",
	);
});

test("Inherited symbols later fixed, #35", () => {
	const project = convert("gh35/index.ts");

	const hierarchy = outdent`
		Module <internal>
			Interface Parent2
		Interface Child
		Interface Parent
	`;

	expect(toStringHierarchy(project)).toBe(hierarchy);
});
