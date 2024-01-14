import * as ts from "typescript";
import { join } from "path/posix";
import { outdent } from "outdent";
import {
	Application,
	ContainerReflection,
	LogLevel,
	Reflection,
	ReflectionKind,
	TSConfigReader,
} from "typedoc";
import { test, expect, beforeAll } from "vitest";
import { load } from "../index.js";

let app: Application;
let program: ts.Program;

function toStringHierarchy(refl: Reflection, indent = 0) {
	const text: string[] = [];

	let increment = 1;
	if (refl.kindOf(ReflectionKind.Project)) {
		increment = 0;
	} else {
		text.push(
			`${"\t".repeat(indent)}${ReflectionKind.singularString(refl.kind)} ${
				refl.name
			}`,
		);
	}

	if (refl.kindOf(ReflectionKind.Project | ReflectionKind.Module)) {
		for (const child of (refl as ContainerReflection).children || []) {
			text.push(toStringHierarchy(child, indent + increment));
		}
	}

	return text.join("\n");
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
	load(app);

	program = ts.createProgram(
		app.options.getFileNames(),
		app.options.getCompilerOptions(),
	);
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
			Type alias FooType
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
				Type alias FooNum
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
			Type alias Options
		Function f
	`;

	expect(toStringHierarchy(project)).toBe(hierarchy);
});

// https://github.com/Gerrit0/typedoc-plugin-missing-exports/issues/15
test("Issue #15", () => {
	const project = convert("gh15/index.ts");

	const hierarchy = outdent`
		Module <internal>
			Variable default
		Type alias F
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

test("Custom module name", () => {
	app.options.setValue("internalModule", "internals");
	const project = convert("single-missing-export/index.ts");
	app.options.reset("internalModule");

	expect(project.children?.map((c) => c.name)).toEqual(["internals", "foo"]);
});
