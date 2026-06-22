// register.mjs — run via `node --import` to enable .jsx imports in component tests.
import { register } from "node:module";
register("./jsx-loader.mjs", import.meta.url);
