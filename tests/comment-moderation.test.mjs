import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/comment-moderation.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { isUnsafeText, isUnsafeImage, validateCommentImage, moderateCommentText } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("classes e regras de texto bloqueiam conteúdo impróprio", () => {
  assert.equal(isUnsafeText({ moderation_classes: { toxic: 0.71 } }), true);
  assert.equal(isUnsafeText({ profanity: { matches: [{ word: "x" }] } }), true);
  assert.equal(isUnsafeText({ moderation_classes: { toxic: 0.69 }, profanity: { matches: [] } }), false);
});

test("pontuações de imagem bloqueiam conteúdo impróprio", () => {
  assert.equal(isUnsafeImage({ nudity: { sexual_activity: 0.8 } }), true);
  assert.equal(isUnsafeImage({ violence: { physical_violence: 0.65 } }), true);
  assert.equal(isUnsafeImage({ nudity: { sexual_activity: 0.1 } }), false);
});

test("assinatura de arquivo deve corresponder ao MIME", async () => {
  await assert.rejects(validateCommentImage(new File(["texto"], "foto.png", { type: "image/png" })));
  await validateCommentImage(new File([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0)], "foto.png", { type: "image/png" }));
});

test("falha da API impede a publicação do texto", async () => {
  const originalFetch = globalThis.fetch;
  const originalUser = process.env.SIGHT_ENGINE_API_USER;
  const originalKey = process.env.SIGHT_ENGINE_API_KEY;
  process.env.SIGHT_ENGINE_API_USER = "test-user";
  process.env.SIGHT_ENGINE_API_KEY = "test-key";
  globalThis.fetch = async () => new Response(JSON.stringify({ status: "failure" }), { status: 200 });
  try {
    await assert.rejects(moderateCommentText("exemplo"), /indisponível/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUser === undefined) delete process.env.SIGHT_ENGINE_API_USER; else process.env.SIGHT_ENGINE_API_USER = originalUser;
    if (originalKey === undefined) delete process.env.SIGHT_ENGINE_API_KEY; else process.env.SIGHT_ENGINE_API_KEY = originalKey;
  }
});
