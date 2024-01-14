import {
	Application,
	Context,
	Converter,
	ReflectionKind,
	TypeScript as ts,
	ReferenceType,
	Reflection,
	DeclarationReflection,
	ProjectReflection,
} from "typedoc";

declare module "typedoc" {
	export interface TypeDocOptionMap {
		internalModule: string;
	}

	export interface Reflection {
		[InternalModule]?: boolean;
	}
}

let hasMonkeyPatched = false;
const ModuleLike: ReflectionKind =
	ReflectionKind.Project | ReflectionKind.Module;
const InternalModule = Symbol();

export function load(app: Application) {
	if (hasMonkeyPatched) {
		throw new Error(
			"typedoc-plugin-missing-exports cannot be loaded multiple times",
		);
	}
	hasMonkeyPatched = true;

	const referencedSymbols = new Map<ts.Program, Set<ts.Symbol>>();
	const symbolToOwningModule = new Map<ts.Symbol, Reflection>();
	const knownPrograms = new Map<Reflection, ts.Program>();

	function discoverMissingExports(
		owningModule: Reflection,
		context: Context,
		program: ts.Program,
	): Set<ts.Symbol> {
		// An export is missing if if was referenced
		// Is not contained in the documented
		const referenced = referencedSymbols.get(program) || new Set();
		const ownedByOther = new Set<ts.Symbol>();
		referencedSymbols.set(program, ownedByOther);

		for (const s of [...referenced]) {
			if (context.project.getReflectionFromSymbol(s)) {
				referenced.delete(s);
			} else if (symbolToOwningModule.get(s) !== owningModule) {
				referenced.delete(s);
				ownedByOther.add(s);
			}
		}

		return referenced;
	}

	// Monkey patch the constructor for references so that we can get every
	const origCreateSymbolReference = ReferenceType.createSymbolReference;
	ReferenceType.createSymbolReference = function (symbol, context, name) {
		const owningModule = getOwningModule(context);
		console.log(
			"Created ref",
			symbol.name,
			"owner",
			owningModule.getFullName(),
		);
		const set = referencedSymbols.get(context.program);
		symbolToOwningModule.set(symbol, owningModule);
		if (set) {
			set.add(symbol);
		} else {
			referencedSymbols.set(context.program, new Set([symbol]));
		}
		return origCreateSymbolReference.call(this, symbol, context, name);
	};

	app.options.addDeclaration({
		name: "internalModule",
		help: "Define the name of the module that internal symbols which are not exported should be placed into.",
		defaultValue: "<internal>",
	});

	app.converter.on(
		Converter.EVENT_CREATE_DECLARATION,
		(context: Context, refl: Reflection) => {
			if (refl.kindOf(ModuleLike)) {
				knownPrograms.set(refl, context.program);
			}
		},
	);

	app.converter.on(
		Converter.EVENT_RESOLVE_BEGIN,
		function onResolveBegin(context: Context) {
			const modules: (DeclarationReflection | ProjectReflection)[] =
				context.project.getChildrenByKind(ReflectionKind.Module);
			if (modules.length === 0) {
				// Single entry point, just target the project.
				modules.push(context.project);
			}

			for (const mod of modules) {
				const program = knownPrograms.get(mod);
				if (!program) continue;

				let missing = discoverMissingExports(mod, context, program);
				if (!missing.size) continue;

				// Nasty hack here that will almost certainly break in future TypeDoc versions.
				context.setActiveProgram(program);

				const internalNs = context
					.withScope(mod)
					.createDeclarationReflection(
						ReflectionKind.Module,
						void 0,
						void 0,
						context.converter.application.options.getValue("internalModule"),
					);
				internalNs[InternalModule] = true;
				context.finalizeDeclarationReflection(internalNs);
				const internalContext = context.withScope(internalNs);

				// Keep track of which symbols we've tried to convert. If they don't get converted
				// when calling convertSymbol, then the user has excluded them somehow, don't go into
				// an infinite loop when converting.
				const tried = new Set<ts.Symbol>();

				do {
					for (const s of missing) {
						if (shouldConvertSymbol(s, context.checker)) {
							internalContext.converter.convertSymbol(internalContext, s);
						}
						tried.add(s);
					}

					missing = discoverMissingExports(mod, context, program);
					for (const s of tried) {
						missing.delete(s);
					}
				} while (missing.size > 0);

				// All the missing symbols were excluded, so get rid of our namespace.
				if (!internalNs.children?.length) {
					context.project.removeReflection(internalNs);
				}

				context.setActiveProgram(void 0);
			}

			knownPrograms.clear();
			referencedSymbols.clear();
			symbolToOwningModule.clear();
		},
		void 0,
		1e9,
	);
}

function getOwningModule(context: Context): Reflection {
	let refl = context.scope;
	// Go up the reflection hierarchy until we get to a module
	while (!refl.kindOf(ModuleLike)) {
		refl = refl.parent!;
	}

	// The <internal> module cannot be an owning module.
	if (refl[InternalModule]) {
		return refl.parent!;
	}

	return refl;
}

function shouldConvertSymbol(symbol: ts.Symbol, checker: ts.TypeChecker) {
	while (symbol.flags & ts.SymbolFlags.Alias) {
		symbol = checker.getAliasedSymbol(symbol);
	}

	// We're looking at an unknown symbol which is declared in some package without
	// type declarations. We know nothing about it, so don't convert it.
	if (symbol.flags & ts.SymbolFlags.Transient) {
		return false;
	}

	// This is something inside the special Node `Globals` interface. Don't convert it
	// because TypeDoc will reasonably assert that "Property" means that a symbol should be
	// inside something that can have properties.
	if (symbol.flags & ts.SymbolFlags.Property && symbol.name !== "default") {
		return false;
	}

	return true;
}
