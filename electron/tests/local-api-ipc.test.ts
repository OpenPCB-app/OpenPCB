import { describe, expect, test } from "bun:test";
import { handleLocalApiBootstrap, registerLocalApiIpc } from "../src/main/local-api-ipc";
import type { CredentialSender, CredentialTrust } from "../src/main/credential-ipc";

const BOOTSTRAP = { url: "http://127.0.0.1:54321", token: "a".repeat(64) };

function fixture() {
  const frame = { url: "http://127.0.0.1:1420/settings" };
  const sender = { mainFrame: frame, isDestroyed: () => false };
  const event: CredentialSender = { sender, senderFrame: frame };
  const trust: CredentialTrust = { mainContents: () => sender, rendererOrigin: () => "http://127.0.0.1:1420" };
  let calls = 0;
  const getBootstrap = () => { calls++; return BOOTSTRAP; };
  return { event, trust, getBootstrap, calls: () => calls };
}

describe("trusted narrow local API bootstrap", () => {
  test("only exact current window/main frame/origin can receive app token", () => {
    const { event, trust, getBootstrap, calls } = fixture();
    const candidates = [
      { event: { ...event, sender: { ...event.sender } }, trust },
      { event: { ...event, senderFrame: { url: event.sender.mainFrame.url } }, trust },
      { event: { ...event, senderFrame: null }, trust },
      { event, trust: { ...trust, mainContents: () => null } },
      { event, trust: { ...trust, rendererOrigin: () => null } },
    ];
    for (const candidate of candidates) {
      expect(handleLocalApiBootstrap(candidate.event, [], candidate.trust, getBootstrap)).toBeNull();
    }
    expect(calls()).toBe(0);
    expect(handleLocalApiBootstrap(event, [], trust, getBootstrap)).toEqual(BOOTSTRAP);
    event.sender.isDestroyed = () => true;
    expect(handleLocalApiBootstrap(event, [], trust, getBootstrap)).toBeNull();
    expect(calls()).toBe(1);
  });

  test("hostile origins, extra arguments and unavailable backend fail closed", () => {
    const { event, trust, getBootstrap, calls } = fixture();
    for (const url of ["http://localhost:1420", "http://127.0.0.1:1421", "http://evil.test", "http://127.0.0.1.evil.test:1420", "file:///evil.html", "data:text/html,test", "not a URL"]) {
      event.sender.mainFrame.url = url;
      expect(handleLocalApiBootstrap(event, [], trust, getBootstrap)).toBeNull();
    }
    event.sender.mainFrame.url = "http://127.0.0.1:1420";
    for (const arguments_ of [[{}], ["url", "token"], [null]]) {
      expect(handleLocalApiBootstrap(event, arguments_, trust, getBootstrap)).toBeNull();
    }
    expect(calls()).toBe(0);
    expect(handleLocalApiBootstrap(event, [], trust, () => null)).toBeNull();
    expect(handleLocalApiBootstrap(event, [], trust, () => { throw new Error(BOOTSTRAP.token); })).toBeNull();
  });

  test("registers bootstrap only, no arbitrary request forwarding; packaged uses actual origin", () => {
    const { event, trust, getBootstrap } = fixture();
    const handlers = new Map<string, (event: CredentialSender, ...arguments_: unknown[]) => unknown>();
    registerLocalApiIpc({ handle: (channel, listener) => { handlers.set(channel, listener); } }, trust, getBootstrap);
    expect([...handlers.keys()]).toEqual(["local-api:bootstrap"]);
    expect(handlers.get("local-api:bootstrap")!(event)).toEqual(BOOTSTRAP);
    event.sender.mainFrame.url = `${BOOTSTRAP.url}/settings`;
    trust.rendererOrigin = () => BOOTSTRAP.url;
    expect(handleLocalApiBootstrap(event, [], trust, getBootstrap)).toEqual(BOOTSTRAP);
    event.sender.mainFrame.url = "http://127.0.0.1:54322";
    expect(handleLocalApiBootstrap(event, [], trust, getBootstrap)).toBeNull();
  });
});
