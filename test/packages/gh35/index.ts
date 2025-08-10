interface Parent<T> {
    on(x: T): any;
    prop: T;
}

interface Parent2<T> {
    off(x: T): any;
}

export interface Child extends Parent<string>, Parent2<string> {}

export { Parent }
