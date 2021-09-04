// @ts-check
const fs = require("fs").promises;
const { join, dirname } = require("path");

/**
 * @param {string} from
 * @param {string} to
 */
async function copy(from, to) {
    const info = await fs.lstat(from);
    if (info.isDirectory()) {
        for (const f of await fs.readdir(from)) {
            await copy(join(from, f), join(to, f));
        }
    } else {
        await fs.mkdir(dirname(to), { recursive: true });
        await fs.copyFile(from, to);
    }
}

copy(
    join(__dirname, "../test/packages"),
    join(__dirname, "../dist/test/packages")
).catch((err) => {
    console.error(err);
    process.exit(1);
});
