import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/realtime.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { REALTIME_VERSION, ROOM_EVENT_NAMES, roomChannelName, roomTokenCapability, isVersionedEvent } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("o canal é por sala e restrito ao escopo game-room:*", () => {
  assert.equal(roomChannelName("ABCD1234"), "game-room:ABCD1234");
  assert.ok(roomChannelName("ABCD1234").startsWith("game-room:"));
  assert.notEqual(roomChannelName("ABCD1234"), roomChannelName("WXYZ9876"));
});

test("a capacidade do token limita o canal e permite subscribe + publish", () => {
  const capability = JSON.parse(roomTokenCapability("ABCD1234"));
  assert.deepEqual(capability, { "game-room:ABCD1234": ["subscribe", "publish"] });
});

test("os nomes de eventos exigidos pelo contrato estão presentes", () => {
  for (const name of ["game-state-updated", "player-joined", "player-left", "game-ended"]) {
    assert.ok(ROOM_EVENT_NAMES.includes(name), `evento ausente: ${name}`);
  }
});

test("isVersionedEvent aceita somente envelopes da versão atual", () => {
  assert.equal(isVersionedEvent({ v: REALTIME_VERSION }), true);
  assert.equal(isVersionedEvent({ v: REALTIME_VERSION + 1 }), false);
  assert.equal(isVersionedEvent({ v: "1" }), false);
  assert.equal(isVersionedEvent(null), false);
  assert.equal(isVersionedEvent("player-joined"), false);
  assert.equal(isVersionedEvent(undefined), false);
});
