export function aFn() {
	return 123 as FooNum;
}

type FooNum = number & { readonly __fooNum: unique symbol };
