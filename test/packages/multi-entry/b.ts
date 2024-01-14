export function bFn() {
	return new Foo();
}

class Foo {
	bar?: Bar;
}

class Bar {
	readonly isBar = true;
}
