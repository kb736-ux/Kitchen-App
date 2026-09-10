'use strict';

const assert = require('assert');
const { KitchenChatStore, KitchenChat } = require('./chat.js');

function msg(overrides) {
  return {
    serverId: 's1',
    sender: 'A',
    senderId: 'u1',
    text: 'hello',
    time: '12:00',
    ts: '2026-09-10T12:00:00.000Z',
    pending: false,
    ...overrides,
  };
}

function testMergeKeepsUnmatchedPending() {
  const store = new KitchenChatStore();
  store.pushLocal('dm:a:b', msg({ serverId: null, pending: true, text: 'pending', ts: '2026-09-10T12:01:00.000Z' }));
  const changed = store.mergeIncoming('dm:a:b', [msg({ serverId: 's2', text: 'from server' })]);
  assert.ok(changed);
  const texts = store.messagesFor('dm:a:b').map((m) => m.text);
  assert.deepStrictEqual(texts, ['from server', 'pending']);
}

function testMergeMatchesPendingToServer() {
  const store = new KitchenChatStore();
  store.pushLocal('dm:a:b', msg({
    serverId: null,
    pending: true,
    text: 'hello',
    senderId: 'u1',
    ts: '2026-09-10T12:00:05.000Z',
  }));
  store.mergeIncoming('dm:a:b', [msg({ serverId: 's9', text: 'hello', senderId: 'u1' })]);
  const rows = store.messagesFor('dm:a:b');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].pending, false);
  assert.strictEqual(rows[0].serverId, 's9');
}

function testApplyHeadDoesNotWipeHydratedHistory() {
  const store = new KitchenChatStore();
  const history = [
    msg({ serverId: '1', text: 'old', ts: '2026-09-10T10:00:00.000Z' }),
    msg({ serverId: '2', text: 'mid', ts: '2026-09-10T11:00:00.000Z' }),
    msg({ serverId: '3', text: 'new', ts: '2026-09-10T12:00:00.000Z' }),
  ];
  store.hydrateIncoming('dm:a:b', history, { name: 'Riley' });
  assert.strictEqual(store.hydrated['dm:a:b'], true);
  const wiped = store.applyHead('dm:a:b', history[2], { name: 'Riley' });
  assert.strictEqual(wiped, false);
  assert.strictEqual(store.messagesFor('dm:a:b').length, 3);
}

function testApplyHeadOnStubReplacesPreview() {
  const store = new KitchenChatStore();
  store.applyHead('group-line', msg({ serverId: '1', text: 'first' }), { name: 'Line' });
  assert.strictEqual(store.hydrated['group-line'], undefined);
  store.applyHead('group-line', msg({ serverId: '2', text: 'second', ts: '2026-09-10T13:00:00.000Z' }), { name: 'Line' });
  const rows = store.messagesFor('group-line');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].text, 'second');
  assert.strictEqual(store.meta['group-line'].preview, 'second');
}

function testDropMissingSkipsIncompleteAndHydrated() {
  const store = new KitchenChatStore();
  store.applyHead('dm:keep', msg({ serverId: 'a', text: 'x' }));
  store.hydrateIncoming('dm:hydrated', [msg({ serverId: 'b', text: 'y' })]);
  assert.strictEqual(store.dropMissingServerThreads(new Set(), { complete: false }), false);
  assert.ok(store.threads['dm:keep']);
  const dropped = store.dropMissingServerThreads(new Set(['other']), { complete: true });
  assert.strictEqual(dropped, true);
  assert.strictEqual(store.threads['dm:keep'], undefined);
  assert.ok(store.threads['dm:hydrated']);
}

function testSidebarFingerprintStableWhenPreviewUnchanged() {
  const store = new KitchenChatStore();
  store.applyHead('dm:a:b', msg({ text: 'yo' }), { name: 'Riley' });
  const a = store.sidebarItems().map((i) => `${i.id}|${i.title}|${i.preview}`).join('\n');
  store.applyHead('dm:a:b', msg({ text: 'yo' }), { name: 'Riley' });
  const b = store.sidebarItems().map((i) => `${i.id}|${i.title}|${i.preview}`).join('\n');
  assert.strictEqual(a, b);
}

function testUniqueHeadsKeepsFirstPerChannel() {
  const chat = new KitchenChat();
  const heads = chat.uniqueHeads([
    { channel_id: 'dm:a:b', text: 'latest' },
    { channel_id: 'dm:a:b', text: 'older' },
    { channel_id: 'group-line', text: 'g' },
  ]);
  assert.strictEqual(heads.length, 2);
  assert.strictEqual(heads[0].text, 'latest');
}

testMergeKeepsUnmatchedPending();
testMergeMatchesPendingToServer();
testApplyHeadDoesNotWipeHydratedHistory();
testApplyHeadOnStubReplacesPreview();
testDropMissingSkipsIncompleteAndHydrated();
testSidebarFingerprintStableWhenPreviewUnchanged();
console.log('kitchenChatStore.test.js: ok');
