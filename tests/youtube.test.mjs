import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/youtube.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { getYouTubeEmbedUrl } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("aceita links conhecidos e usa o player com privacidade aprimorada", () => {
  for (const url of ["https://www.youtube.com/watch?v=M7lc1UVf-VE", "https://youtu.be/M7lc1UVf-VE", "https://www.youtube.com/shorts/M7lc1UVf-VE"]) {
    assert.equal(getYouTubeEmbedUrl(url), "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE");
  }
});

test("rejeita protocolos, domínios e IDs não confiáveis", () => {
  for (const url of ["javascript:alert(1)", "http://youtu.be/M7lc1UVf-VE", "https://youtube.com.evil.test/watch?v=M7lc1UVf-VE", "https://www.youtube.com/watch?v=bad"]) {
    assert.equal(getYouTubeEmbedUrl(url), null);
  }
});
