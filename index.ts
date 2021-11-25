import {
    Application,
    ContainerReflection,
    Context,
    Converter,
    DeclarationReflection,
    makeRecursiveVisitor,
    ParameterReflection,
    ProjectReflection,
    Reflection,
    ReflectionKind,
    SignatureReflection,
    TypeParameterReflection,
    TypeScript as ts,
} from "typedoc";

declare module "typedoc" {
    export interface TypeDocOptionMap {
        internalNamespace: string;
    }
}

export function load(app: Application) {
    app.options.addDeclaration({
        name: "internalNamespace",
        help: "Define the name of the namespace that internal symbols which are not exported should be placed into.",
        defaultValue: "<internal>",
    });

    const knownPrograms = new Map<Reflection, ts.Program>();

    app.converter.on(Converter.EVENT_CREATE_DECLARATION, (context: Context) => {
        if (
            context.scope.kindOf(ReflectionKind.Project | ReflectionKind.Module)
        ) {
            knownPrograms.set(context.scope, context.program);
        }
    });

    app.converter.on(
        Converter.EVENT_RESOLVE_BEGIN,
        onResolveBegin.bind(void 0, knownPrograms),
        void 0,
        1e9
    );
}

function onResolveBegin(
    knownPrograms: Map<Reflection, ts.Program>,
    context: Context
) {
    const modules: (DeclarationReflection | ProjectReflection)[] =
        context.project.getChildrenByKind(ReflectionKind.Module);
    if (modules.length === 0) {
        // Single entry point, just target the project.
        modules.push(context.project);
    }

    for (const mod of modules) {
        let missing = discoverMissingExports(mod);
        if (missing.size === 0) continue;

        // Nasty hack here that will almost certainly break in future TypeDoc versions.
        context.setActiveProgram(knownPrograms.get(mod));

        const internalNs = context
            .withScope(mod)
            .createDeclarationReflection(
                ReflectionKind.Namespace,
                void 0,
                void 0,
                context.converter.application.options.getValue(
                    "internalNamespace"
                )
            );
        context.finalizeDeclarationReflection(internalNs, void 0);
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

            missing = discoverMissingExports(internalNs);
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
}

export function discoverMissingExports(root: Reflection): Set<ts.Symbol> {
    const missing = new Set<ts.Symbol>();
    const queue: Reflection[] = [];
    let current: Reflection | undefined = root;

    const visitor = makeRecursiveVisitor({
        reference(type) {
            if (!type.reflection) {
                const symbol = type.getSymbol();
                if (symbol) {
                    missing.add(symbol);
                }
            }
        },
        reflection(type) {
            queue.push(type.declaration);
        },
    });

    const add = (item: Reflection | Reflection[] | undefined) => {
        if (!item) return;

        if (item instanceof Reflection) {
            queue.push(item);
        } else {
            queue.push(...item);
        }
    };

    do {
        // Ugly? Yeah, it is. TypeDoc doesn't have a "visit all types" function,
        // so we have to build our own. This is modeled after the one in
        // https://github.com/TypeStrong/typedoc/blob/beta/src/lib/validation/exports.ts
        if (current instanceof ContainerReflection) {
            add(current.children);
        }

        if (current instanceof DeclarationReflection) {
            current.type?.visit(visitor);
            add(current.typeParameters);
            add(current.signatures);
            add(current.indexSignature);
            add(current.getSignature);
            add(current.setSignature);
            current.overwrites?.visit(visitor);
            current.inheritedFrom?.visit(visitor);
            current.implementationOf?.visit(visitor);
            current.extendedTypes?.forEach((type) => type.visit(visitor));
            // do not validate extendedBy, guaranteed to all be in the documentation.
            current.implementedTypes?.forEach((type) => type.visit(visitor));
            // do not validate implementedBy, guaranteed to all be in the documentation.
        }

        if (current instanceof SignatureReflection) {
            add(current.parameters);
            add(current.typeParameters);
            current.type?.visit(visitor);
            current.overwrites?.visit(visitor);
            current.inheritedFrom?.visit(visitor);
            current.implementationOf?.visit(visitor);
        }

        if (current instanceof ParameterReflection) {
            current.type?.visit(visitor);
        }

        if (current instanceof TypeParameterReflection) {
            current.type?.visit(visitor);
            current.default?.visit(visitor);
        }
    } while ((current = queue.shift()));

    return missing;
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

    return true;
}
