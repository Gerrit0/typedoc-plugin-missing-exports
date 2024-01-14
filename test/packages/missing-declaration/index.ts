// @ts-expect-error
import type { default as U } from "underscore";

type Options = {
	u?: U | null | undefined;
};

export function f(o: Options): void {
	o;
}
